import type {
  AuthenticatedActor,
  StockCountRequest,
  StockLedgerState,
  StockReservationRequest,
  StockReservationResolveRequest,
  StockWasteRequest,
} from '@bj/contracts';
import type { Sql } from 'postgres';
import { auditOperation, PosFoundationError, runIdempotent } from './pos-foundation-service.js';

type InventoryRow = {
  id: string;
  name: string;
  unit: 'g' | 'ml' | 'pz';
  stock: string | number;
  reserved: string | number;
  value_cents: string | number;
  minimum: string | number;
  last_cost: string | number | null;
};

const asText = (value: string | number) => String(value);
const asScaled = (value: string | number) => {
  const raw = String(value);
  const sign = raw.startsWith('-') ? -1n : 1n;
  const [whole = '0', fraction = ''] = raw.replace(/^-/, '').split('.');
  return sign * (BigInt(whole) * 1000n + BigInt((fraction + '000').slice(0, 3)));
};
const scaledToDecimal = (value: bigint) => {
  const sign = value < 0n ? '-' : '';
  const absolute = value < 0n ? -value : value;
  return `${sign}${absolute / 1000n}.${(absolute % 1000n).toString().padStart(3, '0')}`;
};
const decimalToScaled = (value: string | number, scale: number) => {
  const raw = String(value);
  const sign = raw.startsWith('-') ? -1n : 1n;
  const [whole = '0', fraction = ''] = raw.replace(/^-/, '').split('.');
  return (
    sign *
    (BigInt(whole) * 10n ** BigInt(scale) + BigInt((fraction + '0'.repeat(scale)).slice(0, scale)))
  );
};
const scaledDecimal = (value: bigint, scale: number) => {
  const sign = value < 0n ? '-' : '';
  const absolute = value < 0n ? -value : value;
  const factor = 10n ** BigInt(scale);
  return `${sign}${absolute / factor}.${(absolute % factor).toString().padStart(scale, '0')}`;
};
const actorIds = (actor: AuthenticatedActor) =>
  actor.kind === 'device'
    ? { deviceId: actor.deviceId, userId: null }
    : { deviceId: null, userId: actor.userId };

function resultRow(row: InventoryRow) {
  return {
    id: row.id,
    name: row.name,
    unit: row.unit,
    stock: asText(row.stock),
    reserved: asText(row.reserved),
    available: scaledToDecimal(asScaled(row.stock) - asScaled(row.reserved)),
    value_cents: asText(row.value_cents),
    minimum: asText(row.minimum),
  };
}

async function appendMovement(
  tx: Sql,
  input: {
    ingredientId: string;
    type:
      | 'initial'
      | 'purchase'
      | 'sale'
      | 'waste'
      | 'adjustment'
      | 'count'
      | 'production_consume'
      | 'production_output';
    quantityDelta: string;
    valueDeltaCents: string;
    stockAfter: string;
    valueAfterCents: string;
    reason: string;
    actor: AuthenticatedActor;
    businessEntryId?: string;
    reservationId?: string;
  },
) {
  const ids = actorIds(input.actor);
  await tx`
    insert into stock_ledger_movements
      (ingredient_id,business_entry_id,reservation_id,movement_type,quantity_delta,value_delta_cents,
       stock_after,value_after_cents,reason,created_by_device_id,created_by_user_id)
    values
      (${input.ingredientId},${input.businessEntryId ?? null},${input.reservationId ?? null},
       ${input.type},${input.quantityDelta},${input.valueDeltaCents},${input.stockAfter},
       ${input.valueAfterCents},${input.reason},${ids.deviceId},${ids.userId})`;
}

export async function reserveStock(
  sql: Sql,
  input: StockReservationRequest,
  actor: AuthenticatedActor,
) {
  return runIdempotent(
    sql,
    { idempotencyKey: input.idempotencyKey, operation: 'stock.reserve', request: input, actor },
    async (tx) => {
      const ids = actorIds(actor);
      const rows = await tx<InventoryRow[]>`
        update stock_ingredients
        set reserved=reserved+${input.quantity}
        where id=${input.ingredientId}
        returning id,name,unit,stock,reserved,value_cents,minimum,last_cost`;
      if (!rows[0]) throw new PosFoundationError(404, 'El ingrediente no existe.');
      const reservations = await tx<{ id: string; quantity: string | number; status: string }[]>`
        insert into stock_reservations
          (ingredient_id,quantity,status,reference_type,reference_id,reason,created_by_device_id,created_by_user_id)
        values (${input.ingredientId},${input.quantity},'active',${input.referenceType},${input.referenceId},
                ${input.reason},${ids.deviceId},${ids.userId})
        returning id,quantity,status`;
      await auditOperation(tx as unknown as Sql, actor, {
        action: 'reserve',
        entity: 'stock_reservation',
        entityId: reservations[0]!.id,
        reason: input.reason,
        idempotencyKey: input.idempotencyKey,
        details: { ingredientId: input.ingredientId, quantity: input.quantity },
      });
      return { reservation: reservations[0]!, ingredient: resultRow(rows[0]!) };
    },
  );
}

export async function releaseStockReservation(
  sql: Sql,
  reservationId: string,
  input: StockReservationResolveRequest,
  actor: AuthenticatedActor,
) {
  return runIdempotent(
    sql,
    {
      idempotencyKey: input.idempotencyKey,
      operation: 'stock.release',
      request: { reservationId, ...input },
      actor,
    },
    async (tx) => {
      const reservations = await tx<
        { ingredient_id: string; quantity: string | number; status: string }[]
      >`
        select ingredient_id,quantity,status from stock_reservations where id=${reservationId} for update`;
      const reservation = reservations[0];
      if (!reservation) throw new PosFoundationError(404, 'La reserva no existe.');
      if (reservation.status !== 'active')
        throw new PosFoundationError(409, 'La reserva ya fue resuelta.');
      const rows = await tx<InventoryRow[]>`
        update stock_ingredients set reserved=reserved-${reservation.quantity}
        where id=${reservation.ingredient_id} and reserved>=${reservation.quantity}
        returning id,name,unit,stock,reserved,value_cents,minimum,last_cost`;
      if (!rows[0])
        throw new PosFoundationError(409, 'La reserva ya no coincide con el inventario.');
      await tx`update stock_reservations set status='released',resolved_at=now(),reason=${input.reason} where id=${reservationId}`;
      await auditOperation(tx as unknown as Sql, actor, {
        action: 'release',
        entity: 'stock_reservation',
        entityId: reservationId,
        reason: input.reason,
        idempotencyKey: input.idempotencyKey,
      });
      return { reservationId, status: 'released', ingredient: resultRow(rows[0]!) };
    },
  );
}

export async function countStock(sql: Sql, input: StockCountRequest, actor: AuthenticatedActor) {
  return runIdempotent(
    sql,
    {
      idempotencyKey: input.idempotencyKey,
      operation: 'stock.count',
      request: {
        idempotencyKey: input.idempotencyKey,
        ingredientId: input.ingredientId,
        countedQuantity: input.countedQuantity,
        reason: input.reason,
        ...(input.unitCostCents === undefined ? {} : { unitCostCents: input.unitCostCents }),
      },
      actor,
    },
    async (tx) => {
      const before = (
        await tx<InventoryRow[]>`
        select id,name,unit,stock,reserved,value_cents,minimum,last_cost
        from stock_ingredients where id=${input.ingredientId} for update`
      )[0];
      if (!before) throw new PosFoundationError(404, 'El ingrediente no existe.');
      if (asScaled(before.reserved) > 0n)
        throw new PosFoundationError(
          409,
          'Resuelve las reservas activas antes de confirmar un conteo.',
        );
      const target = asScaled(input.countedQuantity);
      const current = asScaled(before.stock);
      if (target === current)
        throw new PosFoundationError(
          409,
          'El conteo coincide con la existencia actual; no hay ajuste que registrar.',
        );
      if (target > 0n && target > current && !input.unitCostCents && before.last_cost === null)
        throw new PosFoundationError(
          409,
          'Indica el costo unitario para valorar el incremento del conteo.',
        );
      const cost =
        input.unitCostCents ?? (before.last_cost === null ? '0' : asText(before.last_cost));
      const rows = await tx<InventoryRow[]>`
        update stock_ingredients
        set stock=${input.countedQuantity},
          value_cents=case
            when ${input.countedQuantity}::numeric <= 0 then 0
            when stock <= 0 then ${input.countedQuantity}::numeric*${cost}::numeric
            when ${input.countedQuantity}::numeric > stock
              then value_cents + (${input.countedQuantity}::numeric-stock)*${cost}::numeric
            else value_cents * (${input.countedQuantity}::numeric / stock)
          end,
          last_cost=case when ${input.countedQuantity}::numeric > stock and ${input.countedQuantity}::numeric > 0 then ${cost}::numeric else last_cost end
        where id=${input.ingredientId}
        returning id,name,unit,stock,reserved,value_cents,minimum,last_cost`;
      const after = rows[0]!;
      await appendMovement(tx as unknown as Sql, {
        ingredientId: input.ingredientId,
        type: 'count',
        quantityDelta: scaledToDecimal(asScaled(after.stock) - asScaled(before.stock)),
        valueDeltaCents: scaledDecimal(
          decimalToScaled(after.value_cents, 6) - decimalToScaled(before.value_cents, 6),
          6,
        ),
        stockAfter: asText(after.stock),
        valueAfterCents: asText(after.value_cents),
        reason: input.reason,
        actor,
      });
      await auditOperation(tx as unknown as Sql, actor, {
        action: 'count',
        entity: 'stock_ingredient',
        entityId: input.ingredientId,
        reason: input.reason,
        idempotencyKey: input.idempotencyKey,
        details: { countedQuantity: input.countedQuantity },
      });
      return { ingredient: resultRow(after) };
    },
  );
}

export async function writeOffStock(sql: Sql, input: StockWasteRequest, actor: AuthenticatedActor) {
  return runIdempotent(
    sql,
    { idempotencyKey: input.idempotencyKey, operation: 'stock.write_off', request: input, actor },
    async (tx) => {
      const rows = await tx<InventoryRow[]>`
        with before as (
          select * from stock_ingredients where id=${input.ingredientId} for update
        )
        update stock_ingredients i
        set stock=b.stock-${input.quantity},
            value_cents=case when b.stock<=${input.quantity}::numeric then 0
              else b.value_cents-(b.value_cents/b.stock)*${input.quantity}::numeric end
        from before b
        where i.id=b.id and (b.reserved=0 or b.stock-b.reserved>=${input.quantity})
        returning i.id,i.name,i.unit,i.stock,i.reserved,i.value_cents,i.minimum,i.last_cost,
          (${input.quantity}::numeric)::text as quantity,
          (least(greatest(b.stock,0),${input.quantity}::numeric)*case when b.stock>0 then b.value_cents/b.stock else 0 end
            + greatest(0,${input.quantity}::numeric-greatest(b.stock,0))*coalesce(b.last_cost,0))::text as consumed_cost`;
      const after = rows[0] as
        (InventoryRow & { quantity: string; consumed_cost: string }) | undefined;
      if (!after)
        throw new PosFoundationError(409, 'La existencia está reservada por otra comanda.');
      await appendMovement(tx as unknown as Sql, {
        ingredientId: input.ingredientId,
        type: 'waste',
        quantityDelta: `-${input.quantity}`,
        valueDeltaCents: scaledDecimal(-decimalToScaled(after.consumed_cost, 6), 6),
        stockAfter: asText(after.stock),
        valueAfterCents: asText(after.value_cents),
        reason: `${input.cause}: ${input.reason}`,
        actor,
      });
      await auditOperation(tx as unknown as Sql, actor, {
        action: 'write_off',
        entity: 'stock_ingredient',
        entityId: input.ingredientId,
        reason: input.reason,
        idempotencyKey: input.idempotencyKey,
        details: { cause: input.cause, quantity: input.quantity },
      });
      return { ingredient: resultRow(after) };
    },
  );
}

export async function stockLedgerState(
  sql: Sql,
  limit = 100,
  cursor?: string,
): Promise<StockLedgerState> {
  const safeLimit = Math.max(1, Math.min(limit, 200));
  const marker = cursor
    ? await sql<{ id: string; created_at: string | Date }[]>`
        select id,created_at from stock_ledger_movements where id=${cursor}`
    : [];
  const [ingredients, movements] = await Promise.all([
    sql<
      InventoryRow[]
    >`select id,name,unit,stock,reserved,value_cents,minimum,last_cost from stock_ingredients order by name`,
    marker[0]
      ? sql<
          Array<{
            id: string;
            ingredient_id: string;
            movement_type:
              | 'initial'
              | 'purchase'
              | 'sale'
              | 'waste'
              | 'adjustment'
              | 'count'
              | 'production_consume'
              | 'production_output';
            quantity_delta: string | number;
            value_delta_cents: string | number;
            stock_after: string | number;
            value_after_cents: string | number;
            reason: string;
            created_at: string | Date;
          }>
        >`select id,ingredient_id,movement_type,quantity_delta,value_delta_cents,stock_after,value_after_cents,reason,created_at
        from stock_ledger_movements
        where (created_at,id) < (${marker[0].created_at}::timestamptz,${marker[0].id}::uuid)
        order by created_at desc,id desc limit ${safeLimit + 1}`
      : sql<
          Array<{
            id: string;
            ingredient_id: string;
            movement_type:
              | 'initial'
              | 'purchase'
              | 'sale'
              | 'waste'
              | 'adjustment'
              | 'count'
              | 'production_consume'
              | 'production_output';
            quantity_delta: string | number;
            value_delta_cents: string | number;
            stock_after: string | number;
            value_after_cents: string | number;
            reason: string;
            created_at: string | Date;
          }>
        >`select id,ingredient_id,movement_type,quantity_delta,value_delta_cents,stock_after,value_after_cents,reason,created_at
        from stock_ledger_movements order by created_at desc,id desc limit ${safeLimit + 1}`,
  ]);
  const visible = movements.slice(0, safeLimit);
  return {
    ingredients: ingredients.map(resultRow),
    movements: visible.map((movement) => ({
      ...movement,
      quantity_delta: asText(movement.quantity_delta),
      value_delta_cents: asText(movement.value_delta_cents),
      stock_after: asText(movement.stock_after),
      value_after_cents: asText(movement.value_after_cents),
      created_at: new Date(movement.created_at).toISOString(),
    })),
    nextCursor: movements.length > safeLimit ? visible.at(-1)!.id : null,
  };
}

export { appendMovement };

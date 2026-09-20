import type { AuthenticatedActor, PurchaseCreate } from '@bj/contracts';
import type { Sql } from 'postgres';
import { auditOperation, PosFoundationError, runIdempotent } from './pos-foundation-service.js';
import { appendMovement } from './stock-ledger-service.js';

const actorIds = (actor: AuthenticatedActor) =>
  actor.kind === 'device'
    ? { device: actor.deviceId, user: null }
    : { device: null, user: actor.userId };
function scaled(value: string) {
  const [a = '0', b = ''] = value.split('.');
  return BigInt(a) * 1000n + BigInt((b + '000').slice(0, 3));
}
function decimal(value: bigint) {
  return `${value / 1000n}.${(value % 1000n).toString().padStart(3, '0')}`;
}
function allocations(total: number, weights: number[]) {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (!sum) throw new PosFoundationError(400, 'No hay base válida para prorratear.');
  const rows = weights.map((weight, index) => ({
    index,
    base: Math.floor((total * weight) / sum),
    remainder: (total * weight) % sum,
  }));
  let remaining = total - rows.reduce((a, x) => a + x.base, 0);
  for (const row of [...rows].sort((a, b) => b.remainder - a.remainder || a.index - b.index))
    if (remaining--) row.base += 1;
  return rows.map((x) => x.base);
}
export async function createPurchase(sql: Sql, input: PurchaseCreate, actor: AuthenticatedActor) {
  return runIdempotent(
    sql,
    { idempotencyKey: input.idempotencyKey, operation: 'purchase.create', request: input, actor },
    async (tx) => {
      const suppliers =
        await tx`select id from suppliers where id=${input.supplierId} and active=true`;
      if (!suppliers[0])
        throw new PosFoundationError(404, 'El proveedor no existe o está inactivo.');
      const ids = actorIds(actor);
      const gross = input.lines.map((x) => x.grossCents);
      const subtotal = gross.reduce((a, b) => a + b, 0);
      if (input.discountCents > subtotal)
        throw new PosFoundationError(400, 'El descuento no puede superar el subtotal.');
      const discounts = allocations(input.discountCents, gross),
        acquisition = allocations(input.acquisitionCents, gross);
      const [document] =
        await tx`insert into purchase_documents(supplier_id,idempotency_key,reference,status,subtotal_cents,discount_cents,acquisition_cents,total_cents,payment_method,funds_origin,created_by_device_id,created_by_user_id)
      values(${input.supplierId},${input.idempotencyKey},${input.reference},'confirmed',${subtotal},${input.discountCents},${input.acquisitionCents},${subtotal - input.discountCents + input.acquisitionCents},${input.paymentMethod},${input.fundsOrigin},${ids.device},${ids.user}) returning id,total_cents`;
      if (!document) throw new PosFoundationError(500, 'No fue posible registrar la compra.');
      const snapshots: Array<Record<string, string | number>> = [];
      for (const [index, line] of input.lines.entries()) {
        const rows = await tx<
          { base_quantity: string; stock: string; value_cents: string }[]
        >`select p.base_quantity,i.stock::text,i.value_cents::text from ingredient_presentations p join stock_ingredients i on i.id=p.ingredient_id
        where p.id=${line.presentationId} and p.ingredient_id=${line.ingredientId} and p.active=true for update of i,p`;
        const row = rows[0];
        if (!row)
          throw new PosFoundationError(
            400,
            'La presentación no corresponde al ingrediente o está inactiva.',
          );
        const product = scaled(row.base_quantity) * scaled(line.presentationQuantity);
        if (product % 1000n)
          throw new PosFoundationError(
            400,
            'La equivalencia debe resultar en una cantidad con máximo tres decimales.',
          );
        const discount = discounts[index]!;
        const acquisitionCost = acquisition[index]!;
        const baseQty = decimal(product / 1000n);
        const value = line.grossCents - discount + acquisitionCost;
        const updated = await tx<
          { stock: string; value_cents: string }[]
        >`update stock_ingredients set stock=stock+${baseQty},value_cents=value_cents+${value},last_cost=${value}::numeric/${baseQty}::numeric where id=${line.ingredientId} returning stock::text,value_cents::text`;
        await tx`insert into purchase_lines(purchase_id,ingredient_id,presentation_id,presentation_quantity,applied_base_quantity,gross_cents,allocated_discount_cents,allocated_acquisition_cents,inventory_value_cents)
        values(${document.id},${line.ingredientId},${line.presentationId},${line.presentationQuantity},${baseQty},${line.grossCents},${discount},${acquisitionCost},${value})`;
        await appendMovement(tx as unknown as Sql, {
          ingredientId: line.ingredientId,
          type: 'purchase',
          quantityDelta: baseQty,
          valueDeltaCents: String(value),
          stockAfter: updated[0]!.stock,
          valueAfterCents: updated[0]!.value_cents,
          reason: `Compra ${input.reference || document.id}`,
          actor,
        });
        snapshots.push({
          ingredientId: line.ingredientId,
          presentationId: line.presentationId,
          presentationQuantity: line.presentationQuantity,
          grossCents: line.grossCents,
          appliedBaseQuantity: baseQty,
          allocatedDiscountCents: discount,
          allocatedAcquisitionCents: acquisitionCost,
          inventoryValueCents: value,
        });
      }
      await auditOperation(tx as unknown as Sql, actor, {
        action: 'create',
        entity: 'purchase',
        entityId: document.id,
        idempotencyKey: input.idempotencyKey,
        details: { totalCents: document.total_cents, lines: snapshots.length },
      });
      return { purchaseId: document.id, totalCents: document.total_cents, lines: snapshots };
    },
  );
}
export async function reversePurchase(
  sql: Sql,
  purchaseId: string,
  input: { idempotencyKey: string; reason: string },
  actor: AuthenticatedActor,
) {
  return runIdempotent(
    sql,
    {
      idempotencyKey: input.idempotencyKey,
      operation: 'purchase.reverse',
      request: { purchaseId, ...input },
      actor,
    },
    async (tx) => {
      const docs = await tx<
        { id: string; status: string; created_at: string | Date }[]
      >`select id,status,created_at from purchase_documents where id=${purchaseId} for update`;
      const doc = docs[0];
      if (!doc) throw new PosFoundationError(404, 'La compra no existe.');
      if (doc.status !== 'confirmed')
        throw new PosFoundationError(409, 'La compra ya fue revertida.');
      const lines = await tx<
        { ingredient_id: string; applied_base_quantity: string; inventory_value_cents: number }[]
      >`select ingredient_id,applied_base_quantity::text,inventory_value_cents from purchase_lines where purchase_id=${purchaseId} order by id`;
      for (const line of lines) {
        const later =
          await tx`select id from stock_ledger_movements where ingredient_id=${line.ingredient_id} and created_at>${doc.created_at} limit 1`;
        if (later[0])
          throw new PosFoundationError(
            409,
            'No se puede revertir: existen consumos o movimientos posteriores.',
          );
        const rows = await tx<
          { stock: string; value_cents: string }[]
        >`update stock_ingredients set stock=stock-${line.applied_base_quantity},value_cents=value_cents-${line.inventory_value_cents} where id=${line.ingredient_id} and stock-reserved>=${line.applied_base_quantity} returning stock::text,value_cents::text`;
        if (!rows[0])
          throw new PosFoundationError(
            409,
            'No se puede revertir: la existencia disponible ya no alcanza.',
          );
        await appendMovement(tx as unknown as Sql, {
          ingredientId: line.ingredient_id,
          type: 'adjustment',
          quantityDelta: `-${line.applied_base_quantity}`,
          valueDeltaCents: `-${line.inventory_value_cents}`,
          stockAfter: rows[0].stock,
          valueAfterCents: rows[0].value_cents,
          reason: `Reversión de compra: ${input.reason}`,
          actor,
        });
      }
      const ids = actorIds(actor);
      const [reversal] =
        await tx`insert into purchase_reversals(purchase_id,idempotency_key,reason,created_by_device_id,created_by_user_id) values(${purchaseId},${input.idempotencyKey},${input.reason},${ids.device},${ids.user}) returning id`;
      await tx`update purchase_documents set status='reversed',reversed_at=now() where id=${purchaseId}`;
      await auditOperation(tx as unknown as Sql, actor, {
        action: 'reverse',
        entity: 'purchase',
        entityId: purchaseId,
        reason: input.reason,
        idempotencyKey: input.idempotencyKey,
      });
      return { purchaseId, reversalId: reversal!.id, status: 'reversed' };
    },
  );
}

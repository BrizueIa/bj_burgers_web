import type { AuthenticatedActor, ProductionBatchCreate } from '@bj/contracts';
import type { Sql } from 'postgres';
import { auditOperation, PosFoundationError, runIdempotent } from './pos-foundation-service.js';
import { appendMovement } from './stock-ledger-service.js';
const micros = (value: string) => {
  const [whole = '0', fraction = ''] = value.split('.');
  return BigInt(whole) * 1_000_000n + BigInt((fraction + '000000').slice(0, 6));
};
const decimalMicros = (value: bigint) =>
  `${value / 1_000_000n}.${(value % 1_000_000n).toString().padStart(6, '0')}`;
const actorIds = (actor: AuthenticatedActor) =>
  actor.kind === 'device'
    ? { device: actor.deviceId, user: null }
    : { device: null, user: actor.userId };
export async function createProductionBatch(
  sql: Sql,
  input: ProductionBatchCreate,
  actor: AuthenticatedActor,
) {
  return runIdempotent(
    sql,
    { idempotencyKey: input.idempotencyKey, operation: 'production.create', request: input, actor },
    async (tx) => {
      const products = await tx<
        { id: string; name: string }[]
      >`select id,name from products where id=${input.productId} for update`;
      const product = products[0];
      if (!product) throw new PosFoundationError(404, 'El producto no existe.');
      const versions = await tx<
        { id: string }[]
      >`select id from recipe_versions where product_id=${input.productId} and status='active' for update`;
      const version = versions[0];
      if (!version) throw new PosFoundationError(409, 'Falta una receta versionada activa.');
      const components = await tx<
        { ingredient_id: string | null; component_kind: string; quantity: string; extra: boolean }[]
      >`select ingredient_id,component_kind,quantity::text,extra from recipe_version_components where recipe_version_id=${version.id} order by ingredient_id`;
      if (
        !components.length ||
        components.some(
          (c) =>
            (c.component_kind !== 'ingredient' && c.component_kind !== 'packaging') ||
            c.extra ||
            !c.ingredient_id,
        )
      )
        throw new PosFoundationError(
          409,
          'La preparación sólo admite insumos y empaques base en esta etapa.',
        );
      const ids = [...new Set(components.map((c) => c.ingredient_id!))].sort();
      const inputs = await tx<
        { id: string; name: string; stock: string; reserved: string; value_cents: string }[]
      >`select id,name,stock::text,reserved::text,value_cents::text from stock_ingredients where id=any(${ids}) order by id for update`;
      if (inputs.length !== ids.length)
        throw new PosFoundationError(409, 'Un insumo de la receta ya no existe.');
      let consumed = 0n;
      for (const component of components) {
        const item = inputs.find((x) => x.id === component.ingredient_id)!;
        const needed = component.quantity;
        const rows = await tx<
          { stock: string; value_cents: string; cost: string }[]
        >`with before as (select stock,reserved,value_cents from stock_ingredients where id=${item.id}) update stock_ingredients i set stock=b.stock-${needed}::numeric,value_cents=case when b.stock=${needed}::numeric then 0 else b.value_cents-(b.value_cents/b.stock)*${needed}::numeric end from before b where i.id=${item.id} and b.stock-b.reserved>=${needed}::numeric and b.stock>0 returning i.stock::text,i.value_cents::text,(b.value_cents/b.stock*${needed}::numeric)::text as cost`;
        const row = rows[0];
        if (!row)
          throw new PosFoundationError(
            409,
            `Existencia disponible insuficiente para ${item.name}.`,
          );
        consumed += micros(row.cost);
        await appendMovement(tx, {
          ingredientId: item.id,
          type: 'production_consume',
          quantityDelta: `-${needed}`,
          valueDeltaCents: `-${row.cost}`,
          stockAfter: row.stock,
          valueAfterCents: row.value_cents,
          reason: input.reason,
          actor,
        });
      }
      const stockRows = await tx<
        { id: string; stock: string; value_cents: string; unit: string }[]
      >`select id,stock::text,value_cents::text,unit from stock_ingredients where preparation_product_id=${input.productId} for update`;
      let output = stockRows[0];
      if (!output) {
        const preparationName = `Preparación · ${product.name}`;
        const sameName = await tx<{ id: string }[]>`
          select id from stock_ingredients where name=${preparationName} for update`;
        if (sameName[0])
          throw new PosFoundationError(
            409,
            'Ya existe un insumo con el nombre reservado para esta preparación.',
          );
        const [created] = await tx<
          { id: string; stock: string; value_cents: string; unit: string }[]
        >`insert into stock_ingredients(name,unit,preparation_product_id) values(${preparationName},${input.outputUnit},${input.productId}) returning id,stock::text,value_cents::text,unit`;
        output = created!;
      }
      if (output.unit !== input.outputUnit)
        throw new PosFoundationError(409, 'La preparación ya existe con otra unidad.');
      const cost = decimalMicros(consumed);
      const updated = (
        await tx<
          { stock: string; value_cents: string }[]
        >`update stock_ingredients set stock=stock+${input.outputQuantity}::numeric,value_cents=value_cents+${cost}::numeric,last_cost=${cost}::numeric/${input.outputQuantity}::numeric where id=${output.id} returning stock::text,value_cents::text`
      )[0]!;
      await appendMovement(tx, {
        ingredientId: output.id,
        type: 'production_output',
        quantityDelta: input.outputQuantity,
        valueDeltaCents: cost,
        stockAfter: updated.stock,
        valueAfterCents: updated.value_cents,
        reason: input.reason,
        actor,
      });
      const who = actorIds(actor);
      const [batch] = await tx<
        { id: string }[]
      >`insert into production_batches(product_id,recipe_version_id,output_ingredient_id,idempotency_key,output_quantity,output_unit,consumed_cost_cents,created_by_device_id,created_by_user_id) values(${input.productId},${version.id},${output.id},${input.idempotencyKey},${input.outputQuantity},${input.outputUnit},${cost},${who.device},${who.user}) returning id`;
      await auditOperation(tx, actor, {
        action: 'create',
        entity: 'production_batch',
        entityId: batch!.id,
        reason: input.reason,
        idempotencyKey: input.idempotencyKey,
      });
      return {
        batchId: batch!.id,
        outputIngredientId: output.id,
        outputQuantity: input.outputQuantity,
        consumedCostCents: cost,
      };
    },
  );
}

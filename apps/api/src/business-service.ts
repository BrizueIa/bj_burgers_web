import { z } from 'zod';
import type { Sql, JSONValue } from 'postgres';
import { OrderError } from './order-service.js';
import { appendMovement } from './stock-ledger-service.js';

const quantity = z.number().positive().max(1000000).multipleOf(0.001);
const cents = z.number().int().min(0).max(100000000);
export const ingredientSchema = z.object({
  name: z.string().trim().min(1).max(120),
  unit: z.enum(['g', 'ml', 'pz']),
  minimum: z.number().min(0).max(1000000).multipleOf(0.001).default(0),
});
export const recipeSchema = z
  .object({
    productId: z.string().min(1),
    targetMargin: z.number().int().min(1).max(95),
    overheadCents: cents,
    priceCents: cents,
    lines: z
      .array(z.object({ ingredientId: z.uuid(), quantity }))
      .min(1)
      .max(100),
  })
  .refine(
    (x) => new Set(x.lines.map((l) => l.ingredientId)).size === x.lines.length,
    'Ingrediente repetido',
  );
const base = { idempotencyKey: z.uuid(), description: z.string().trim().min(1).max(300) };
export const entrySchema = z.discriminatedUnion('kind', [
  z.object({
    ...base,
    kind: z.literal('purchase'),
    lines: z
      .array(z.object({ ingredientId: z.uuid(), quantity, totalCents: cents.positive() }))
      .min(1)
      .max(100),
  }),
  z.object({
    ...base,
    kind: z.literal('sale'),
    expectedTotalCents: cents,
    payment: z.enum(['cash', 'card', 'transfer']),
    lines: z
      .array(
        z.object({ productId: z.string().min(1), quantity: z.number().int().positive().max(1000) }),
      )
      .min(1)
      .max(100),
  }),
  z.object({ ...base, kind: z.literal('waste'), ingredientId: z.uuid(), quantity }),
  z.object({ ...base, kind: z.literal('expense'), totalCents: cents.positive() }),
]);

export async function saveRecipe(sql: Sql, input: z.infer<typeof recipeSchema>) {
  return sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(824612)`;
    const products = await tx`select id from products where id=${input.productId} for update`;
    if (!products.length) throw new OrderError(404, 'Producto inexistente.');
    for (const line of input.lines) {
      const found = await tx`select id from stock_ingredients where id=${line.ingredientId}`;
      if (!found.length) throw new OrderError(400, 'Ingrediente inexistente.');
    }
    await tx`insert into product_recipes(product_id,target_margin,overhead_cents)
      values(${input.productId},${input.targetMargin},${input.overheadCents})
      on conflict(product_id) do update set target_margin=excluded.target_margin, overhead_cents=excluded.overhead_cents`;
    await tx`delete from recipe_lines where product_id=${input.productId}`;
    for (const line of input.lines)
      await tx`insert into recipe_lines values(${input.productId},${line.ingredientId},${line.quantity})`;
    await tx`update products set price_cents=${input.priceCents},updated_at=now() where id=${input.productId}`;
    return { saved: true };
  });
}

export async function recordEntry(sql: Sql, input: z.infer<typeof entrySchema>, deviceId: string) {
  return sql.begin(async (tx) => {
    // A single lock orders inventory mutations and idempotency checks across devices.
    await tx`select pg_advisory_xact_lock(824612)`;
    const previous =
      await tx`select *, (request_payload=${tx.json(input)}::jsonb and device_id=${deviceId}) as same_request from business_entries where idempotency_key=${input.idempotencyKey}`;
    if (previous.length) {
      if (!previous[0]!.same_request)
        throw new OrderError(409, 'Esta clave ya pertenece a otra operación.');
      return { entry: previous[0], reused: true };
    }
    const snapshots: Record<string, unknown>[] = [];
    const movements: {
      id: string;
      quantity: string | number;
      value: string | number;
      stockAfter: string | number;
      valueAfter: string | number;
      type: 'purchase' | 'sale' | 'waste';
    }[] = [];
    let total = 0;
    let cost = 0;
    if (input.kind === 'purchase') {
      for (const line of input.lines) {
        const rows = await tx`update stock_ingredients set stock=stock+${line.quantity},
          value_cents=value_cents+${line.totalCents}, last_cost=${line.totalCents}::numeric/${line.quantity}
          where id=${line.ingredientId} returning name, unit, stock::text as stock_after, value_cents::text as value_after`;
        if (!rows[0]) throw new OrderError(404, 'Ingrediente inexistente.');
        total += line.totalCents;
        snapshots.push({ ...line, ...rows[0] });
        movements.push({
          id: line.ingredientId,
          quantity: line.quantity,
          value: line.totalCents,
          stockAfter: rows[0].stock_after,
          valueAfter: rows[0].value_after,
          type: 'purchase',
        });
      }
    }
    if (input.kind === 'sale') {
      for (const line of input.lines) {
        const products =
          await tx`select p.*,r.overhead_cents from products p left join product_recipes r on r.product_id=p.id
          where p.id=${line.productId} for update of p`;
        const product = products[0];
        if (!product || !product.available) throw new OrderError(400, 'Producto no disponible.');
        const recipe =
          await tx`select l.*,i.name,i.unit from recipe_lines l join stock_ingredients i on i.id=l.ingredient_id where product_id=${line.productId} order by ingredient_id`;
        if (!recipe.length) throw new OrderError(409, `Falta la receta de ${product.name}.`);
        const ingredients: Record<string, unknown>[] = [];
        for (const ingredient of recipe) {
          const consumed = await tx`with before as (
            select *, ${ingredient.quantity}::numeric*${line.quantity} as needed from stock_ingredients where id=${ingredient.ingredient_id} for update
          ) update stock_ingredients i set stock=b.stock-b.needed,
            value_cents=greatest(0,b.value_cents-(b.value_cents/nullif(b.stock,0))*b.needed)
            from before b where i.id=b.id and b.stock-b.reserved>=b.needed and b.stock>0 and b.last_cost is not null
            returning b.needed::text as quantity, (b.value_cents/b.stock*b.needed)::text as cost,
              i.stock::text as stock_after, i.value_cents::text as value_after`;
          if (!consumed[0])
            throw new OrderError(409, `Existencia o costo insuficiente: ${ingredient.name}.`);
          ingredients.push({
            ingredientId: ingredient.ingredient_id,
            name: ingredient.name,
            unit: ingredient.unit,
            ...consumed[0],
          });
          movements.push({
            id: ingredient.ingredient_id,
            quantity: `-${consumed[0].quantity}`,
            value: `-${consumed[0].cost}`,
            stockAfter: consumed[0].stock_after,
            valueAfter: consumed[0].value_after,
            type: 'sale',
          });
        }
        const [costRow] =
          await tx`select round(sum((item->>'cost')::numeric) + ${product.overhead_cents}::numeric * ${line.quantity})::int as cost from jsonb_array_elements(${tx.json(ingredients as JSONValue)}::jsonb) item`;
        const lineCost = Number(costRow!.cost);
        const lineTotal = product.price_cents * line.quantity;
        cost += lineCost;
        total += lineTotal;
        snapshots.push({
          ...line,
          name: product.name,
          unitPriceCents: product.price_cents,
          totalCents: lineTotal,
          costCents: lineCost,
          ingredients,
        });
      }
    }
    if (input.kind === 'waste') {
      const rows =
        await tx`with before as (select * from stock_ingredients where id=${input.ingredientId} for update)
        update stock_ingredients i set stock=b.stock-${input.quantity},
        value_cents=greatest(0,b.value_cents-b.value_cents/nullif(b.stock,0)*${input.quantity})
        from before b where i.id=b.id and b.stock-b.reserved>=${input.quantity} and b.stock>0
        returning b.name, (b.value_cents/b.stock*${input.quantity})::text as cost,
          i.stock::text as stock_after, i.value_cents::text as value_after`;
      if (!rows[0]) throw new OrderError(409, 'Existencia insuficiente.');
      cost = Math.round(Number(rows[0].cost));
      snapshots.push({ ingredientId: input.ingredientId, quantity: input.quantity, ...rows[0] });
      movements.push({
        id: input.ingredientId,
        quantity: -input.quantity,
        value: `-${rows[0].cost}`,
        stockAfter: rows[0].stock_after,
        valueAfter: rows[0].value_after,
        type: 'waste',
      });
    }
    if (input.kind === 'expense') total = input.totalCents;
    if (input.kind === 'sale' && total !== input.expectedTotalCents)
      throw new OrderError(
        409,
        'El precio cambió. Actualiza el catálogo y confirma el nuevo total antes de cobrar.',
      );
    if (total > 100000000 || cost > 100000000)
      throw new OrderError(400, 'El importe excede el máximo por operación.');
    const [entry] =
      await tx`insert into business_entries(idempotency_key,request_payload,kind,description,payment,total_cents,cost_cents,lines,device_id)
      values(${input.idempotencyKey},${tx.json(input)},${input.kind},${input.description},${input.kind === 'sale' ? input.payment : ''},${total},${cost},${tx.json(snapshots as JSONValue)},${deviceId}) returning *`;
    for (const m of movements) {
      await tx`insert into stock_movements(entry_id,ingredient_id,quantity,value_cents) values(${entry!.id},${m.id},${m.quantity},${m.value})`;
      await appendMovement(tx as unknown as Sql, {
        ingredientId: m.id,
        businessEntryId: entry!.id,
        type: m.type,
        quantityDelta: String(m.quantity),
        valueDeltaCents: String(m.value),
        stockAfter: String(m.stockAfter),
        valueAfterCents: String(m.valueAfter),
        reason: input.description,
        actor: { kind: 'device', deviceId, origin: 'android' },
      });
    }
    return { entry, reused: false };
  });
}

export async function businessState(sql: Sql, from: string, to: string) {
  // One consistent snapshot keeps stock, recipes and reports aligned.
  return sql.begin('isolation level repeatable read read only', async (tx) => {
    const ingredients =
      await tx`select *, case when stock>0 then value_cents/stock else last_cost end as unit_cost from stock_ingredients order by name`;
    const products = await tx<
      {
        id: string;
        name: string;
        price_cents: number;
        available: boolean;
        target_margin: number | null;
        overhead_cents: number | null;
        cost_cents: number | null;
      }[]
    >`select p.id,p.name,p.price_cents,p.available,r.target_margin,r.overhead_cents,
      case when count(l.ingredient_id)=0 or count(i.last_cost)<count(l.ingredient_id) then null
      else round(sum(l.quantity*case when i.stock>0 then i.value_cents/i.stock else i.last_cost end)+r.overhead_cents)::int end as cost_cents
      from products p left join product_recipes r on r.product_id=p.id left join recipe_lines l on l.product_id=p.id
      left join stock_ingredients i on i.id=l.ingredient_id group by p.id,r.target_margin,r.overhead_cents order by p.sort_order,p.name`;
    const recipes = await tx`select * from recipe_lines order by product_id,ingredient_id`;
    const entries =
      await tx`select * from business_entries where created_at>=${from}::timestamptz and created_at<${to}::timestamptz order by created_at desc limit 200`;
    const [report] = await tx`select count(*) filter(where kind='sale')::int as sales_count,
      coalesce(sum(total_cents) filter(where kind='sale'),0)::text as revenue_cents,
      coalesce(sum(cost_cents) filter(where kind='sale'),0)::text as cost_cents,
      coalesce(sum(total_cents) filter(where kind='purchase'),0)::text as purchases_cents,
      coalesce(sum(total_cents) filter(where kind='expense'),0)::text as expenses_cents,
      coalesce(sum(cost_cents) filter(where kind='waste'),0)::text as waste_cents
      from business_entries where created_at>=${from}::timestamptz and created_at<${to}::timestamptz`;
    return {
      ingredients,
      products: products.map((p) => ({
        ...p,
        recommended_price_cents:
          p.cost_cents === null || p.target_margin === null
            ? null
            : Math.ceil((p.cost_cents * 100) / (100 - p.target_margin)),
        margin_percent:
          p.cost_cents === null || !p.price_cents
            ? null
            : ((p.price_cents - p.cost_cents) / p.price_cents) * 100,
      })),
      recipes,
      entries,
      report,
      from,
      to,
    };
  });
}

import type { ReportPeriod } from '@bj/contracts';
import type { Sql } from 'postgres';

type Row = Record<string, unknown>;
const iso = (value: Date | string) => new Date(value).toISOString();

type ProductFact = {
  id: string;
  orderId: string;
  productId: string;
  name: string;
  quantity: number;
  weight: number;
  orderTotal: number;
};
function allocateCents(totalCents: number, facts: ProductFact[]) {
  const totalWeight = facts.reduce((sum, fact) => sum + BigInt(Math.max(0, fact.weight)), 0n);
  if (!totalWeight)
    return [] as Array<{ productId: string; name: string; quantity: number; amount: number }>;
  const amount = BigInt(totalCents);
  const parts = facts.map((fact) => {
    const numerator = amount * BigInt(Math.max(0, fact.weight));
    return { fact, cents: numerator / totalWeight, remainder: numerator % totalWeight };
  });
  let remaining = amount - parts.reduce((sum, part) => sum + part.cents, 0n);
  for (const part of [...parts].sort((left, right) =>
    left.remainder === right.remainder
      ? left.fact.id.localeCompare(right.fact.id)
      : left.remainder > right.remainder
        ? -1
        : 1,
  )) {
    if (remaining <= 0n) break;
    part.cents += 1n;
    remaining -= 1n;
  }
  return parts.map(({ fact, cents }) => ({
    productId: fact.productId,
    name: fact.name,
    quantity: fact.quantity,
    amount: Number(cents),
  }));
}

/** Reads every component of a report from one repeatable-read snapshot. Dates are
 * local calendar days in Mexico City and the upper bound is exclusive. */
export async function profitabilityReport(sql: Sql, input: ReportPeriod) {
  const page = input.page;
  const pageSize = input.pageSize;
  const offset = (page - 1) * pageSize;
  return sql.begin(async (tx) => {
    await tx`set transaction isolation level repeatable read read only`;
    const bounds = await tx<{ from_at: Date; to_at: Date }[]>`
      select (${input.from}::date::timestamp at time zone 'America/Mexico_City') as from_at,
        ((${input.to}::date + 1)::timestamp at time zone 'America/Mexico_City') as to_at`;
    const from = bounds[0]!.from_at;
    const to = bounds[0]!.to_at;
    const [
      orders,
      refunds,
      sold,
      commissions,
      expenses,
      waste,
      pendingCost,
      cashCollected,
      cashRefunded,
      cashIn,
      cashOut,
      unvaluedOrders,
      totalRows,
    ] = await Promise.all([
      tx<
        { count: number; amount: number }[]
      >`select count(*)::int as count,coalesce(sum(total_cents),0)::int as amount from orders where delivered_at>=${from} and delivered_at<${to}`,
      tx<
        { amount: number }[]
      >`select coalesce(sum(amount_cents),0)::int as amount from order_refunds where created_at>=${from} and created_at<${to}`,
      tx<
        { amount: number }[]
      >`select coalesce(sum(cost_cents),0)::int as amount from order_cost_allocations where classification='sold' and classified_at>=${from} and classified_at<${to}`,
      tx<
        { amount: number }[]
      >`select coalesce(sum(amount_cents),0)::int as amount from operating_expenses where category='commission' and incurred_at>=${from} and incurred_at<${to}`,
      tx<
        { amount: number }[]
      >`select coalesce(sum(amount_cents),0)::int as amount from operating_expenses where category<>'commission' and incurred_at>=${from} and incurred_at<${to}`,
      tx<
        { amount: number }[]
      >`select coalesce(sum(cost_cents),0)::int as amount from order_cost_allocations where classification='waste' and classified_at>=${from} and classified_at<${to}`,
      tx<
        { amount: number }[]
      >`select coalesce(sum(cost_cents),0)::int as amount from order_cost_allocations where classification='pending' and created_at>=${from} and created_at<${to}`,
      tx<
        { amount: number }[]
      >`select coalesce(sum(applied_cents),0)::int as amount from order_payments where method='cash' and created_at>=${from} and created_at<${to}`,
      tx<
        { amount: number }[]
      >`select coalesce(sum(amount_cents),0)::int as amount from order_refunds where method='cash' and created_at>=${from} and created_at<${to}`,
      tx<
        { amount: number }[]
      >`select coalesce(sum(amount_cents),0)::int as amount from cash_movements where amount_cents>0 and created_at>=${from} and created_at<${to}`,
      tx<
        { amount: number }[]
      >`select coalesce(sum(-amount_cents),0)::int as amount from cash_movements where amount_cents<0 and created_at>=${from} and created_at<${to}`,
      tx<
        { count: number }[]
      >`select count(*)::int as count from orders o where o.delivered_at>=${from} and o.delivered_at<${to} and not exists(select 1 from order_cost_allocations a where a.order_id=o.id)`,
      tx<{ count: number }[]>`select count(*)::int as count from (
          select id from orders where delivered_at>=${from} and delivered_at<${to}
          union all select id from order_refunds where created_at>=${from} and created_at<${to}
          union all select id from operating_expenses where incurred_at>=${from} and incurred_at<${to}
          union all select id from cash_movements where created_at>=${from} and created_at<${to}
          union all select id from order_cost_allocations where classification='waste' and classified_at>=${from} and classified_at<${to}
        ) detail_rows`,
    ]);
    const fulfillment = await tx<{ key: string; orders: number; amount: number }[]>`
      select fulfillment as key,count(*)::int as orders,coalesce(sum(total_cents),0)::int as amount
      from orders where delivered_at>=${from} and delivered_at<${to} group by fulfillment order by fulfillment`;
    const refundsByFulfillment = await tx<{ key: string; amount: number }[]>`
      select o.fulfillment as key,coalesce(sum(r.amount_cents),0)::int as amount
      from order_refunds r join orders o on o.id=r.order_id
      where r.created_at>=${from} and r.created_at<${to} group by o.fulfillment`;
    const payment = await tx<{ key: string; amount: number }[]>`
      select method as key,coalesce(sum(applied_cents),0)::int as amount from order_payments
      where created_at>=${from} and created_at<${to} group by method order by method`;
    const productFacts = await tx<ProductFact[]>`
      select i.id::text,i.order_id::text as "orderId",i.product_id as "productId",i.product_name as name,i.quantity,
        i.line_total_cents as weight,o.total_cents as "orderTotal"
      from order_items i join orders o on o.id=i.order_id
      where o.delivered_at>=${from} and o.delivered_at<${to} order by o.id,i.id`;
    const refundFacts = await tx<Array<ProductFact & { refundCents: number; refundId: string }>>`
      select i.id::text,r.id::text as "refundId",i.order_id::text as "orderId",i.product_id as "productId",i.product_name as name,i.quantity,
        i.line_total_cents as weight,o.total_cents as "orderTotal",r.amount_cents as "refundCents"
      from order_refunds r join orders o on o.id=r.order_id
      join order_items i on i.order_id=o.id and (r.order_item_id is null or i.id=r.order_item_id)
      where r.created_at>=${from} and r.created_at<${to} order by r.id,i.id`;
    const detail = await tx<Row[]>`
      select occurred_at,kind,id,description,amount_cents,cost_cents,method from (
        select o.delivered_at as occurred_at,'sale'::text as kind,o.id::text as id,
          coalesce(nullif(o.customer_name,''),'Comanda') as description,o.total_cents as amount_cents,
          coalesce((select sum(a.cost_cents) from order_cost_allocations a where a.order_id=o.id and a.classification='sold'),0)::int as cost_cents,''::text as method
          from orders o where o.delivered_at>=${from} and o.delivered_at<${to}
        union all
        select r.created_at,'refund',r.id::text,'Devolución · '||r.reason,-r.amount_cents,0,r.method
          from order_refunds r where r.created_at>=${from} and r.created_at<${to}
        union all
        select e.incurred_at,'expense',e.id::text,e.description,-e.amount_cents,0,e.payment_method
          from operating_expenses e where e.incurred_at>=${from} and e.incurred_at<${to}
        union all
        select m.created_at,'cash_movement',m.id::text,m.reason,m.amount_cents,0,''::text
          from cash_movements m where m.created_at>=${from} and m.created_at<${to}
        union all
        select a.classified_at,'waste',a.id::text,'Merma de comanda',0,-a.cost_cents, ''::text
          from order_cost_allocations a where a.classification='waste' and a.classified_at>=${from} and a.classified_at<${to}
      ) rows order by occurred_at desc,id desc limit ${pageSize} offset ${offset}`;
    const gross = orders[0]?.amount ?? 0;
    const refundTotal = refunds[0]?.amount ?? 0;
    const cost = sold[0]?.amount ?? 0;
    const commission = commissions[0]?.amount ?? 0;
    const operating = expenses[0]?.amount ?? 0;
    const wasteTotal = waste[0]?.amount ?? 0;
    const productTotals = new Map<string, { key: string; quantity: number; amountCents: number }>();
    const groupedSales = new Map<string, ProductFact[]>();
    for (const fact of productFacts)
      groupedSales.set(fact.orderId, [...(groupedSales.get(fact.orderId) ?? []), fact]);
    for (const facts of groupedSales.values()) {
      const allocated = allocateCents(facts[0]!.orderTotal, facts);
      for (const part of allocated) {
        const row = productTotals.get(part.productId) ?? {
          key: part.name,
          quantity: 0,
          amountCents: 0,
        };
        row.quantity += part.quantity;
        row.amountCents += part.amount;
        productTotals.set(part.productId, row);
      }
    }
    const refundsByOrder = new Map<
      string,
      Array<ProductFact & { refundCents: number; refundId: string }>
    >();
    for (const fact of refundFacts)
      refundsByOrder.set(fact.refundId, [...(refundsByOrder.get(fact.refundId) ?? []), fact]);
    for (const facts of refundsByOrder.values()) {
      const allocated = allocateCents(facts[0]!.refundCents, facts);
      for (const part of allocated) {
        const row = productTotals.get(part.productId) ?? {
          key: part.name,
          quantity: 0,
          amountCents: 0,
        };
        row.amountCents -= part.amount;
        productTotals.set(part.productId, row);
      }
    }
    const refundAmountsByFulfillment = new Map(
      refundsByFulfillment.map((row) => [row.key, row.amount]),
    );
    const fulfillmentKeys = new Set([
      ...fulfillment.map((row) => row.key),
      ...refundAmountsByFulfillment.keys(),
    ]);
    const netFulfillment = [...fulfillmentKeys].map((key) => {
      const gross = fulfillment.find((row) => row.key === key);
      return {
        key,
        orders: gross?.orders ?? 0,
        amountCents: (gross?.amount ?? 0) - (refundAmountsByFulfillment.get(key) ?? 0),
      };
    });
    return {
      from: iso(from),
      to: iso(to),
      page,
      pageSize,
      totalRows: totalRows[0]?.count ?? 0,
      summary: {
        deliveredOrders: orders[0]?.count ?? 0,
        grossSalesCents: gross,
        refundsCents: refundTotal,
        netSalesCents: gross - refundTotal,
        costOfGoodsSoldCents: cost,
        grossProfitCents: gross - refundTotal - cost,
        commissionsCents: commission,
        operatingExpensesCents: operating,
        wasteCents: wasteTotal,
        operatingResultCents: gross - refundTotal - cost - commission - operating - wasteTotal,
        cashCollectedCents: cashCollected[0]?.amount ?? 0,
        cashRefundedCents: cashRefunded[0]?.amount ?? 0,
        cashFlowInCents: cashIn[0]?.amount ?? 0,
        cashFlowOutCents: cashOut[0]?.amount ?? 0,
        pendingCostCents: pendingCost[0]?.amount ?? 0,
        unvaluedDeliveredOrders: unvaluedOrders[0]?.count ?? 0,
      },
      byFulfillment: netFulfillment,
      byPayment: payment.map((row) => ({ key: row.key, amountCents: row.amount })),
      byProduct: [...productTotals.values()].sort(
        (left, right) => right.amountCents - left.amountCents || left.key.localeCompare(right.key),
      ),
      rows: detail.map((row) => ({
        occurredAt: iso(row.occurred_at as Date | string),
        kind: row.kind as 'sale' | 'refund' | 'expense' | 'waste' | 'cash_movement',
        id: row.id as string,
        description: row.description as string,
        amountCents: Number(row.amount_cents),
        costCents: Number(row.cost_cents),
        method: row.method as string,
      })),
    };
  });
}

/** Export an unpaged CSV from the exact same consistent report snapshot. */
export async function profitabilityCsv(sql: Sql, input: Omit<ReportPeriod, 'page' | 'pageSize'>) {
  const report = await profitabilityReport(sql, { ...input, page: 1, pageSize: 10_000_000 });
  const lines = [
    ['fecha', 'tipo', 'id', 'descripcion', 'importe_centavos', 'costo_centavos', 'medio'].join(','),
    ...report.rows.map((row) =>
      [
        row.occurredAt,
        row.kind,
        row.id,
        row.description,
        row.amountCents,
        row.costCents,
        row.method,
      ]
        .map((value) => `"${String(value).replaceAll('"', '""')}"`)
        .join(','),
    ),
  ];
  return lines.join('\r\n');
}

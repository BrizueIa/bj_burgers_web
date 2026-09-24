import type {
  AuthenticatedActor,
  CounterCheckout,
  Order,
  OrderPaymentCreate,
  OrderRefundCreate,
} from '@bj/contracts';
import type { Sql } from 'postgres';
import { auditOperation, PosFoundationError, runIdempotent } from './pos-foundation-service.js';
import { updateOrderStatusInTransaction, type OrderNotifier } from './order-service.js';

export async function checkoutCounterOrder(
  sql: Sql,
  orderId: string,
  input: CounterCheckout,
  actor: AuthenticatedActor,
  notifier: OrderNotifier,
) {
  const actorIds =
    actor.kind === 'device'
      ? { deviceId: actor.deviceId, userId: null }
      : { deviceId: null, userId: actor.userId };
  const outcome = await runIdempotent(
    sql,
    {
      idempotencyKey: input.idempotencyKey,
      operation: 'order.counter.checkout',
      request: { orderId, ...input },
      actor,
    },
    async (tx) => {
      const [order] = await tx<
        { total_cents: number; status: string; fulfillment: string }[]
      >`select total_cents,status,fulfillment from orders where id=${orderId} for update`;
      if (!order) throw new PosFoundationError(404, 'La comanda no existe.');
      if (order.fulfillment !== 'counter' || order.status !== 'ready')
        throw new PosFoundationError(
          409,
          'Sólo se puede cobrar y entregar en mostrador una comanda lista.',
        );
      const [totals] = await tx<
        { paid: number; refunded: number }[]
      >`select coalesce((select sum(applied_cents) from order_payments where order_id=${orderId}),0)::int as paid,coalesce((select sum(amount_cents) from order_refunds where order_id=${orderId}),0)::int as refunded`;
      const due = order.total_cents - totals!.paid + totals!.refunded;
      const applied = input.payments.reduce((sum, payment) => sum + payment.appliedCents, 0);
      if (due <= 0 || applied !== due)
        throw new PosFoundationError(
          409,
          'El cobro debe cubrir exactamente el saldo antes de entregar.',
        );
      const [activeSession] = await tx<
        { id: string; expected_cents: number }[]
      >`select id,expected_cents from cash_sessions where status='open' for update`;
      if (!activeSession)
        throw new PosFoundationError(409, 'Abre un turno de caja antes de registrar cobros.');
      let expectedCash = activeSession.expected_cents;
      let change = 0;
      for (const payment of input.payments) {
        const session = activeSession.id;
        if (payment.method === 'cash') {
          change += payment.receivedCents - payment.appliedCents;
          expectedCash += payment.appliedCents;
          await tx`update cash_sessions set expected_cents=${expectedCash} where id=${session}`;
          await tx`insert into cash_movements(cash_session_id,idempotency_key,kind,amount_cents,reason,created_by_device_id,created_by_user_id) values(${session},gen_random_uuid(),'income',${payment.appliedCents},'Cobro de comanda de mostrador',${actorIds.deviceId},${actorIds.userId})`;
        }
        await tx`insert into order_payments(order_id,cash_session_id,idempotency_key,method,received_cents,applied_cents,change_cents,created_by_device_id,created_by_user_id) values(${orderId},${session},gen_random_uuid(),${payment.method},${payment.receivedCents},${payment.appliedCents},${payment.receivedCents - payment.appliedCents},${actorIds.deviceId},${actorIds.userId})`;
      }
      const delivered = await updateOrderStatusInTransaction(
        tx as unknown as Sql,
        orderId,
        'delivered',
        'Cobro y entrega en mostrador',
        actor,
      );
      if (!delivered) throw new PosFoundationError(500, 'No fue posible entregar la comanda.');
      await auditOperation(tx, actor, {
        action: 'checkout',
        entity: 'counter_order',
        entityId: orderId,
        idempotencyKey: input.idempotencyKey,
        details: { appliedCents: applied, changeCents: change },
      });
      return { order: delivered, changeCents: change } as unknown as Record<string, never>;
    },
  );
  if (!outcome.reused) notifier.publish(orderId);
  return {
    order: (outcome.result as unknown as { order: Order }).order,
    changeCents: (outcome.result as unknown as { changeCents: number }).changeCents,
    reused: outcome.reused,
  };
}
export async function collectOrderPayment(
  sql: Sql,
  orderId: string,
  input: OrderPaymentCreate,
  actor: AuthenticatedActor,
) {
  return runIdempotent(
    sql,
    {
      idempotencyKey: input.idempotencyKey,
      operation: 'order.payment.collect',
      request: { orderId, ...input },
      actor,
    },
    async (tx) => {
      const [order] = await tx<
        { total_cents: number; status: string }[]
      >`select total_cents,status from orders where id=${orderId} for update`;
      if (!order) throw new PosFoundationError(404, 'La comanda no existe.');
      if (order.status === 'cancelled' || order.status === 'delivered')
        throw new PosFoundationError(409, 'No se puede cobrar una comanda cancelada o entregada.');
      const [totals] = await tx<
        { paid: number; refunded: number }[]
      >`select coalesce((select sum(applied_cents) from order_payments where order_id=${orderId}),0)::int as paid,coalesce((select sum(amount_cents) from order_refunds where order_id=${orderId}),0)::int as refunded`;
      const applied = input.payments.reduce((n, p) => n + p.appliedCents, 0);
      if (applied > order.total_cents - totals!.paid + totals!.refunded)
        throw new PosFoundationError(409, 'El importe aplicado supera el saldo de la comanda.');
      const [activeSession] = await tx<
        { id: string; expected_cents: number }[]
      >`select id,expected_cents from cash_sessions where status='open' for update`;
      if (!activeSession)
        throw new PosFoundationError(409, 'Abre un turno de caja antes de registrar cobros.');
      let expectedCash = activeSession.expected_cents;
      let change = 0;
      for (const p of input.payments) {
        const session = activeSession.id;
        if (p.method === 'cash') {
          change += p.receivedCents - p.appliedCents;
          expectedCash += p.appliedCents;
          await tx`update cash_sessions set expected_cents=${expectedCash} where id=${session}`;
          await tx`insert into cash_movements(cash_session_id,idempotency_key,kind,amount_cents,reason,created_by_device_id,created_by_user_id) values(${session},gen_random_uuid(),'income',${p.appliedCents},'Cobro de comanda',${actor.kind === 'device' ? actor.deviceId : null},${actor.kind === 'admin' ? actor.userId : null})`;
        }
        await tx`insert into order_payments(order_id,cash_session_id,idempotency_key,method,received_cents,applied_cents,change_cents,created_by_device_id,created_by_user_id) values(${orderId},${session},gen_random_uuid(),${p.method},${p.receivedCents},${p.appliedCents},${p.receivedCents - p.appliedCents},${actor.kind === 'device' ? actor.deviceId : null},${actor.kind === 'admin' ? actor.userId : null})`;
      }
      await auditOperation(tx, actor, {
        action: 'collect',
        entity: 'order_payment',
        entityId: orderId,
        idempotencyKey: input.idempotencyKey,
        details: { appliedCents: applied, changeCents: change },
      });
      return {
        orderId,
        appliedCents: applied,
        changeCents: change,
        balanceCents: order.total_cents - totals!.paid + totals!.refunded - applied,
      };
    },
  );
}
export async function refundOrderPayment(
  sql: Sql,
  orderId: string,
  input: OrderRefundCreate,
  actor: AuthenticatedActor,
) {
  return runIdempotent(
    sql,
    {
      idempotencyKey: input.idempotencyKey,
      operation: 'order.refund.create',
      request: {
        orderId,
        idempotencyKey: input.idempotencyKey,
        paymentId: input.paymentId,
        ...(input.orderItemId ? { orderItemId: input.orderItemId } : {}),
        amountCents: input.amountCents,
        reason: input.reason,
      },
      actor,
    },
    async (tx) => {
      const [order] = await tx<{ subtotal_cents: number }[]>`
        select subtotal_cents from orders where id=${orderId} for update
      `;
      if (!order) throw new PosFoundationError(404, 'La comanda no existe.');
      const [payment] = await tx<
        { method: 'cash' | 'card' | 'transfer'; applied_cents: number }[]
      >`select method,applied_cents from order_payments where id=${input.paymentId} and order_id=${orderId} for update`;
      if (!payment) throw new PosFoundationError(404, 'El pago original no existe.');
      const [used] = await tx<
        { amount: number }[]
      >`select coalesce(sum(amount_cents),0)::int as amount from order_refunds where payment_id=${input.paymentId}`;
      if (input.amountCents > payment.applied_cents - used!.amount)
        throw new PosFoundationError(409, 'El reembolso supera el saldo disponible del pago.');
      if (input.orderItemId) {
        const items = await tx<{ id: string; line_total_cents: number }[]>`
          select id,line_total_cents from order_items where order_id=${orderId} order by id
        `;
        const selected = items.find((item) => item.id === input.orderItemId);
        if (!selected) throw new PosFoundationError(404, 'La partida no pertenece a la comanda.');
        const lineTotal = items.reduce((sum, item) => sum + item.line_total_cents, 0);
        if (lineTotal <= 0 || order.subtotal_cents <= 0)
          throw new PosFoundationError(
            409,
            'La comanda no tiene importe reembolsable por partida.',
          );
        const total = BigInt(order.subtotal_cents);
        const denominator = BigInt(lineTotal);
        const allocations = items.map((item) => {
          const numerator = total * BigInt(item.line_total_cents);
          return {
            id: item.id,
            cents: Number(numerator / denominator),
            remainder: numerator % denominator,
          };
        });
        let remaining =
          order.subtotal_cents - allocations.reduce((sum, item) => sum + item.cents, 0);
        for (const item of [...allocations].sort(
          (a, b) =>
            (a.remainder === b.remainder ? 0 : a.remainder > b.remainder ? -1 : 1) ||
            a.id.localeCompare(b.id),
        )) {
          if (remaining-- <= 0) break;
          const allocation = allocations.find((entry) => entry.id === item.id)!;
          allocation.cents += 1;
        }
        const itemCap = allocations.find((item) => item.id === selected.id)!.cents;
        const [itemRefunded] = await tx<{ amount: number }[]>`
          select coalesce(sum(amount_cents),0)::int as amount
          from order_refunds where order_item_id=${input.orderItemId}
        `;
        if (input.amountCents > itemCap - itemRefunded!.amount)
          throw new PosFoundationError(
            409,
            'El reembolso supera el importe pendiente de esta partida.',
          );
      }
      const [row] = await tx<
        { id: string; expected_cents: number }[]
      >`select id,expected_cents from cash_sessions where status='open' for update`;
      if (!row)
        throw new PosFoundationError(409, 'Abre un turno de caja antes de registrar reembolsos.');
      const session: string = row.id;
      if (payment.method === 'cash') {
        if (row.expected_cents < input.amountCents)
          throw new PosFoundationError(
            409,
            'No hay efectivo esperado suficiente en el turno actual.',
          );
        const cashDelta = -input.amountCents;
        await tx`update cash_sessions set expected_cents=${row.expected_cents + cashDelta} where id=${row.id}`;
        await tx`insert into cash_movements(cash_session_id,idempotency_key,kind,amount_cents,reason,created_by_device_id,created_by_user_id) values(${row.id},gen_random_uuid(),'expense',${cashDelta},'Reembolso de comanda',${actor.kind === 'device' ? actor.deviceId : null},${actor.kind === 'admin' ? actor.userId : null})`;
      }
      const [refund] = await tx<
        { id: string }[]
      >`insert into order_refunds(order_id,payment_id,order_item_id,cash_session_id,idempotency_key,method,amount_cents,reason,created_by_device_id,created_by_user_id) values(${orderId},${input.paymentId},${input.orderItemId ?? null},${session},${input.idempotencyKey},${payment.method},${input.amountCents},${input.reason},${actor.kind === 'device' ? actor.deviceId : null},${actor.kind === 'admin' ? actor.userId : null}) returning id`;
      await auditOperation(tx, actor, {
        action: 'refund',
        entity: 'order_payment',
        entityId: refund!.id,
        reason: input.reason,
        idempotencyKey: input.idempotencyKey,
        details: {
          orderId,
          paymentId: input.paymentId,
          ...(input.orderItemId ? { orderItemId: input.orderItemId } : {}),
          amountCents: input.amountCents,
        },
      });
      return { orderId, refundedCents: input.amountCents, method: payment.method };
    },
  );
}

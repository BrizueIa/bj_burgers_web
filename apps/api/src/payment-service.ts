import type { AuthenticatedActor, OrderPaymentCreate, OrderRefundCreate } from '@bj/contracts';
import type { Sql } from 'postgres';
import { auditOperation, PosFoundationError, runIdempotent } from './pos-foundation-service.js';
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
        { total_cents: number }[]
      >`select total_cents from orders where id=${orderId} for update`;
      if (!order) throw new PosFoundationError(404, 'La comanda no existe.');
      const [totals] = await tx<
        { paid: number; refunded: number }[]
      >`select coalesce((select sum(applied_cents) from order_payments where order_id=${orderId}),0)::int as paid,coalesce((select sum(amount_cents) from order_refunds where order_id=${orderId}),0)::int as refunded`;
      const applied = input.payments.reduce((n, p) => n + p.appliedCents, 0);
      if (applied > order.total_cents - totals!.paid + totals!.refunded)
        throw new PosFoundationError(409, 'El importe aplicado supera el saldo de la comanda.');
      let change = 0;
      for (const p of input.payments) {
        let session: string | null = null;
        if (p.method === 'cash') {
          const [row] = await tx<
            { id: string; expected_cents: number }[]
          >`select id,expected_cents from cash_sessions where status='open' for update`;
          if (!row)
            throw new PosFoundationError(409, 'Abre un turno de caja antes de cobrar en efectivo.');
          session = row.id;
          change += p.receivedCents - p.appliedCents;
          await tx`update cash_sessions set expected_cents=expected_cents+${p.appliedCents} where id=${row.id}`;
          await tx`insert into cash_movements(cash_session_id,idempotency_key,kind,amount_cents,reason,created_by_device_id) values(${row.id},gen_random_uuid(),'income',${p.appliedCents},'Cobro de comanda',${actor.kind === 'device' ? actor.deviceId : null})`;
        }
        await tx`insert into order_payments(order_id,cash_session_id,idempotency_key,method,received_cents,applied_cents,change_cents,created_by_device_id) values(${orderId},${session},gen_random_uuid(),${p.method},${p.receivedCents},${p.appliedCents},${p.receivedCents - p.appliedCents},${actor.kind === 'device' ? actor.deviceId : null})`;
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
      request: { orderId, ...input },
      actor,
    },
    async (tx) => {
      const [payment] = await tx<
        { method: 'cash' | 'card' | 'transfer'; applied_cents: number }[]
      >`select method,applied_cents from order_payments where id=${input.paymentId} and order_id=${orderId} for update`;
      if (!payment) throw new PosFoundationError(404, 'El pago original no existe.');
      const [used] = await tx<
        { amount: number }[]
      >`select coalesce(sum(amount_cents),0)::int as amount from order_refunds where payment_id=${input.paymentId}`;
      if (input.amountCents > payment.applied_cents - used!.amount)
        throw new PosFoundationError(409, 'El reembolso supera el saldo disponible del pago.');
      let session: string | null = null;
      if (payment.method === 'cash') {
        const [row] = await tx<
          { id: string; expected_cents: number }[]
        >`select id,expected_cents from cash_sessions where status='open' for update`;
        if (!row || row.expected_cents < input.amountCents)
          throw new PosFoundationError(
            409,
            'No hay efectivo esperado suficiente en el turno actual.',
          );
        session = row.id;
        await tx`update cash_sessions set expected_cents=expected_cents-${input.amountCents} where id=${row.id}`;
        await tx`insert into cash_movements(cash_session_id,idempotency_key,kind,amount_cents,reason,created_by_device_id) values(${row.id},gen_random_uuid(),'expense',-${input.amountCents},'Reembolso de comanda',${actor.kind === 'device' ? actor.deviceId : null})`;
      }
      await tx`insert into order_refunds(order_id,payment_id,cash_session_id,idempotency_key,method,amount_cents,reason,created_by_device_id) values(${orderId},${input.paymentId},${session},${input.idempotencyKey},${payment.method},${input.amountCents},${input.reason},${actor.kind === 'device' ? actor.deviceId : null})`;
      return { orderId, refundedCents: input.amountCents, method: payment.method };
    },
  );
}

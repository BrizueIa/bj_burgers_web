import type { AuthenticatedActor, OrderTicket, TicketIssue } from '@bj/contracts';
import type { Sql } from 'postgres';
import { getOrder, OrderError } from './order-service.js';
import { auditOperation, runIdempotent } from './pos-foundation-service.js';

export async function issueOrderTicket(
  sql: Sql,
  orderId: string,
  input: TicketIssue,
  actor: AuthenticatedActor,
) {
  return runIdempotent(
    sql,
    {
      idempotencyKey: input.idempotencyKey,
      operation: 'order.ticket.issue',
      request: { orderId },
      actor,
    },
    async (tx) => {
      const [orderRow] = await tx<
        { status: string; total_cents: number; paid: number; refunded: number }[]
      >`select o.status,o.total_cents,coalesce((select sum(applied_cents) from order_payments p where p.order_id=o.id),0)::int as paid,coalesce((select sum(amount_cents) from order_refunds r where r.order_id=o.id),0)::int as refunded from orders o where o.id=${orderId} for update`;
      if (!orderRow) throw new OrderError(404, 'La comanda no existe.');
      const [existing] = await tx<
        {
          id: string;
          issued_at: Date | string;
          order_snapshot: OrderTicket['order'];
          payment_snapshot: OrderTicket['payments'];
          order_id: string;
        }[]
      >`select id,order_id,issued_at,order_snapshot,payment_snapshot from order_tickets where order_id=${orderId} for update`;
      if (existing) {
        return {
          id: existing.id,
          orderId: existing.order_id,
          issuedAt: new Date(existing.issued_at).toISOString(),
          order: existing.order_snapshot,
          payments: existing.payment_snapshot,
        } as unknown as Record<string, never>;
      }

      if (
        orderRow.status !== 'delivered' ||
        orderRow.paid - orderRow.refunded < orderRow.total_cents
      )
        throw new OrderError(409, 'El ticket se emite después de entregar y cobrar la comanda.');

      const order = await getOrder(tx, orderId);
      if (!order) throw new OrderError(404, 'La comanda no existe.');
      const payments = await tx<
        { method: 'cash' | 'card' | 'transfer'; applied_cents: number }[]
      >`select p.method,(p.applied_cents-coalesce(sum(r.amount_cents),0))::int as applied_cents from order_payments p left join order_refunds r on r.payment_id=p.id where p.order_id=${orderId} group by p.id,p.method,p.applied_cents having p.applied_cents-coalesce(sum(r.amount_cents),0)>0 order by p.created_at,p.id`;
      const paymentSnapshot = payments.map((payment) => ({
        method: payment.method,
        appliedCents: payment.applied_cents,
      }));
      const [ticket] = await tx<
        { id: string; issued_at: Date | string }[]
      >`insert into order_tickets(order_id,idempotency_key,order_snapshot,payment_snapshot,issued_by_device_id,issued_by_user_id) values(${orderId},${input.idempotencyKey},${JSON.stringify(order)}::jsonb,${JSON.stringify(paymentSnapshot)}::jsonb,${actor.kind === 'device' ? actor.deviceId : null},${actor.kind === 'admin' ? actor.userId : null}) returning id,issued_at`;
      if (!ticket) throw new OrderError(500, 'No fue posible guardar el ticket.');
      await auditOperation(tx, actor, {
        action: 'issue',
        entity: 'order_ticket',
        entityId: ticket.id,
        idempotencyKey: input.idempotencyKey,
        details: { orderId },
      });
      return {
        id: ticket.id,
        orderId,
        issuedAt: new Date(ticket.issued_at).toISOString(),
        order,
        payments: paymentSnapshot,
      } as unknown as Record<string, never>;
    },
  );
}

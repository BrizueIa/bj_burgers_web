import type { AuthenticatedActor, ExpenseCreate } from '@bj/contracts';
import type { Sql } from 'postgres';
import { auditOperation, PosFoundationError, runIdempotent } from './pos-foundation-service.js';

export async function createOperatingExpense(
  sql: Sql,
  input: ExpenseCreate,
  actor: AuthenticatedActor,
) {
  return runIdempotent(
    sql,
    {
      idempotencyKey: input.idempotencyKey,
      operation: 'expense.create',
      request: {
        idempotencyKey: input.idempotencyKey,
        category: input.category,
        description: input.description,
        amountCents: input.amountCents,
        paymentMethod: input.paymentMethod,
        fundsOrigin: input.fundsOrigin,
        occurredAt: input.occurredAt,
        paymentId: input.paymentId ?? null,
      },
      actor,
    },
    async (tx) => {
      let cashSessionId: string | null = null;
      if (input.fundsOrigin === 'cash_session') {
        const [session] = await tx<
          { id: string; expected_cents: number }[]
        >`select id,expected_cents from cash_sessions where status='open' for update`;
        if (!session)
          throw new PosFoundationError(409, 'Abre un turno de caja para registrar este gasto.');
        cashSessionId = session.id;
        if (input.paymentMethod === 'cash') {
          if (session.expected_cents < input.amountCents)
            throw new PosFoundationError(409, 'El efectivo esperado no alcanza para este gasto.');
          const expected = session.expected_cents - input.amountCents;
          const ids =
            actor.kind === 'device'
              ? { device: actor.deviceId, user: null }
              : { device: null, user: actor.userId };
          await tx`update cash_sessions set expected_cents=${expected} where id=${session.id}`;
          await tx`insert into cash_movements(cash_session_id,idempotency_key,kind,amount_cents,reason,created_by_device_id,created_by_user_id) values(${session.id},gen_random_uuid(),'expense',${-input.amountCents},${input.description},${ids.device},${ids.user})`;
        }
      }

      if (input.category === 'commission') {
        const paymentId = input.paymentId;
        if (!paymentId)
          throw new PosFoundationError(400, 'Selecciona el pago original de la comisión.');
        const [payment] = await tx<
          { method: string; applied_cents: number }[]
        >`select method,applied_cents from order_payments where id=${paymentId} for update`;
        if (!payment) throw new PosFoundationError(404, 'El pago de la comisión no existe.');
        if (payment.method !== input.paymentMethod || input.amountCents > payment.applied_cents)
          throw new PosFoundationError(
            409,
            'La comisión debe corresponder al medio y monto del pago original.',
          );
      }

      const [expense] = await tx<
        { id: string; incurred_at: Date | string }[]
      >`insert into operating_expenses(idempotency_key,category,description,amount_cents,payment_method,funds_origin,cash_session_id,linked_payment_id,incurred_at,created_by_device_id,created_by_user_id) values(${input.idempotencyKey},${input.category},${input.description},${input.amountCents},${input.paymentMethod},${input.fundsOrigin},${cashSessionId},${input.paymentId ?? null},${input.occurredAt},${actor.kind === 'device' ? actor.deviceId : null},${actor.kind === 'admin' ? actor.userId : null}) returning id,incurred_at`;
      if (!expense) throw new PosFoundationError(500, 'No fue posible guardar el gasto.');
      await auditOperation(tx, actor, {
        action: 'create',
        entity: 'operating_expense',
        entityId: expense.id,
        reason: input.description,
        idempotencyKey: input.idempotencyKey,
        details: {
          category: input.category,
          amountCents: input.amountCents,
          fundsOrigin: input.fundsOrigin,
        },
      });
      return {
        id: expense.id,
        category: input.category,
        description: input.description,
        amountCents: input.amountCents,
        paymentMethod: input.paymentMethod,
        fundsOrigin: input.fundsOrigin,
        cashSessionId,
        paymentId: input.paymentId ?? null,
        occurredAt: new Date(expense.incurred_at).toISOString(),
      };
    },
  );
}

import type {
  AuthenticatedActor,
  CashMovement,
  CashSessionClose,
  CashSessionOpen,
  CashSessionState,
} from '@bj/contracts';
import type { Sql } from 'postgres';
import { auditOperation, PosFoundationError, runIdempotent } from './pos-foundation-service.js';

const ids = (actor: AuthenticatedActor) =>
  actor.kind === 'device'
    ? { device: actor.deviceId, user: null }
    : { device: null, user: actor.userId };
async function state(sql: Sql) {
  const rows = await sql<
    {
      id: string;
      status: 'open' | 'closed';
      opening_fund_cents: number;
      expected_cents: number;
      counted_cents: number | null;
      difference_cents: number | null;
      opened_at: Date | string;
      closed_at: Date | string | null;
    }[]
  >`select * from cash_sessions where status='open' limit 1`;
  const session = rows[0];
  if (!session) return { session: null, movements: [] };
  const movements = await sql<
    { id: string; kind: string; amount_cents: number; reason: string; created_at: Date | string }[]
  >`select id,kind,amount_cents,reason,created_at from cash_movements where cash_session_id=${session.id} order by created_at,id`;
  return {
    session: {
      id: session.id,
      status: session.status,
      openingFundCents: session.opening_fund_cents,
      expectedCents: session.expected_cents,
      countedCents: session.counted_cents,
      differenceCents: session.difference_cents,
      openedAt: new Date(session.opened_at).toISOString(),
      closedAt: session.closed_at ? new Date(session.closed_at).toISOString() : null,
    },
    movements: movements.map((m) => ({
      id: m.id,
      kind: m.kind,
      amountCents: m.amount_cents,
      reason: m.reason,
      createdAt: new Date(m.created_at).toISOString(),
    })),
  };
}
export const cashSessionState = state;
export async function openCashSession(sql: Sql, input: CashSessionOpen, actor: AuthenticatedActor) {
  return runIdempotent(
    sql,
    {
      idempotencyKey: input.idempotencyKey,
      operation: 'cash.session.open',
      request: input,
      actor,
      statusCode: 201,
    },
    async (tx) => {
      await tx`select pg_advisory_xact_lock(824613)`;
      const a = ids(actor);
      const [row] = await tx<
        { id: string }[]
      >`insert into cash_sessions(status,opening_fund_cents,expected_cents,opened_by_device_id,opened_by_user_id) values('open',${input.openingFundCents},${input.openingFundCents},${a.device},${a.user}) on conflict do nothing returning id`;
      if (!row) throw new PosFoundationError(409, 'Ya existe un turno de caja abierto.');
      await auditOperation(tx, actor, {
        action: 'open',
        entity: 'cash_session',
        entityId: row.id,
        idempotencyKey: input.idempotencyKey,
      });
      return (await state(tx)) as unknown as CashSessionState;
    },
  );
}
export async function recordCashMovement(sql: Sql, input: CashMovement, actor: AuthenticatedActor) {
  return runIdempotent(
    sql,
    {
      idempotencyKey: input.idempotencyKey,
      operation: 'cash.movement.create',
      request: input,
      actor,
    },
    async (tx) => {
      const [session] = await tx<
        { id: string; expected_cents: number }[]
      >`select id,expected_cents from cash_sessions where status='open' for update`;
      if (!session)
        throw new PosFoundationError(409, 'Abre un turno de caja antes de registrar movimientos.');
      const delta = input.kind === 'income' ? input.amountCents : -input.amountCents;
      if (session.expected_cents + delta < 0)
        throw new PosFoundationError(
          409,
          'La caja no puede quedar con efectivo esperado negativo.',
        );
      const a = ids(actor);
      await tx`insert into cash_movements(cash_session_id,idempotency_key,kind,amount_cents,reason,created_by_device_id,created_by_user_id) values(${session.id},${input.idempotencyKey},${input.kind},${delta},${input.reason},${a.device},${a.user})`;
      await tx`update cash_sessions set expected_cents=expected_cents+${delta} where id=${session.id}`;
      await auditOperation(tx, actor, {
        action: 'create',
        entity: 'cash_movement',
        entityId: session.id,
        reason: input.reason,
        idempotencyKey: input.idempotencyKey,
      });
      return (await state(tx)) as unknown as CashSessionState;
    },
  );
}
export async function closeCashSession(
  sql: Sql,
  input: CashSessionClose,
  actor: AuthenticatedActor,
) {
  return runIdempotent(
    sql,
    {
      idempotencyKey: input.idempotencyKey,
      operation: 'cash.session.close',
      request: input,
      actor,
    },
    async (tx) => {
      const [session] = await tx<
        { id: string; expected_cents: number }[]
      >`select id,expected_cents from cash_sessions where status='open' for update`;
      if (!session) throw new PosFoundationError(409, 'No hay un turno de caja abierto.');
      const difference = input.countedCents - session.expected_cents;
      await tx`update cash_sessions set status='closed',counted_cents=${input.countedCents},difference_cents=${difference},closed_at=now() where id=${session.id}`;
      await auditOperation(tx, actor, {
        action: 'close',
        entity: 'cash_session',
        entityId: session.id,
        reason: input.note,
        idempotencyKey: input.idempotencyKey,
      });
      return {
        id: session.id,
        expectedCents: session.expected_cents,
        countedCents: input.countedCents,
        differenceCents: difference,
      };
    },
  );
}

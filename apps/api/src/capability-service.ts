import type { AuthenticatedActor, CapabilityActivation, CapabilityKey } from '@bj/contracts';
import type { Sql } from 'postgres';
import {
  auditOperation,
  getCapabilities,
  PosFoundationError,
  runIdempotent,
} from './pos-foundation-service.js';

const dependencies: Partial<Record<CapabilityKey, CapabilityKey[]>> = {
  purchasing: ['stock_ledger'],
  recipe_versions: ['stock_ledger'],
  production: ['stock_ledger', 'recipe_versions'],
  unified_orders: ['stock_ledger', 'recipe_versions', 'production'],
  payments_refunds: ['cash_sessions'],
  pos_tickets: ['unified_orders', 'payments_refunds'],
  expenses: ['cash_sessions'],
  profitability_reports: [
    'stock_ledger',
    'purchasing',
    'recipe_versions',
    'production',
    'unified_orders',
    'payments_refunds',
    'expenses',
  ],
  pos_cutover: [
    'stock_ledger',
    'purchasing',
    'recipe_versions',
    'production',
    'unified_orders',
    'cash_sessions',
    'payments_refunds',
    'pos_tickets',
  ],
};

export async function capabilityReadiness(sql: Sql) {
  const [capabilities, pending] = await Promise.all([
    getCapabilities(sql),
    sql<
      { count: number }[]
    >`select count(*)::int as count from orders where quoted_at is null and status not in ('delivered','cancelled')`,
  ]);
  return { capabilities, legacyPendingOrders: pending[0]?.count ?? 0 };
}

export async function activateCapability(
  sql: Sql,
  key: CapabilityKey,
  input: CapabilityActivation,
  actor: AuthenticatedActor,
) {
  return runIdempotent(
    sql,
    {
      idempotencyKey: input.idempotencyKey,
      operation: 'pos.capability.set',
      request: { key, enabled: input.enabled, activationNote: input.activationNote },
      actor,
    },
    async (tx) => {
      await tx`select pg_advisory_xact_lock(824614)`;
      if (key === 'pos_cutover' && !input.enabled)
        throw new PosFoundationError(
          409,
          'El corte del POS es irreversible para proteger el historial.',
        );
      if (input.enabled) {
        const required = dependencies[key] ?? [];
        if (required.length) {
          const rows = await tx<{ capability: CapabilityKey; enabled: boolean }[]>`
            select capability,enabled from pos_capabilities where capability = any(${required})`;
          const enabled = new Set(rows.filter((row) => row.enabled).map((row) => row.capability));
          const missing = required.filter((dependency) => !enabled.has(dependency));
          if (missing.length)
            throw new PosFoundationError(409, `Activa primero: ${missing.join(', ')}.`);
        }
        if (key === 'pos_cutover') {
          const [pending] = await tx<{ count: number }[]>`
            select count(*)::int as count from orders where quoted_at is null and status not in ('delivered','cancelled')`;
          if (pending!.count)
            throw new PosFoundationError(
              409,
              `Cierra o cancela las ${pending!.count} comandas antiguas pendientes antes del corte.`,
            );
          const [invalidStock] = await tx<{ count: number }[]>`
            select count(*)::int as count from stock_ingredients where stock < 0 or reserved < 0 or reserved > stock`;
          if (invalidStock!.count)
            throw new PosFoundationError(
              409,
              'Concilia las existencias y reservas antes del corte.',
            );
        }
      }
      const [updated] = await tx<
        { capability: CapabilityKey; enabled: boolean; updated_at: Date | string }[]
      >`update pos_capabilities set enabled=${input.enabled},activation_note=${input.activationNote},updated_by_user_id=${actor.kind === 'admin' ? actor.userId : null},updated_at=now() where capability=${key} returning capability,enabled,updated_at`;
      if (!updated) throw new PosFoundationError(404, 'No se encontró esa función del POS.');
      await auditOperation(tx, actor, {
        action: input.enabled ? 'enable' : 'disable',
        entity: 'pos_capability',
        entityId: key,
        reason: input.activationNote,
        idempotencyKey: input.idempotencyKey,
        details: { enabled: input.enabled },
      });
      return {
        key: updated.capability,
        enabled: updated.enabled,
        updatedAt: new Date(updated.updated_at).toISOString(),
      } as unknown as Record<string, never>;
    },
  );
}

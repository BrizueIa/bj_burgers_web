import { createHash } from 'node:crypto';
import type { AuthenticatedActor, Capability, CapabilityKey } from '@bj/contracts';
import type { Sql } from 'postgres';

export class PosFoundationError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

function canonicalJson(value: unknown): string {
  if (
    value === null ||
    typeof value === 'boolean' ||
    typeof value === 'number' ||
    typeof value === 'string'
  )
    return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(',')}}`;
  }
  throw new PosFoundationError(400, 'La solicitud idempotente contiene un valor inválido.');
}

export function fingerprintRequest(value: unknown) {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function actorColumns(actor: AuthenticatedActor) {
  return actor.kind === 'admin'
    ? { actorKind: 'admin', adminUserId: actor.userId, deviceId: null, origin: actor.origin }
    : { actorKind: 'device', adminUserId: null, deviceId: actor.deviceId, origin: actor.origin };
}

export async function auditOperation(
  sql: Sql,
  actor: AuthenticatedActor,
  input: {
    action: string;
    entity: string;
    entityId?: string;
    reason?: string;
    idempotencyKey?: string;
    details?: Record<string, Json>;
  },
) {
  const columns = actorColumns(actor);
  await sql`
    insert into operation_audit_logs
      (actor_kind, admin_user_id, device_id, origin, action, entity, entity_id, reason, idempotency_key, details)
    values
      (${columns.actorKind}, ${columns.adminUserId}, ${columns.deviceId}, ${columns.origin},
       ${input.action}, ${input.entity}, ${input.entityId ?? null}, ${input.reason ?? ''},
       ${input.idempotencyKey ?? null}, ${JSON.stringify(input.details ?? {})}::jsonb)`;
}

export async function getCapabilities(sql: Sql): Promise<Capability[]> {
  const rows = await sql<
    { capability: CapabilityKey; enabled: boolean; updated_at: string | Date }[]
  >`
    select capability, enabled, updated_at from pos_capabilities order by capability`;
  return rows.map((row) => ({
    key: row.capability,
    enabled: row.enabled,
    updatedAt: new Date(row.updated_at).toISOString(),
  }));
}

export async function requireCapability(sql: Sql, capability: CapabilityKey) {
  const rows = await sql<{ enabled: boolean }[]>`
    select enabled from pos_capabilities where capability=${capability} limit 1`;
  if (!rows[0]?.enabled)
    throw new PosFoundationError(409, 'Esta función todavía no está habilitada en el servidor.');
}

/** Stores the response in the same transaction as its effects. A retry with the
 * same key and payload returns the original response; a changed payload fails. */
export async function runIdempotent<T extends Json>(
  sql: Sql,
  input: {
    idempotencyKey: string;
    operation: string;
    request: Json;
    actor: AuthenticatedActor;
    statusCode?: number;
  },
  execute: (transaction: Sql) => Promise<T>,
): Promise<{ result: T; reused: boolean; statusCode: number }> {
  const requestFingerprint = fingerprintRequest(input.request);
  const columns = actorColumns(input.actor);
  const statusCode = input.statusCode ?? 200;
  return sql.begin(async (transaction) => {
    // Key-specific locking allows different operations to proceed concurrently,
    // while making a lost response retry deterministic.
    await transaction`select pg_advisory_xact_lock(hashtextextended(${input.idempotencyKey}, 0))`;
    const existing = await transaction<
      {
        operation: string;
        request_fingerprint: string;
        response_status: number;
        response_body: T;
        actor_kind: string;
        admin_user_id: string | null;
        device_id: string | null;
        origin: string;
      }[]
    >`select operation, request_fingerprint, response_status, response_body,
        actor_kind, admin_user_id, device_id, origin
      from idempotency_operations where idempotency_key=${input.idempotencyKey}`;
    if (existing[0]) {
      const previous = existing[0];
      if (
        previous.operation !== input.operation ||
        previous.request_fingerprint !== requestFingerprint ||
        previous.actor_kind !== columns.actorKind ||
        previous.admin_user_id !== columns.adminUserId ||
        previous.device_id !== columns.deviceId ||
        previous.origin !== columns.origin
      )
        throw new PosFoundationError(409, 'Esta clave ya pertenece a otra operación.');
      return { result: previous.response_body, reused: true, statusCode: previous.response_status };
    }
    const result = await execute(transaction as unknown as Sql);
    await transaction`
      insert into idempotency_operations
        (idempotency_key, operation, request_fingerprint, response_status, response_body,
         actor_kind, admin_user_id, device_id, origin)
      values
        (${input.idempotencyKey}, ${input.operation}, ${requestFingerprint}, ${statusCode},
         ${JSON.stringify(result)}::jsonb, ${columns.actorKind}, ${columns.adminUserId},
         ${columns.deviceId}, ${columns.origin})`;
    return { result, reused: false, statusCode };
  });
}

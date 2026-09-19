import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDatabase, type Database } from './db/client.js';
import { applyMigrations } from './db/migrate.js';
import { requireTestDatabaseUrl } from './db/test-database.js';
import { digestCode } from './security.js';
import { redeemSpin } from './spin-service.js';
import { getCapabilities, runIdempotent } from './pos-foundation-service.js';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const secret = 'secreto-de-integracion-con-mas-de-treinta-y-dos-caracteres';
const rawCode = 'BJ-TST1';
let database: Database;

describe.skipIf(!testDatabaseUrl)('concurrencia de ruleta con PostgreSQL', () => {
  beforeAll(async () => {
    database = createDatabase(requireTestDatabaseUrl(testDatabaseUrl));
    // The dedicated test database is reset before proving both a new and an
    // already-migrated database can use the exact migration runner.
    await database.sql.unsafe('drop schema public cascade; create schema public');
    const directory = fileURLToPath(new URL('../migrations', import.meta.url));
    expect(await applyMigrations(database.sql, directory)).toEqual([
      '0001_initial.sql',
      '0002_demo_spins.sql',
      '0003_operator_orders.sql',
      '0004_business.sql',
      '0005_pos_foundation.sql',
    ]);
    expect(await applyMigrations(database.sql, directory)).toEqual([]);
    await database.sql`insert into prizes (id, label, emoji, weight, active, inventory, target_segments)
      values ('test-prize', 'Premio de prueba', '🎁', 1, true, null, '[0]')
      on conflict (id) do update set weight=1, active=true, inventory=null, target_segments='[0]'`;
  });

  beforeEach(async () => {
    await database.sql`delete from spin_redemptions where code_id in (select id from spin_codes where code_hint = 'TST1')`;
    await database.sql`delete from spin_codes where code_hint = 'TST1'`;
    await database.sql`insert into spin_codes (code_digest, code_hint, remaining_spins) values (${digestCode(rawCode, secret)}, 'TST1', 1)`;
  });

  afterAll(async () => {
    await database.sql`delete from spin_redemptions where prize_id = 'test-prize'`;
    await database.sql`delete from spin_codes where code_hint = 'TST1'`;
    await database.sql`delete from prizes where id = 'test-prize'`;
    await database.sql.end();
  });

  it('una misma clave idempotente registra como máximo un canje', async () => {
    const idempotencyKey = randomUUID();
    await Promise.allSettled(
      Array.from({ length: 8 }, () =>
        redeemSpin(database.sql, { code: rawCode, idempotencyKey, secret }),
      ),
    );
    const rows = await database.sql<{ redemptions: number; balance: number }[]>`
      select (select count(*)::int from spin_redemptions where idempotency_key=${idempotencyKey}) as redemptions,
             (select remaining_spins from spin_codes where code_hint='TST1') as balance`;
    expect(rows[0]).toEqual({ redemptions: 1, balance: 0 });
  });

  it('claves distintas nunca llevan el saldo debajo de cero', async () => {
    await Promise.allSettled(
      Array.from({ length: 8 }, () =>
        redeemSpin(database.sql, { code: rawCode, idempotencyKey: randomUUID(), secret }),
      ),
    );
    const rows = await database.sql<{ redemptions: number; balance: number }[]>`
      select (select count(*)::int from spin_redemptions r join spin_codes c on c.id=r.code_id where c.code_hint='TST1') as redemptions,
             (select remaining_spins from spin_codes where code_hint='TST1') as balance`;
    expect(rows[0]).toEqual({ redemptions: 1, balance: 0 });
  });

  it('persiste una respuesta idempotente y rechaza una clave con otro contenido', async () => {
    const idempotencyKey = randomUUID();
    const actor = { kind: 'device' as const, deviceId: randomUUID(), origin: 'android' as const };
    await database.sql`insert into mobile_devices(id,name) values(${actor.deviceId}, 'POS prueba')`;
    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        runIdempotent(
          database.sql,
          {
            idempotencyKey,
            operation: 'foundation-test',
            request: { quantity: '1.000', line: 'prueba' },
            actor,
          },
          async (transaction) => {
            await transaction`insert into operation_audit_logs
              (actor_kind, device_id, origin, action, entity, reason)
              values ('device', ${actor.deviceId}, 'android', 'confirm', 'foundation-test', 'prueba')`;
            return { confirmed: true };
          },
        ),
      ),
    );
    expect(results.filter((result) => !result.reused)).toHaveLength(1);
    expect(results.map((result) => result.result)).toEqual(
      Array.from({ length: 6 }, () => ({ confirmed: true })),
    );
    await expect(
      runIdempotent(
        database.sql,
        {
          idempotencyKey,
          operation: 'foundation-test',
          request: { quantity: '2.000', line: 'prueba' },
          actor,
        },
        async () => ({ confirmed: false }),
      ),
    ).rejects.toMatchObject({ statusCode: 409 });
    const otherDeviceId = randomUUID();
    await database.sql`insert into mobile_devices(id,name) values(${otherDeviceId}, 'Otro POS')`;
    await expect(
      runIdempotent(
        database.sql,
        {
          idempotencyKey,
          operation: 'foundation-test',
          request: { quantity: '1.000', line: 'prueba' },
          actor: { kind: 'device', deviceId: otherDeviceId, origin: 'android' },
        },
        async () => ({ confirmed: false }),
      ),
    ).rejects.toMatchObject({ statusCode: 409 });
    const rows = await database.sql<{ effects: number; operations: number }[]>`
      select
        (select count(*)::int from operation_audit_logs where entity='foundation-test') as effects,
        (select count(*)::int from idempotency_operations where idempotency_key=${idempotencyKey}) as operations`;
    expect(rows[0]).toEqual({ effects: 1, operations: 1 });
    expect((await getCapabilities(database.sql)).every((capability) => !capability.enabled)).toBe(
      true,
    );
  });
});

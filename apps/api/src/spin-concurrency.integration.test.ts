import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDatabase, type Database } from './db/client.js';
import { digestCode } from './security.js';
import { redeemSpin } from './spin-service.js';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const secret = 'secreto-de-integracion-con-mas-de-treinta-y-dos-caracteres';
const rawCode = 'BJ-TST1';
let database: Database;

describe.skipIf(!testDatabaseUrl)('concurrencia de ruleta con PostgreSQL', () => {
  beforeAll(async () => {
    database = createDatabase(testDatabaseUrl!);
    const migration = await readFile(resolve('migrations/0001_initial.sql'), 'utf8');
    await database.sql.unsafe(migration);
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
});

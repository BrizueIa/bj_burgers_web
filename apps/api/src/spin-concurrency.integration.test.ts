import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDatabase, type Database } from './db/client.js';
import { applyMigrations } from './db/migrate.js';
import { requireTestDatabaseUrl } from './db/test-database.js';
import { digestCode } from './security.js';
import { redeemSpin } from './spin-service.js';
import { getCapabilities, runIdempotent } from './pos-foundation-service.js';
import { reserveStock } from './stock-ledger-service.js';
import { openCashSession } from './cash-session-service.js';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const secret = 'secreto-de-integracion-con-mas-de-treinta-y-dos-caracteres';
const rawCode = 'BJ-TST1';
let database: Database;

describe.skipIf(!testDatabaseUrl)('concurrencia de ruleta con PostgreSQL', () => {
  beforeAll(async () => {
    database = createDatabase(requireTestDatabaseUrl(testDatabaseUrl));
    // Seed the pre-POS schema and legacy rows before applying new migrations.
    await database.sql.unsafe('drop schema public cascade; create schema public');
    const directory = fileURLToPath(new URL('../migrations', import.meta.url));
    await database.sql`create table schema_migrations (filename text primary key, applied_at timestamptz not null default now())`;
    for (const filename of [
      '0001_initial.sql',
      '0002_demo_spins.sql',
      '0003_operator_orders.sql',
      '0004_business.sql',
    ]) {
      const migration = await readFile(
        new URL(`../migrations/${filename}`, import.meta.url),
        'utf8',
      );
      await database.sql.begin(async (transaction) => {
        await transaction.unsafe(migration);
        await transaction`insert into schema_migrations(filename) values(${filename})`;
      });
    }
    const legacyDeviceId = randomUUID();
    const legacyIngredientId = randomUUID();
    const legacyOrderId = randomUUID();
    const legacyEntryId = randomUUID();
    await database.sql`insert into mobile_devices(id,name) values(${legacyDeviceId},'POS legado')`;
    await database.sql`insert into stock_ingredients(id,name,unit,stock,value_cents)
      values(${legacyIngredientId},'Saldo legado de prueba','pz',3,300)`;
    await database.sql`insert into business_entries(id,idempotency_key,request_payload,kind,description,total_cents,lines,device_id)
      values(${legacyEntryId},${randomUUID()},'{}','purchase','Compra legado',300,'[]',${legacyDeviceId})`;
    await database.sql`insert into orders(id,customer_name,subtotal_cents,total_cents,idempotency_key)
      values(${legacyOrderId},'Comanda legado',300,300,${randomUUID()})`;
    await database.sql`insert into spin_codes(code_digest,code_hint,remaining_spins)
      values('legacy-preservation-digest','MIGR',1)`;
    expect(await applyMigrations(database.sql, directory)).toEqual([
      '0005_pos_foundation.sql',
      '0006_stock_ledger.sql',
      '0007_purchasing.sql',
      '0008_recipe_versions.sql',
      '0009_production.sql',
      '0010_unified_orders.sql',
      '0011_cash_sessions.sql',
      '0012_payments_refunds.sql',
      '0013_pos_tickets.sql',
      '0014_pos_cutover.sql',
      '0015_operating_expenses.sql',
      '0016_admin_order_actors.sql',
      '0017_refund_item_reference.sql',
      '0018_manual_order_discounts.sql',
    ]);
    expect(await applyMigrations(database.sql, directory)).toEqual([]);
    await database.sql`insert into categories(id,slug,name)
      values('integration-tests','integration-tests','Pruebas de integración')
      on conflict (id) do nothing`;
    await database.sql`insert into products(id,slug,category_id,name,description,price_cents)
      values('burger','burger','integration-tests','Burger de prueba','',5000)
      on conflict (id) do nothing`;
    const [legacy] = await database.sql<
      {
        stock: string;
        ledgerEntries: number;
        orders: number;
        purchases: number;
        spinCodes: number;
      }[]
    >`
      select i.stock::text as stock,
        (select count(*)::int from stock_ledger_movements where ingredient_id=${legacyIngredientId}) as "ledgerEntries",
        (select count(*)::int from orders where id=${legacyOrderId}) as orders,
        (select count(*)::int from business_entries where id=${legacyEntryId}) as purchases,
        (select count(*)::int from spin_codes where code_hint='MIGR') as "spinCodes"
      from stock_ingredients i where i.id=${legacyIngredientId}
    `;
    expect(legacy).toEqual({
      stock: '3.000',
      ledgerEntries: 1,
      orders: 1,
      purchases: 1,
      spinCodes: 1,
    });
    await database.sql`insert into prizes (id, label, emoji, weight, active, inventory, target_segments)
      values ('test-prize', 'Premio de prueba', '🎁', 1, true, null, '[0]')
      on conflict (id) do update set weight=1, active=true, inventory=null, target_segments='[0]'`;
  });

  beforeEach(async () => {
    await database.sql`delete from cash_movements`;
    await database.sql`delete from cash_sessions`;
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

  it('dos conexiones no pueden reservar la última existencia disponible', async () => {
    const deviceId = randomUUID();
    const ingredientId = randomUUID();
    await database.sql`insert into mobile_devices(id,name) values(${deviceId}, 'Inventario concurrente')`;
    await database.sql`insert into stock_ingredients(id,name,unit,stock,value_cents)
      values(${ingredientId}, ${`Ingrediente ${ingredientId}`}, 'pz', 1, 100)`;
    const actor = { kind: 'device' as const, deviceId, origin: 'android' as const };
    const results = await Promise.allSettled(
      ['uno', 'dos'].map((referenceId) =>
        reserveStock(
          database.sql,
          {
            idempotencyKey: randomUUID(),
            ingredientId,
            quantity: '1.000',
            referenceType: 'integration-test',
            referenceId,
            reason: 'Última pieza',
          },
          actor,
        ),
      ),
    );
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const [balance] = await database.sql<{ stock: string; reserved: string; active: number }[]>`
      select i.stock::text, i.reserved::text,
        (select count(*)::int from stock_reservations where ingredient_id=i.id and status='active') as active
      from stock_ingredients i where i.id=${ingredientId}`;
    expect(balance).toEqual({ stock: '1.000', reserved: '1.000', active: 1 });
  });

  it('dos conexiones no pueden abrir turnos de caja simultáneos', async () => {
    const deviceId = randomUUID();
    await database.sql`insert into mobile_devices(id,name) values(${deviceId}, 'Caja concurrente')`;
    const actor = { kind: 'device' as const, deviceId, origin: 'android' as const };
    const results = await Promise.allSettled([
      openCashSession(
        database.sql,
        { idempotencyKey: randomUUID(), openingFundCents: 5000 },
        actor,
      ),
      openCashSession(
        database.sql,
        { idempotencyKey: randomUUID(), openingFundCents: 8000 },
        actor,
      ),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const [sessions] = await database.sql<{ count: number; open: number }[]>`
      select count(*)::int as count,count(*) filter(where status='open')::int as open from cash_sessions
    `;
    expect(sessions).toEqual({ count: 1, open: 1 });
  });

  it('dos reembolsos por pago concurrentes no superan el límite de la partida', async () => {
    const deviceId = randomUUID();
    const orderId = randomUUID();
    await database.sql`insert into mobile_devices(id,name) values(${deviceId}, 'Devolución concurrente')`;
    await database.sql`insert into orders(id,source,customer_name,subtotal_cents,total_cents,status,idempotency_key,created_by_device_id)
      values(${orderId},'pos','Prueba',5000,5000,'delivered',${randomUUID()},${deviceId})`;
    const [item] = await database.sql<{ id: string }[]>`insert into order_items
      (order_id,product_id,product_name,unit_price_cents,quantity,line_total_cents)
      values(${orderId},'burger','Burger',5000,1,5000) returning id`;
    const [payment] = await database.sql<{ id: string }[]>`insert into order_payments
      (order_id,idempotency_key,method,received_cents,applied_cents,change_cents)
      values(${orderId},${randomUUID()},'card',10000,10000,0) returning id`;
    const actor = { kind: 'device' as const, deviceId, origin: 'android' as const };
    await openCashSession(
      database.sql,
      { idempotencyKey: randomUUID(), openingFundCents: 0 },
      actor,
    );
    const { refundOrderPayment } = await import('./payment-service.js');
    const results = await Promise.allSettled(
      [randomUUID(), randomUUID()].map((idempotencyKey) =>
        refundOrderPayment(
          database.sql,
          orderId,
          {
            idempotencyKey,
            paymentId: payment!.id,
            orderItemId: item!.id,
            amountCents: 4000,
            reason: 'Devolución concurrente',
          },
          actor,
        ),
      ),
    );
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const [refunds] = await database.sql<{ amount: number; count: number }[]>`
      select coalesce(sum(amount_cents),0)::int as amount,count(*)::int as count
      from order_refunds where order_id=${orderId}
    `;
    expect(refunds).toEqual({ amount: 4000, count: 1 });
  });
});

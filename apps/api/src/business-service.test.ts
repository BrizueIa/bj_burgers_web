import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import type { Sql } from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  businessState,
  entrySchema,
  recordEntry,
  recipeSchema,
  saveRecipe,
} from './business-service.js';
import {
  countStock,
  releaseStockReservation,
  reserveStock,
  stockLedgerState,
  writeOffStock,
} from './stock-ledger-service.js';
import { createPurchase } from './purchasing-service.js';
import { reversePurchase } from './purchasing-service.js';
import { createRecipeVersion, recipeVersionState } from './recipe-version-service.js';
import { createProductionBatch } from './production-service.js';
import {
  createUnifiedOrder,
  getOrder,
  InMemoryOrderNotifier,
  updateOrderStatus,
} from './order-service.js';
import {
  checkoutCounterOrder,
  collectOrderPayment,
  refundOrderPayment,
} from './payment-service.js';
import { issueOrderTicket } from './ticket-service.js';
import { activateCapability, capabilityReadiness } from './capability-service.js';
import { createOperatingExpense } from './expense-service.js';
import { profitabilityCsv, profitabilityReport } from './profitability-service.js';
import { seedCatalog, type OrderTicket } from '@bj/contracts';
import {
  cashSessionState,
  closeCashSession,
  openCashSession,
  recordCashMovement,
} from './cash-session-service.js';

// Runs the actual migration and service SQL on embedded PostgreSQL. This adapter
// only bridges tagged parameters/results; it does not simulate inventory logic.
let pg: PGlite;
let sql: Sql;
const device = randomUUID();
const adminUser = randomUUID();
const ingredient = randomUUID();
function adapter(db: { query: PGlite['query'] }) {
  const tag = async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const query = strings.reduce((s, part, i) => s + (i ? `$${i}` : '') + part, '');
    return (await db.query(query, values)).rows;
  };
  return Object.assign(tag, { json: (value: unknown) => JSON.stringify(value) });
}
const purchase = (quantity = 1000, totalCents = 10000, idempotencyKey = randomUUID()) =>
  recordEntry(
    sql,
    {
      kind: 'purchase',
      description: 'Proveedor prueba',
      idempotencyKey,
      lines: [{ ingredientId: ingredient, quantity, totalCents }],
    },
    device,
  );
const sale = (quantity = 1, idempotencyKey = randomUUID(), price = 10000) =>
  recordEntry(
    sql,
    {
      kind: 'sale',
      expectedTotalCents: price * quantity,
      description: 'Mostrador',
      payment: 'cash',
      idempotencyKey,
      lines: [{ productId: 'burger', quantity }],
    },
    device,
  );
const state = () => businessState(sql, '2020-01-01T00:00:00Z', '2100-01-01T00:00:00Z');

describe('circuito de negocio con PostgreSQL embebido', () => {
  beforeAll(async () => {
    pg = new PGlite();
    const tag = adapter(pg);
    sql = Object.assign(tag, {
      begin: (
        options: string | ((tx: Sql) => Promise<unknown>),
        callback?: (tx: Sql) => Promise<unknown>,
      ) =>
        pg.transaction(async (tx) => {
          if (typeof options === 'string') await tx.exec(`set transaction ${options}`);
          return (typeof options === 'function' ? options : callback!)(
            adapter(tx) as unknown as Sql,
          );
        }),
    }) as unknown as Sql;
    for (const name of [
      '0001_initial.sql',
      '0002_demo_spins.sql',
      '0003_operator_orders.sql',
      '0004_business.sql',
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
      '0019_menu_catalog_corrections.sql',
    ]) {
      // gen_random_uuid is built into PostgreSQL; pgcrypto isn't required here.
      const migration = (
        await readFile(new URL(`../migrations/${name}`, import.meta.url), 'utf8')
      ).replace('CREATE EXTENSION IF NOT EXISTS pgcrypto;', '');
      await pg.exec(migration);
    }
    await pg.query('insert into mobile_devices(id,name) values($1,$2)', [device, 'Prueba']);
    await pg.query('insert into admin_users(id,email,password_hash) values($1,$2,$3)', [
      adminUser,
      'pos-test@example.invalid',
      'test-hash',
    ]);
    await pg.exec(
      "insert into categories(id,slug,name) values('burgers','burgers','Burgers'); insert into products(id,slug,category_id,name,description,price_cents) values('burger','burger','burgers','Burger','',10000)",
    );
  }, 30000);
  beforeEach(async () => {
    await pg.exec(
      'delete from operating_expenses; delete from order_tickets; delete from order_refunds; delete from order_payments; delete from order_cost_allocations; delete from order_stock_reservations; delete from order_events; delete from order_items; delete from orders; delete from cash_movements; delete from purchase_reversals; delete from purchase_lines; delete from purchase_documents; delete from cash_sessions; delete from production_batches; delete from recipe_version_components; delete from recipe_versions; delete from ingredient_presentations; delete from suppliers; delete from stock_ledger_movements; delete from stock_reservations; delete from stock_movements; delete from business_entries; delete from recipe_lines; delete from product_recipes; delete from stock_ingredients;',
    );
    await pg.exec(
      "update pos_capabilities set enabled=false,activation_note='',updated_by_user_id=null",
    );
    await pg.query("insert into stock_ingredients(id,name,unit) values($1,'Carne','g')", [
      ingredient,
    ]);
    await saveRecipe(sql, {
      productId: 'burger',
      targetMargin: 60,
      overheadCents: 100,
      priceCents: 10000,
      lines: [{ ingredientId: ingredient, quantity: 150 }],
    });
  });
  afterAll(async () => {
    await pg?.close();
  });

  it('alinea el catálogo existente al menú confirmado y puede repetirse sin duplicados', async () => {
    await pg.exec(
      "insert into categories(id,slug,name) values ('dogs','dogs','Hot dogs'),('sides','sides','Complementos'),('drinks','drinks','Bebidas') on conflict (id) do nothing",
    );
    await pg.exec(
      "insert into products(id,slug,category_id,name,description,price_cents,ingredients) values ('hawaiana','hawaiana','burgers','Hawaiana','',8900,'[\"Mayonesa\"]'),('coca-cola','coca-cola','drinks','Coca-Cola','',3600,'[]'),('coca-cola-zero','coca-cola-zero','drinks','Coca-Cola Zero','',3100,'[]') on conflict (id) do nothing",
    );
    await pg.exec(
      "insert into modifiers(id,group_id,name,price_cents) values('extra-papas-150','extras','Papas 150 g',1600) on conflict (id) do nothing",
    );
    const migration = await readFile(
      new URL('../migrations/0019_menu_catalog_corrections.sql', import.meta.url),
      'utf8',
    );
    await pg.exec(migration);
    await pg.exec(migration);

    const products = await pg.query<{
      id: string;
      price_cents: number;
      ingredients: string[];
    }>(
      "select id,price_cents,ingredients from products where id in ('aros-100','hawaiana','coca-cola','coca-cola-zero') order by id",
    );
    expect(products.rows).toEqual([
      { id: 'aros-100', price_cents: 2600, ingredients: ['Aros de cebolla'] },
      {
        id: 'coca-cola',
        price_cents: 3900,
        ingredients: [],
      },
      {
        id: 'coca-cola-zero',
        price_cents: 3600,
        ingredients: [],
      },
      {
        id: 'hawaiana',
        price_cents: 8900,
        ingredients: [
          'Mayonesa',
          'Mostaza',
          'Catsup',
          'Lechuga',
          'Tomate',
          'Cebolla',
          'Carne Angus',
          'Queso americano',
          'Piña asada',
          'Queso asadero',
          'Jamón',
        ],
      },
    ]);
    const modifiers = await pg.query<{ name: string; price_cents: number }>(
      "select name,price_cents from modifiers where id = 'extra-papas-150'",
    );
    expect(modifiers.rows).toEqual([{ name: 'Papas 100 g', price_cents: 1600 }]);
    await pg.exec(
      "delete from products where id in ('aros-100','hawaiana','coca-cola','coca-cola-zero'); delete from modifiers where id='extra-papas-150'; delete from categories where id in ('dogs','sides','drinks')",
    );
  });

  it('reserva una comanda unificada una sola vez y clasifica su consumo cancelado como merma', async () => {
    await purchase(1000, 10000);
    const actor = { kind: 'device' as const, deviceId: device, origin: 'android' as const };
    await createRecipeVersion(
      sql,
      {
        idempotencyKey: randomUUID(),
        productId: 'burger',
        targetMargin: 60,
        overheadCents: 100,
        components: [
          {
            kind: 'ingredient',
            ingredientId: ingredient,
            quantity: '150.000',
            removable: false,
            extra: false,
          },
        ],
      },
      actor,
    );
    const sourceProduct = seedCatalog.products[0]!;
    const catalog = {
      ...seedCatalog,
      products: [
        {
          ...sourceProduct,
          id: 'burger',
          slug: 'burger',
          categoryId: 'burgers',
          name: 'Burger',
          priceCents: 10000,
          available: true,
        },
      ],
      modifiers: [],
      promotions: [],
    };
    const key = randomUUID();
    const input = {
      idempotencyKey: key,
      fulfillment: 'counter' as const,
      customerName: '',
      neighborhood: '',
      streetAndNumber: '',
      manualDiscountCents: 0,
      manualDiscountReason: '',
      quotedTotalCents: 10000,
      items: [
        {
          productId: 'burger',
          quantity: 1,
          removedIngredients: [],
          modifierIds: [],
          combo: false,
          note: '',
        },
      ],
    };
    const notifier = new InMemoryOrderNotifier();
    const created = await createUnifiedOrder(sql, catalog, input, device, notifier);
    const retried = await createUnifiedOrder(sql, catalog, input, device, notifier);
    expect(retried).toMatchObject({ order: { id: created.order.id }, reused: true });
    await expect(
      createUnifiedOrder(sql, catalog, { ...input, quotedTotalCents: 9999 }, device, notifier),
    ).rejects.toThrow('clave');
    let [balance] = await sql<{ stock: string; reserved: string; active: number }[]>`
      select stock::text,reserved::text,(select count(*)::int from stock_reservations where status='active') as active
      from stock_ingredients where id=${ingredient}`;
    expect(balance).toEqual({ stock: '1000.000', reserved: '150.000', active: 1 });
    await updateOrderStatus(sql, created.order.id, 'preparing', '', device, notifier, randomUUID());
    await updateOrderStatus(sql, created.order.id, 'ready', '', device, notifier, randomUUID());
    await updateOrderStatus(
      sql,
      created.order.id,
      'cancelled',
      'Cliente canceló',
      device,
      notifier,
      randomUUID(),
    );
    [balance] = await sql<{ stock: string; reserved: string; active: number }[]>`
      select stock::text,reserved::text,(select count(*)::int from stock_reservations where status='active') as active
      from stock_ingredients where id=${ingredient}`;
    expect(balance).toEqual({ stock: '850.000', reserved: '0.000', active: 0 });
    const [allocation] = await sql<{ classification: string; cost_cents: string }[]>`
      select classification,cost_cents::text from order_cost_allocations where order_id=${created.order.id}`;
    expect(allocation).toEqual({ classification: 'waste', cost_cents: '1500.000000' });
  });

  it('aplica el descuento manual después de promociones y fija el motivo y neto por partida', async () => {
    await purchase(1000, 10000);
    await createRecipeVersion(
      sql,
      {
        idempotencyKey: randomUUID(),
        productId: 'burger',
        targetMargin: 60,
        overheadCents: 0,
        components: [
          {
            kind: 'ingredient',
            ingredientId: ingredient,
            quantity: '150.000',
            removable: false,
            extra: false,
          },
        ],
      },
      { kind: 'device', deviceId: device, origin: 'android' },
    );
    const product = seedCatalog.products[0]!;
    const catalog = {
      ...seedCatalog,
      products: [
        {
          ...product,
          id: 'burger',
          slug: 'burger',
          categoryId: 'burgers',
          name: 'Burger',
          priceCents: 10000,
          available: true,
        },
      ],
      modifiers: [],
      promotions: [],
    };
    const created = await createUnifiedOrder(
      sql,
      catalog,
      {
        idempotencyKey: randomUUID(),
        fulfillment: 'counter',
        customerName: '',
        neighborhood: '',
        streetAndNumber: '',
        manualDiscountCents: 1250,
        manualDiscountReason: 'Promoción por demora',
        quotedTotalCents: 8750,
        items: [
          {
            productId: 'burger',
            quantity: 1,
            removedIngredients: [],
            modifierIds: [],
            combo: false,
            note: '',
          },
        ],
      },
      device,
      new InMemoryOrderNotifier(),
    );
    expect(created.order).toMatchObject({
      totalCents: 8750,
      subtotalCents: 8750,
      manualDiscountCents: 1250,
      manualDiscountReason: 'Promoción por demora',
      items: [{ lineTotalCents: 8750 }],
    });
    await expect(
      createUnifiedOrder(
        sql,
        catalog,
        {
          idempotencyKey: randomUUID(),
          fulfillment: 'counter',
          customerName: '',
          neighborhood: '',
          streetAndNumber: '',
          manualDiscountCents: 10001,
          manualDiscountReason: 'Descuento mayor al total',
          quotedTotalCents: 0,
          items: [
            {
              productId: 'burger',
              quantity: 1,
              removedIngredients: [],
              modifierIds: [],
              combo: false,
              note: '',
            },
          ],
        },
        device,
        new InMemoryOrderNotifier(),
      ),
    ).rejects.toThrow('no puede superar');
  });

  it('atribuye ventas POS web y sus cambios de estado al usuario administrativo autenticado', async () => {
    await purchase(1000, 10000);
    await createRecipeVersion(
      sql,
      {
        idempotencyKey: randomUUID(),
        productId: 'burger',
        targetMargin: 60,
        overheadCents: 100,
        components: [
          {
            kind: 'ingredient',
            ingredientId: ingredient,
            quantity: '150.000',
            removable: false,
            extra: false,
          },
        ],
      },
      { kind: 'admin', userId: adminUser, origin: 'admin_web' },
    );
    const product = seedCatalog.products[0]!;
    const catalog = {
      ...seedCatalog,
      products: [
        {
          ...product,
          id: 'burger',
          slug: 'burger',
          categoryId: 'burgers',
          name: 'Burger',
          priceCents: 10000,
          available: true,
        },
      ],
      modifiers: [],
      promotions: [],
    };
    const actor = { kind: 'admin' as const, userId: adminUser, origin: 'admin_web' as const };
    const created = await createUnifiedOrder(
      sql,
      catalog,
      {
        idempotencyKey: randomUUID(),
        fulfillment: 'counter',
        customerName: '',
        neighborhood: '',
        streetAndNumber: '',
        manualDiscountCents: 0,
        manualDiscountReason: '',
        quotedTotalCents: 10000,
        items: [
          {
            productId: 'burger',
            quantity: 1,
            removedIngredients: [],
            modifierIds: [],
            combo: false,
            note: '',
          },
        ],
      },
      '',
      new InMemoryOrderNotifier(),
      actor,
    );
    await updateOrderStatus(
      sql,
      created.order.id,
      'preparing',
      '',
      actor,
      new InMemoryOrderNotifier(),
      randomUUID(),
    );
    const [audit] = await sql<
      { order_actor: string; event_actor: string; reservation_actor: string }[]
    >`
      select o.created_by_user_id::text as order_actor,e.created_by_user_id::text as event_actor,r.created_by_user_id::text as reservation_actor
      from orders o join order_events e on e.order_id=o.id and e.status='preparing'
      join order_stock_reservations x on x.order_id=o.id join stock_reservations r on r.id=x.reservation_id
      where o.id=${created.order.id}`;
    expect(audit).toEqual({
      order_actor: adminUser,
      event_actor: adminUser,
      reservation_actor: adminUser,
    });
  });

  it('mantiene una sola caja abierta y concilia movimientos idempotentes', async () => {
    const actor = { kind: 'device' as const, deviceId: device, origin: 'android' as const };
    const opened = await openCashSession(
      sql,
      { idempotencyKey: randomUUID(), openingFundCents: 500 },
      actor,
    );
    await expect(
      openCashSession(sql, { idempotencyKey: randomUUID(), openingFundCents: 0 }, actor),
    ).rejects.toThrow('abierto');
    const key = randomUUID();
    await recordCashMovement(
      sql,
      { idempotencyKey: key, kind: 'income', amountCents: 1000, reason: 'Fondo adicional' },
      actor,
    );
    await recordCashMovement(
      sql,
      { idempotencyKey: key, kind: 'income', amountCents: 1000, reason: 'Fondo adicional' },
      actor,
    );
    expect((await cashSessionState(sql)).session).toMatchObject({ expectedCents: 1500 });
    const closed = await closeCashSession(
      sql,
      { idempotencyKey: randomUUID(), countedCents: 1450, note: 'Diferencia' },
      actor,
    );
    expect(closed.result).toMatchObject({
      id: opened.result.session!.id,
      expectedCents: 1500,
      differenceCents: -50,
    });
  });

  it('cobra pagos mixtos, calcula cambio y descuenta el reembolso de caja', async () => {
    const actor = { kind: 'device' as const, deviceId: device, origin: 'android' as const };
    const orderId = randomUUID();
    await sql`insert into orders(id,source,customer_name,subtotal_cents,total_cents,idempotency_key,created_by_device_id) values(${orderId},'manual_whatsapp','Cliente',10000,10000,${randomUUID()},${device})`;
    await openCashSession(sql, { idempotencyKey: randomUUID(), openingFundCents: 0 }, actor);
    const payment = await collectOrderPayment(
      sql,
      orderId,
      {
        idempotencyKey: randomUUID(),
        payments: [
          { method: 'card', receivedCents: 4000, appliedCents: 4000 },
          { method: 'cash', receivedCents: 10000, appliedCents: 6000 },
        ],
      },
      actor,
    );
    expect(payment.result).toMatchObject({
      appliedCents: 10000,
      changeCents: 4000,
      balanceCents: 0,
    });
    expect((await cashSessionState(sql)).session).toMatchObject({ expectedCents: 6000 });
    const [cashPayment] = await sql<
      { id: string }[]
    >`select id from order_payments where order_id=${orderId} and method='cash'`;
    await refundOrderPayment(
      sql,
      orderId,
      {
        idempotencyKey: randomUUID(),
        paymentId: cashPayment!.id,
        amountCents: 2000,
        reason: 'Devolución parcial',
      },
      actor,
    );
    expect((await cashSessionState(sql)).session).toMatchObject({ expectedCents: 4000 });
  });

  it('limita devoluciones por partida al importe asignado y conserva el vínculo', async () => {
    const actor = { kind: 'device' as const, deviceId: device, origin: 'android' as const };
    const orderId = randomUUID();
    await sql`insert into orders(id,source,customer_name,subtotal_cents,total_cents,idempotency_key,created_by_device_id) values(${orderId},'pos','Cliente',10000,10000,${randomUUID()},${device})`;
    const [firstItem] = await sql<{ id: string }[]>`
      insert into order_items(order_id,product_id,product_name,unit_price_cents,quantity,line_total_cents)
      values(${orderId},'burger','Burger',5000,1,5000) returning id
    `;
    const [secondItem] = await sql<{ id: string }[]>`
      insert into order_items(order_id,product_id,product_name,unit_price_cents,quantity,line_total_cents)
      values(${orderId},'burger','Burger',5000,1,5000) returning id
    `;
    await openCashSession(sql, { idempotencyKey: randomUUID(), openingFundCents: 10000 }, actor);
    await collectOrderPayment(
      sql,
      orderId,
      {
        idempotencyKey: randomUUID(),
        payments: [{ method: 'cash', receivedCents: 10000, appliedCents: 10000 }],
      },
      actor,
    );
    const [payment] = await sql<
      { id: string }[]
    >`select id from order_payments where order_id=${orderId}`;
    await refundOrderPayment(
      sql,
      orderId,
      {
        idempotencyKey: randomUUID(),
        paymentId: payment!.id,
        orderItemId: firstItem!.id,
        amountCents: 5000,
        reason: 'Devolución de la primera partida',
      },
      actor,
    );
    await expect(
      refundOrderPayment(
        sql,
        orderId,
        {
          idempotencyKey: randomUUID(),
          paymentId: payment!.id,
          orderItemId: firstItem!.id,
          amountCents: 1,
          reason: 'Intento de exceder la partida',
        },
        actor,
      ),
    ).rejects.toMatchObject({ statusCode: 409 });
    await refundOrderPayment(
      sql,
      orderId,
      {
        idempotencyKey: randomUUID(),
        paymentId: payment!.id,
        orderItemId: secondItem!.id,
        amountCents: 5000,
        reason: 'Devolución de la segunda partida',
      },
      actor,
    );
    const [refunds] = await sql<{ refunds: number; linked: number }[]>`
      select count(*)::int as refunds,count(order_item_id)::int as linked
      from order_refunds where order_id=${orderId}
    `;
    expect(refunds).toEqual({ refunds: 2, linked: 2 });
    await sql`update orders set status='delivered' where id=${orderId}`;
    expect((await getOrder(sql, orderId))?.balanceCents).toBe(0);
    await expect(
      collectOrderPayment(
        sql,
        orderId,
        {
          idempotencyKey: randomUUID(),
          payments: [{ method: 'card', receivedCents: 1, appliedCents: 1 }],
        },
        actor,
      ),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it('cobra y entrega mostrador en una sola operación idempotente', async () => {
    const actor = { kind: 'device' as const, deviceId: device, origin: 'android' as const };
    const notifier = new InMemoryOrderNotifier();
    const orderId = randomUUID();
    await sql`insert into orders(id,source,fulfillment,customer_name,subtotal_cents,total_cents,status,quoted_at,idempotency_key,created_by_device_id) values(${orderId},'pos','counter','Mostrador',10000,10000,'ready',now(),${randomUUID()},${device})`;
    await openCashSession(sql, { idempotencyKey: randomUUID(), openingFundCents: 0 }, actor);
    const key = randomUUID();
    const input = {
      idempotencyKey: key,
      payments: [
        { method: 'card' as const, receivedCents: 4000, appliedCents: 4000 },
        { method: 'cash' as const, receivedCents: 10000, appliedCents: 6000 },
      ],
    };
    const checkout = await checkoutCounterOrder(sql, orderId, input, actor, notifier);
    expect(checkout.order).toMatchObject({ status: 'delivered', balanceCents: 0 });
    expect(checkout.changeCents).toBe(4000);
    expect((await cashSessionState(sql)).session).toMatchObject({ expectedCents: 6000 });
    const retry = await checkoutCounterOrder(sql, orderId, input, actor, notifier);
    expect(retry.reused).toBe(true);
    expect(retry.order.status).toBe('delivered');
    const [counts] = await sql<{ payments: number; events: number }[]>`
      select (select count(*)::int from order_payments where order_id=${orderId}) as payments,
      (select count(*)::int from order_events where order_id=${orderId} and status='delivered') as events`;
    expect(counts).toEqual({ payments: 2, events: 1 });
  });

  it('concilia gastos de caja e impide duplicar comisiones de un pago', async () => {
    const actor = { kind: 'device' as const, deviceId: device, origin: 'android' as const };
    await openCashSession(sql, { idempotencyKey: randomUUID(), openingFundCents: 5000 }, actor);
    const cashKey = randomUUID();
    const cashExpense = {
      idempotencyKey: cashKey,
      category: 'utilities' as const,
      description: 'Gas del local',
      amountCents: 1000,
      paymentMethod: 'cash' as const,
      fundsOrigin: 'cash_session' as const,
      occurredAt: new Date().toISOString(),
    };
    await createOperatingExpense(sql, cashExpense, actor);
    expect((await cashSessionState(sql)).session).toMatchObject({ expectedCents: 4000 });
    expect((await createOperatingExpense(sql, cashExpense, actor)).reused).toBe(true);
    expect((await cashSessionState(sql)).session).toMatchObject({ expectedCents: 4000 });

    const orderId = randomUUID();
    await sql`insert into orders(id,source,customer_name,subtotal_cents,total_cents,idempotency_key,created_by_device_id) values(${orderId},'pos','Mostrador',2000,2000,${randomUUID()},${device})`;
    await collectOrderPayment(
      sql,
      orderId,
      {
        idempotencyKey: randomUUID(),
        payments: [{ method: 'card', receivedCents: 2000, appliedCents: 2000 }],
      },
      actor,
    );
    const [payment] = await sql<
      { id: string }[]
    >`select id from order_payments where order_id=${orderId}`;
    await createOperatingExpense(
      sql,
      {
        idempotencyKey: randomUUID(),
        category: 'commission',
        description: 'Comisión adquirente',
        amountCents: 100,
        paymentMethod: 'card',
        fundsOrigin: 'external',
        occurredAt: new Date().toISOString(),
        paymentId: payment!.id,
      },
      actor,
    );
    await expect(
      createOperatingExpense(
        sql,
        {
          idempotencyKey: randomUUID(),
          category: 'commission',
          description: 'Comisión duplicada',
          amountCents: 100,
          paymentMethod: 'card',
          fundsOrigin: 'external',
          occurredAt: new Date().toISOString(),
          paymentId: payment!.id,
        },
        actor,
      ),
    ).rejects.toThrow();
    expect((await cashSessionState(sql)).session).toMatchObject({ expectedCents: 4000 });
  });

  it('calcula el corte local y pagina detalle sin truncar el CSV', async () => {
    await pg.exec(`insert into operating_expenses(
      idempotency_key,category,description,amount_cents,payment_method,funds_origin,incurred_at,created_by_device_id
    ) select gen_random_uuid(),'supplies','Compra de prueba '||n,100,'transfer','external',
      '2026-09-22T12:00:00Z'::timestamptz,'${device}'::uuid from generate_series(1,225) n`);
    await pg.exec(
      "insert into categories(id,slug,name) values('sides','sides','Acompañamientos'); insert into products(id,slug,category_id,name,description,price_cents) values('fries','fries','sides','Papas','',10000)",
    );
    const [order] = await sql<{ id: string }[]>`
      insert into orders(source,fulfillment,status,customer_name,subtotal_cents,total_cents,idempotency_key,quoted_at,delivered_at,created_at,updated_at)
      values('pos','counter','delivered','Cliente',200,200,${randomUUID()},'2026-09-22T12:00:00Z','2026-09-22T12:00:00Z','2026-09-22T12:00:00Z','2026-09-22T12:00:00Z') returning id`;
    await sql`insert into order_items(order_id,product_id,product_name,unit_price_cents,quantity,line_total_cents) values
      (${order!.id},'burger','Burger',100,1,100),(${order!.id},'fries','Papas',100,1,100)`;
    const [payment] = await sql<{ id: string }[]>`
      insert into order_payments(order_id,idempotency_key,method,received_cents,applied_cents,change_cents)
      values(${order!.id},${randomUUID()},'card',200,200,0) returning id`;
    await sql`insert into order_refunds(order_id,payment_id,idempotency_key,method,amount_cents,reason,created_at)
      values(${order!.id},${payment!.id},${randomUUID()},'card',50,'Reembolso parcial','2026-09-22T13:00:00Z')`;
    await sql`insert into order_refunds(order_id,payment_id,order_item_id,idempotency_key,method,amount_cents,reason,created_at)
      values(${order!.id},${payment!.id},(select id from order_items where order_id=${order!.id} and product_id='burger'),${randomUUID()},'card',10,'Reembolso de burger','2026-09-22T14:00:00Z')`;
    const report = await profitabilityReport(sql, {
      from: '2026-09-22',
      to: '2026-09-22',
      page: 1,
      pageSize: 50,
    });
    expect(report.totalRows).toBe(228);
    expect(report.rows).toHaveLength(50);
    expect(report.summary.operatingExpensesCents).toBe(22500);
    expect(report.summary.grossSalesCents).toBe(200);
    expect(report.summary.refundsCents).toBe(60);
    expect(report.summary.netSalesCents).toBe(140);
    expect(report.summary.unvaluedDeliveredOrders).toBe(1);
    expect(report.byProduct).toEqual([
      { key: 'Papas', quantity: 1, amountCents: 75 },
      { key: 'Burger', quantity: 1, amountCents: 65 },
    ]);
    expect(report.summary.operatingResultCents).toBe(-22360);
    expect(new Date(report.from).toISOString()).toBe('2026-09-22T06:00:00.000Z');
    const csv = await profitabilityCsv(sql, { from: '2026-09-22', to: '2026-09-22' });
    expect(csv.split('\r\n')).toHaveLength(229);
  });

  it('persiste una copia inmutable del ticket y la recupera al reintentar', async () => {
    const actor = { kind: 'device' as const, deviceId: device, origin: 'android' as const };
    const orderId = randomUUID();
    await sql`insert into orders(id,source,customer_name,subtotal_cents,total_cents,status,idempotency_key,created_by_device_id) values(${orderId},'pos','Mostrador',10000,10000,'ready',${randomUUID()},${device})`;
    const key = randomUUID();
    await openCashSession(sql, { idempotencyKey: randomUUID(), openingFundCents: 0 }, actor);
    await collectOrderPayment(
      sql,
      orderId,
      {
        idempotencyKey: randomUUID(),
        payments: [{ method: 'card', receivedCents: 10000, appliedCents: 10000 }],
      },
      actor,
    );
    await sql`update orders set status='delivered',delivered_at=now() where id=${orderId}`;
    const issued = await issueOrderTicket(sql, orderId, { idempotencyKey: key }, actor);
    const issuedTicket = issued.result as unknown as OrderTicket;
    expect(issuedTicket.order.totalCents).toBe(10000);
    expect(issuedTicket.payments).toEqual([{ method: 'card', appliedCents: 10000 }]);
    await sql`update orders set customer_name='Nombre cambiado' where id=${orderId}`;
    const retry = await issueOrderTicket(sql, orderId, { idempotencyKey: key }, actor);
    expect(retry.reused).toBe(true);
    const recoveredTicket = retry.result as unknown as OrderTicket;
    expect(recoveredTicket.id).toBe(issuedTicket.id);
    expect(recoveredTicket.order.customerName).toBe('Mostrador');
    const [count] = await sql<
      { count: number }[]
    >`select count(*)::int as count from order_tickets where order_id=${orderId}`;
    expect(count!.count).toBe(1);
  });

  it('exige las capacidades base y cerrar las comandas antiguas antes del corte', async () => {
    const adminId = randomUUID();
    const actor = { kind: 'admin' as const, userId: adminId, origin: 'admin_web' as const };
    await sql`insert into admin_users(id,email,password_hash) values(${adminId},${`${adminId}@test.local`},'hash')`;
    await expect(
      activateCapability(
        sql,
        'pos_cutover',
        {
          idempotencyKey: randomUUID(),
          enabled: true,
          activationNote: 'Corte controlado de prueba',
        },
        actor,
      ),
    ).rejects.toThrow('Activa primero');
    for (const key of [
      'stock_ledger',
      'purchasing',
      'recipe_versions',
      'production',
      'unified_orders',
      'cash_sessions',
      'payments_refunds',
      'pos_tickets',
    ] as const) {
      await activateCapability(
        sql,
        key,
        { idempotencyKey: randomUUID(), enabled: true, activationNote: `Prueba controlada ${key}` },
        actor,
      );
    }
    const legacyOrder = randomUUID();
    await sql`insert into orders(id,source,customer_name,subtotal_cents,total_cents,idempotency_key,created_by_device_id) values(${legacyOrder},'manual_whatsapp','Pendiente legado',100,100,${randomUUID()},${device})`;
    await expect(
      activateCapability(
        sql,
        'pos_cutover',
        {
          idempotencyKey: randomUUID(),
          enabled: true,
          activationNote: 'Corte controlado de prueba',
        },
        actor,
      ),
    ).rejects.toThrow('Cierra o cancela');
    await sql`update orders set status='cancelled' where id=${legacyOrder}`;
    const cutover = await activateCapability(
      sql,
      'pos_cutover',
      { idempotencyKey: randomUUID(), enabled: true, activationNote: 'Corte controlado de prueba' },
      actor,
    );
    expect(cutover.result.enabled).toBe(true);
    expect((await capabilityReadiness(sql)).legacyPendingOrders).toBe(0);
    await expect(
      activateCapability(
        sql,
        'pos_cutover',
        { idempotencyKey: randomUUID(), enabled: false, activationNote: 'Prueba no reversible' },
        actor,
      ),
    ).rejects.toThrow('irreversible');
  });

  it('no habilita rentabilidad antes de activar su cadena completa de datos', async () => {
    await expect(
      activateCapability(
        sql,
        'profitability_reports',
        { idempotencyKey: randomUUID(), enabled: true, activationNote: 'Reporte de prueba' },
        { kind: 'device', deviceId: device, origin: 'android' },
      ),
    ).rejects.toThrow('Activa primero: stock_ledger');
  });

  it('no inventa costos para ingredientes sin compras', async () => {
    expect((await state()).products[0]!.cost_cents).toBeNull();
    await expect(sale()).rejects.toThrow('Existencia o costo insuficiente');
  });
  it('promedia compras y conserva el costo histórico al reabastecer', async () => {
    await purchase(1000, 10000);
    await purchase(1000, 20000);
    const before = await state();
    expect(before.products[0]).toMatchObject({
      cost_cents: 2350,
      recommended_price_cents: 5875,
      margin_percent: 76.5,
    });
    const sold = await sale(2);
    expect(sold.entry).toMatchObject({ total_cents: 20000, cost_cents: 4700 });
    expect(Number((await state()).ingredients[0]!.stock)).toBe(1700);
    await purchase(1000, 50000);
    const after = await state();
    expect(after.report).toMatchObject({
      revenue_cents: '20000',
      cost_cents: '4700',
      sales_count: 1,
    });
    expect(after.products[0]!.cost_cents).not.toBe(2350);
  });
  it('revierte todas las líneas si una venta supera el stock', async () => {
    await purchase(200, 2000);
    await expect(
      recordEntry(
        sql,
        {
          kind: 'sale',
          expectedTotalCents: 20000,
          description: 'No alcanza',
          payment: 'cash',
          idempotencyKey: randomUUID(),
          lines: [
            { productId: 'burger', quantity: 1 },
            { productId: 'burger', quantity: 1 },
          ],
        },
        device,
      ),
    ).rejects.toThrow('Existencia');
    expect(Number((await state()).ingredients[0]!.stock)).toBe(200);
    expect((await state()).report!.sales_count).toBe(0);
  });
  it('reintentar compras y cobros no duplica movimientos', async () => {
    const purchaseKey = randomUUID(),
      saleKey = randomUUID();
    await purchase(1000, 10000, purchaseKey);
    expect((await purchase(1000, 10000, purchaseKey)).reused).toBe(true);
    await sale(1, saleKey);
    expect((await sale(1, saleKey)).reused).toBe(true);
    const result = await state();
    expect(Number(result.ingredients[0]!.stock)).toBe(850);
    expect(result.report!.sales_count).toBe(1);
    expect(result.entries).toHaveLength(2);
  });
  it('registra mermas y gastos sin confundirlos con compras o ventas', async () => {
    await purchase();
    await recordEntry(
      sql,
      {
        kind: 'waste',
        description: 'Caducidad',
        ingredientId: ingredient,
        quantity: 100,
        idempotencyKey: randomUUID(),
      },
      device,
    );
    await recordEntry(
      sql,
      { kind: 'expense', description: 'Gas', totalCents: 5000, idempotencyKey: randomUUID() },
      device,
    );
    const result = await state();
    expect(Number(result.ingredients[0]!.stock)).toBe(900);
    expect(result.report).toMatchObject({
      waste_cents: '1000',
      expenses_cents: '5000',
      revenue_cents: '0',
      purchases_cents: '10000',
    });
  });
  it('agota existencias fraccionarias sin residuos monetarios', async () => {
    await saveRecipe(sql, {
      productId: 'burger',
      targetMargin: 65,
      overheadCents: 0,
      priceCents: 1000,
      lines: [{ ingredientId: ingredient, quantity: 0.333 }],
    });
    await purchase(0.999, 100);
    await sale(3, randomUUID(), 1000);
    const result = await state();
    expect(Number(result.ingredients[0]!.stock)).toBe(0);
    expect(Number(result.ingredients[0]!.value_cents)).toBe(0);
    expect(result.report!.cost_cents).toBe('100');
  });
  it('filtra reportes por fechas y valida cantidades y recetas duplicadas', async () => {
    await purchase();
    expect(
      (await businessState(sql, '2000-01-01T00:00:00Z', '2001-01-01T00:00:00Z')).entries,
    ).toHaveLength(0);
    expect(
      entrySchema.safeParse({
        kind: 'purchase',
        description: 'x',
        idempotencyKey: randomUUID(),
        lines: [{ ingredientId: ingredient, quantity: -1, totalCents: 100 }],
      }).success,
    ).toBe(false);
    expect(
      recipeSchema.safeParse({
        productId: 'burger',
        targetMargin: 100,
        overheadCents: 0,
        priceCents: 100,
        lines: [{ ingredientId: ingredient, quantity: 1 }],
      }).success,
    ).toBe(false);
    expect(
      recipeSchema.safeParse({
        productId: 'burger',
        targetMargin: 65,
        overheadCents: 0,
        priceCents: 100,
        lines: [
          { ingredientId: ingredient, quantity: 1 },
          { ingredientId: ingredient, quantity: 2 },
        ],
      }).success,
    ).toBe(false);
  });
  it('rechaza reutilizar una clave con otros datos y cobrar un precio distinto al confirmado', async () => {
    const key = randomUUID();
    await purchase(1000, 10000, key);
    await expect(purchase(2000, 10000, key)).rejects.toThrow('otra operación');
    await expect(sale(1, randomUUID(), 9999)).rejects.toThrow('El precio cambió');
    expect(Number((await state()).ingredients[0]!.stock)).toBe(1000);
  });
  it('persiste reservas y evita que dos operaciones tomen la misma disponibilidad', async () => {
    await purchase(1000, 10000);
    const actor = { kind: 'device' as const, deviceId: device, origin: 'android' as const };
    const first = await reserveStock(
      sql,
      {
        idempotencyKey: randomUUID(),
        ingredientId: ingredient,
        quantity: '800',
        referenceType: 'test',
        referenceId: 'one',
        reason: 'Prueba de reserva',
      },
      actor,
    );
    expect(first.result.ingredient.available).toBe('200.000');
    await expect(
      reserveStock(
        sql,
        {
          idempotencyKey: randomUUID(),
          ingredientId: ingredient,
          quantity: '201',
          referenceType: 'test',
          referenceId: 'two',
          reason: 'Prueba concurrente',
        },
        actor,
      ),
    ).rejects.toThrow('disponible');
    await releaseStockReservation(
      sql,
      first.result.reservation.id,
      {
        idempotencyKey: randomUUID(),
        reason: 'Cancelación de prueba',
      },
      actor,
    );
    expect((await stockLedgerState(sql)).ingredients[0]).toMatchObject({
      stock: '1000.000',
      reserved: '0.000',
    });
  });
  it('impide conteos con reservas y conserva un movimiento valorizado para merma', async () => {
    await purchase(1000, 10000);
    const actor = { kind: 'device' as const, deviceId: device, origin: 'android' as const };
    const reservation = await reserveStock(
      sql,
      {
        idempotencyKey: randomUUID(),
        ingredientId: ingredient,
        quantity: '100',
        referenceType: 'test',
        referenceId: 'count',
        reason: 'Reserva de conteo',
      },
      actor,
    );
    await expect(
      countStock(
        sql,
        {
          idempotencyKey: randomUUID(),
          ingredientId: ingredient,
          countedQuantity: '900',
          reason: 'Conteo semanal',
        },
        actor,
      ),
    ).rejects.toThrow('reservas');
    await releaseStockReservation(
      sql,
      reservation.result.reservation.id,
      {
        idempotencyKey: randomUUID(),
        reason: 'Liberar antes de conteo',
      },
      actor,
    );
    await countStock(
      sql,
      {
        idempotencyKey: randomUUID(),
        ingredientId: ingredient,
        countedQuantity: '900',
        reason: 'Conteo semanal',
      },
      actor,
    );
    await writeOffStock(
      sql,
      {
        idempotencyKey: randomUUID(),
        ingredientId: ingredient,
        quantity: '100',
        reason: 'Producto vencido',
        cause: 'expired',
      },
      actor,
    );
    const ledger = await stockLedgerState(sql);
    expect(ledger.ingredients[0]).toMatchObject({ stock: '800.000', value_cents: '8000.000000' });
    expect(ledger.movements.map((item) => item.movement_type)).toContain('count');
    expect(ledger.movements.map((item) => item.movement_type)).toContain('waste');
  });
  it('prorratea descuentos y gastos de compra sin alterar la equivalencia histórica', async () => {
    const supplier = randomUUID(),
      presentation = randomUUID();
    await pg.query('insert into suppliers(id,name) values($1,$2)', [supplier, 'Proveedor']);
    await pg.query(
      'insert into ingredient_presentations(id,ingredient_id,supplier_id,name,base_quantity) values($1,$2,$3,$4,$5)',
      [presentation, ingredient, supplier, 'Bolsa 1 kg', '1000'],
    );
    await openCashSession(
      sql,
      { idempotencyKey: randomUUID(), openingFundCents: 2000 },
      { kind: 'device', deviceId: device, origin: 'android' },
    );
    const result = await createPurchase(
      sql,
      {
        idempotencyKey: randomUUID(),
        supplierId: supplier,
        reference: 'F-1',
        paymentMethod: 'cash',
        fundsOrigin: 'cash_session',
        discountCents: 100,
        acquisitionCents: 50,
        lines: [
          {
            ingredientId: ingredient,
            presentationId: presentation,
            presentationQuantity: '1.000',
            grossCents: 1000,
          },
        ],
      },
      { kind: 'device', deviceId: device, origin: 'android' },
    );
    expect(result.result).toMatchObject({
      totalCents: 950,
      lines: [{ appliedBaseQuantity: '1000.000', inventoryValueCents: 950 }],
    });
    expect(Number((await state()).ingredients[0]!.stock)).toBe(1000);
    expect((await cashSessionState(sql)).session).toMatchObject({ expectedCents: 1050 });
  });
  it('revierte una compra sin consumos posteriores y no permite repetirla', async () => {
    const supplier = randomUUID(),
      presentation = randomUUID(),
      actor = { kind: 'device' as const, deviceId: device, origin: 'android' as const };
    await pg.query('insert into suppliers(id,name) values($1,$2)', [
      supplier,
      'Proveedor reversión',
    ]);
    await pg.query(
      'insert into ingredient_presentations(id,ingredient_id,supplier_id,name,base_quantity) values($1,$2,$3,$4,$5)',
      [presentation, ingredient, supplier, 'Caja', '100'],
    );
    const purchaseResult = await createPurchase(
      sql,
      {
        idempotencyKey: randomUUID(),
        supplierId: supplier,
        reference: 'R-1',
        paymentMethod: 'card',
        fundsOrigin: 'external',
        discountCents: 0,
        acquisitionCents: 0,
        lines: [
          {
            ingredientId: ingredient,
            presentationId: presentation,
            presentationQuantity: '1.000',
            grossCents: 200,
          },
        ],
      },
      actor,
    );
    await reversePurchase(
      sql,
      purchaseResult.result.purchaseId,
      { idempotencyKey: randomUUID(), reason: 'Factura capturada dos veces' },
      actor,
    );
    expect(Number((await state()).ingredients[0]!.stock)).toBe(0);
    await expect(
      reversePurchase(
        sql,
        purchaseResult.result.purchaseId,
        { idempotencyKey: randomUUID(), reason: 'Segundo intento' },
        actor,
      ),
    ).rejects.toThrow('ya fue revertida');
  });
  it('versiona recetas con actor e idempotencia, conservando la composición anterior', async () => {
    const actor = { kind: 'device' as const, deviceId: device, origin: 'android' as const };
    const firstInput = {
      idempotencyKey: randomUUID(),
      productId: 'burger',
      targetMargin: 60,
      overheadCents: 100,
      components: [
        {
          kind: 'ingredient' as const,
          ingredientId: ingredient,
          quantity: '150',
          removable: false,
          extra: false,
        },
      ],
    };
    const first = await createRecipeVersion(sql, firstInput, actor);
    expect(first).toMatchObject({ result: { versionNumber: 1 }, reused: false });
    expect(await createRecipeVersion(sql, firstInput, actor)).toMatchObject({
      result: first.result,
      reused: true,
    });
    const second = await createRecipeVersion(
      sql,
      { ...firstInput, idempotencyKey: randomUUID(), targetMargin: 65 },
      actor,
    );
    expect(second.result.versionNumber).toBe(2);
    const state = await recipeVersionState(sql, 'burger');
    expect(state.versions.map((version) => version.status)).toEqual(['active', 'retired']);
    expect(state.components).toHaveLength(2);
    await expect(
      createRecipeVersion(
        sql,
        {
          ...firstInput,
          idempotencyKey: randomUUID(),
          components: [
            {
              kind: 'product',
              productId: 'burger',
              quantity: '1',
              removable: false,
              extra: false,
            },
          ],
        },
        actor,
      ),
    ).rejects.toThrow('ciclo');
  });
  it('migra una receta existente una sola vez y conserva su composición', async () => {
    const migration = (
      await readFile(new URL('../migrations/0008_recipe_versions.sql', import.meta.url), 'utf8')
    ).replace('CREATE EXTENSION IF NOT EXISTS pgcrypto;', '');
    await pg.exec(migration);
    await pg.exec(migration);
    const migrated = await recipeVersionState(sql, 'burger');
    expect(migrated.versions).toMatchObject([{ version_number: 1, status: 'active' }]);
    expect(migrated.components).toMatchObject([
      { component_kind: 'ingredient', ingredient_id: ingredient, quantity: '150.000' },
    ]);
  });
  it('consume insumos y registra un lote preparado con el rendimiento real', async () => {
    const actor = { kind: 'device' as const, deviceId: device, origin: 'android' as const };
    await purchase(1000, 15000);
    await createRecipeVersion(
      sql,
      {
        idempotencyKey: randomUUID(),
        productId: 'burger',
        targetMargin: 60,
        overheadCents: 0,
        components: [
          {
            kind: 'ingredient',
            ingredientId: ingredient,
            quantity: '200',
            removable: false,
            extra: false,
          },
        ],
      },
      actor,
    );
    const batch = await createProductionBatch(
      sql,
      {
        idempotencyKey: randomUUID(),
        productId: 'burger',
        outputQuantity: '150',
        outputUnit: 'g',
        reason: 'Lote de prueba',
      },
      actor,
    );
    expect(batch.result).toMatchObject({ outputQuantity: '150', consumedCostCents: '3000.000000' });
    const ledger = await stockLedgerState(sql);
    expect(
      ledger.ingredients.find((item) => item.id === batch.result.outputIngredientId),
    ).toMatchObject({
      stock: '150.000',
      value_cents: '3000.000000',
    });
    expect(ledger.movements.map((item) => item.movement_type)).toContain('production_output');
  });
});

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

// Runs the actual migration and service SQL on embedded PostgreSQL. This adapter
// only bridges tagged parameters/results; it does not simulate inventory logic.
let pg: PGlite;
let sql: Sql;
const device = randomUUID();
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
    ]) {
      // gen_random_uuid is built into PostgreSQL; pgcrypto isn't required here.
      const migration = (
        await readFile(new URL(`../migrations/${name}`, import.meta.url), 'utf8')
      ).replace('CREATE EXTENSION IF NOT EXISTS pgcrypto;', '');
      await pg.exec(migration);
    }
    await pg.query('insert into mobile_devices(id,name) values($1,$2)', [device, 'Prueba']);
    await pg.exec(
      "insert into categories(id,slug,name) values('burgers','burgers','Burgers'); insert into products(id,slug,category_id,name,description,price_cents) values('burger','burger','burgers','Burger','',10000)",
    );
  }, 30000);
  beforeEach(async () => {
    await pg.exec(
      'delete from recipe_version_components; delete from recipe_versions; delete from purchase_reversals; delete from purchase_lines; delete from purchase_documents; delete from ingredient_presentations; delete from suppliers; delete from stock_ledger_movements; delete from stock_reservations; delete from stock_movements; delete from business_entries; delete from recipe_lines; delete from product_recipes; delete from stock_ingredients;',
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
    const result = await createPurchase(
      sql,
      {
        idempotencyKey: randomUUID(),
        supplierId: supplier,
        reference: 'F-1',
        paymentMethod: 'cash',
        fundsOrigin: 'external',
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
});

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  operatorDeviceActivationSchema,
  orderCreateRequestSchema,
  orderDraftParseRequestSchema,
  orderStatusSchema,
  orderStatusUpdateSchema,
  spinCodeIssueRequestSchema,
  stockCountRequestSchema,
  stockReservationRequestSchema,
  stockReservationResolveRequestSchema,
  stockWasteRequestSchema,
  supplierCreateSchema,
  presentationCreateSchema,
  purchaseCreateSchema,
  productionBatchCreateSchema,
  recipeVersionCreateSchema,
  unifiedOrderQuoteSchema,
  unifiedOrderConfirmSchema,
  cashSessionOpenSchema,
  cashMovementSchema,
  cashSessionCloseSchema,
  orderPaymentCreateSchema,
  orderRefundCreateSchema,
  counterCheckoutSchema,
  ticketIssueSchema,
  expenseCreateSchema,
  profitabilityReportSchema,
  reportPeriodSchema,
} from '@bj/contracts';
import type { AppConfig } from './config.js';
import type { Database } from './db/client.js';
import {
  type InMemoryOrderNotifier,
  OrderError,
  createOrder,
  createUnifiedOrder,
  getOrder,
  issueOrderSpinCode,
  listOrders,
  parseWhatsAppOrder,
  updateOrderStatus,
} from './order-service.js';
import { createOpaqueToken, digestToken } from './security.js';
import { loadCatalog } from './catalog-repository.js';
import {
  businessState,
  entrySchema,
  ingredientSchema,
  recipeSchema,
  recordEntry,
  saveRecipe,
} from './business-service.js';
import { getCapabilities, requireCapability } from './pos-foundation-service.js';
import {
  countStock,
  releaseStockReservation,
  reserveStock,
  stockLedgerState,
  writeOffStock,
} from './stock-ledger-service.js';
import { createPurchase } from './purchasing-service.js';
import { createRecipeVersion, recipeVersionState } from './recipe-version-service.js';
import { createProductionBatch } from './production-service.js';
import { issueOrderTicket } from './ticket-service.js';
import { createOperatingExpense } from './expense-service.js';
import { profitabilityReport } from './profitability-service.js';
import { calculateCart } from '@bj/contracts';
import {
  cashSessionState,
  closeCashSession,
  openCashSession,
  recordCashMovement,
} from './cash-session-service.js';
import {
  checkoutCounterOrder,
  collectOrderPayment,
  refundOrderPayment,
} from './payment-service.js';

interface OperatorContext {
  deviceId: string;
  deviceName: string;
}

async function operatorFor(
  request: FastifyRequest,
  database: Database,
  config: AppConfig,
): Promise<OperatorContext | null> {
  const value = request.headers.authorization;
  const token = value?.startsWith('Bearer ') ? value.slice('Bearer '.length) : '';
  if (!token) return null;
  const digest = digestToken(token, config.SESSION_SECRET);
  const rows = await database.sql<{ id: string; name: string }[]>`
    select id, name from mobile_devices where token_digest=${digest} and active=true limit 1`;
  if (!rows[0]) return null;
  await database.sql`update mobile_devices set last_seen_at=now(), updated_at=now() where id=${rows[0].id}`;
  return { deviceId: rows[0].id, deviceName: rows[0].name };
}

async function protectOperator(
  request: FastifyRequest,
  reply: FastifyReply,
  database: Database,
  config: AppConfig,
) {
  const context = await operatorFor(request, database, config);
  if (!context) {
    await reply.code(401).send({ message: 'Dispositivo no autorizado o revocado.' });
    return;
  }
  return context;
}

export async function registerOperator(
  app: FastifyInstance,
  database: Database,
  config: AppConfig,
  notifier: InMemoryOrderNotifier,
) {
  app.get('/api/v1/operator/business', async (request, reply) => {
    if (!(await protectOperator(request, reply, database, config))) return;
    reply.header('cache-control', 'no-store');
    const query = z
      .object({ from: z.iso.datetime({ offset: true }), to: z.iso.datetime({ offset: true }) })
      .parse(request.query);
    if (Date.parse(query.to) <= Date.parse(query.from))
      return reply.code(400).send({ message: 'El período no es válido.' });
    return businessState(database.sql, query.from, query.to);
  });
  app.post('/api/v1/operator/business/ingredients', async (request, reply) => {
    if (!(await protectOperator(request, reply, database, config))) return;
    const input = ingredientSchema.parse(request.body);
    const rows =
      await database.sql`insert into stock_ingredients(name,unit,minimum) values(${input.name},${input.unit},${input.minimum}) on conflict(name) do nothing returning *`;
    if (!rows.length)
      return reply.code(409).send({ message: 'Ya existe un ingrediente con ese nombre.' });
    return reply.code(201).send({ ingredient: rows[0] });
  });
  app.post('/api/v1/operator/business/recipes', async (request, reply) => {
    if (!(await protectOperator(request, reply, database, config))) return;
    if (
      (await getCapabilities(database.sql)).some(
        (item) => item.key === 'recipe_versions' && item.enabled,
      )
    )
      return reply
        .code(409)
        .send({ message: 'Actualiza la app para guardar recetas versionadas.' });
    return saveRecipe(database.sql, recipeSchema.parse(request.body));
  });
  app.post('/api/v1/operator/recipes/versions', async (request, reply) => {
    const context = await protectOperator(request, reply, database, config);
    if (!context) return;
    await requireCapability(database.sql, 'recipe_versions');
    const outcome = await createRecipeVersion(
      database.sql,
      recipeVersionCreateSchema.parse(request.body),
      { kind: 'device', deviceId: context.deviceId, origin: 'android' },
    );
    return reply
      .code(outcome.statusCode)
      .send(Object.assign({}, outcome.result, { reused: outcome.reused }));
  });
  app.get('/api/v1/operator/recipes/versions', async (request, reply) => {
    if (!(await protectOperator(request, reply, database, config))) return;
    const { productId } = z
      .object({ productId: z.string().min(1).optional() })
      .parse(request.query);
    reply.header('cache-control', 'no-store');
    return recipeVersionState(database.sql, productId);
  });
  app.post('/api/v1/operator/production/batches', async (request, reply) => {
    const context = await protectOperator(request, reply, database, config);
    if (!context) return;
    await requireCapability(database.sql, 'production');
    const outcome = await createProductionBatch(
      database.sql,
      productionBatchCreateSchema.parse(request.body),
      { kind: 'device', deviceId: context.deviceId, origin: 'android' },
    );
    return reply
      .code(outcome.statusCode)
      .send(Object.assign({}, outcome.result as object, { reused: outcome.reused }));
  });
  app.get('/api/v1/operator/cash-session', async (request, reply) => {
    if (!(await protectOperator(request, reply, database, config))) return;
    return cashSessionState(database.sql);
  });
  app.post('/api/v1/operator/cash-session/open', async (request, reply) => {
    const context = await protectOperator(request, reply, database, config);
    if (!context) return;
    await requireCapability(database.sql, 'cash_sessions');
    const outcome = await openCashSession(database.sql, cashSessionOpenSchema.parse(request.body), {
      kind: 'device',
      deviceId: context.deviceId,
      origin: 'android',
    });
    return reply.code(outcome.statusCode).send({ ...outcome.result, reused: outcome.reused });
  });
  app.post('/api/v1/operator/cash-session/movements', async (request, reply) => {
    const context = await protectOperator(request, reply, database, config);
    if (!context) return;
    await requireCapability(database.sql, 'cash_sessions');
    const outcome = await recordCashMovement(database.sql, cashMovementSchema.parse(request.body), {
      kind: 'device',
      deviceId: context.deviceId,
      origin: 'android',
    });
    return reply.code(outcome.statusCode).send({ ...outcome.result, reused: outcome.reused });
  });
  app.post('/api/v1/operator/cash-session/close', async (request, reply) => {
    const context = await protectOperator(request, reply, database, config);
    if (!context) return;
    await requireCapability(database.sql, 'cash_sessions');
    const outcome = await closeCashSession(
      database.sql,
      cashSessionCloseSchema.parse(request.body),
      { kind: 'device', deviceId: context.deviceId, origin: 'android' },
    );
    return reply.code(outcome.statusCode).send({ ...outcome.result, reused: outcome.reused });
  });

  app.post('/api/v1/operator/unified-orders/quote', async (request, reply) => {
    if (!(await protectOperator(request, reply, database, config))) return;
    const input = unifiedOrderQuoteSchema.parse(request.body);
    if (input.fulfillment === 'delivery' && (!input.neighborhood || !input.streetAndNumber))
      return reply.code(400).send({ message: 'Domicilio requiere colonia y dirección.' });
    const catalog = await loadCatalog(database);
    const totals = calculateCart(
      catalog,
      input.items.map((item, index) => ({
        id: `quote-${index}`,
        productId: item.productId,
        quantity: item.quantity,
        removedIngredients: item.removedIngredients,
        modifierIds: item.modifierIds,
        combo: item.combo,
        ...(item.drinkProductId ? { drinkProductId: item.drinkProductId } : {}),
        note: item.note,
      })),
    );
    if (input.manualDiscountCents > totals.totalCents)
      return reply
        .code(400)
        .send({ message: 'El descuento supera el total después de promociones.' });
    const totalCents = totals.totalCents - input.manualDiscountCents;
    return {
      fulfillment: input.fulfillment,
      subtotalCents: totalCents,
      deliveryCents: 0,
      totalCents,
      manualDiscountCents: input.manualDiscountCents,
      manualDiscountReason: input.manualDiscountReason,
      promotion: totals.promotion ?? null,
    };
  });
  app.post('/api/v1/operator/unified-orders', async (request, reply) => {
    const context = await protectOperator(request, reply, database, config);
    if (!context) return;
    await requireCapability(database.sql, 'unified_orders');
    const input = unifiedOrderConfirmSchema.parse(request.body);
    if (input.fulfillment === 'delivery' && (!input.neighborhood || !input.streetAndNumber))
      return reply.code(400).send({ message: 'Domicilio requiere colonia y dirección.' });
    const catalog = await loadCatalog(database);
    try {
      const outcome = await createUnifiedOrder(
        database.sql,
        catalog,
        input,
        context.deviceId,
        notifier,
      );
      return reply.code(outcome.statusCode).send({ order: outcome.order, reused: outcome.reused });
    } catch (error) {
      if (error instanceof OrderError)
        return reply.code(error.statusCode).send({ message: error.message });
      throw error;
    }
  });
  app.post('/api/v1/operator/business/entries', async (request, reply) => {
    const context = await protectOperator(request, reply, database, config);
    if (!context) return;
    const input = entrySchema.parse(request.body);
    if (input.kind === 'sale') {
      const [capability] = await database.sql<{ enabled: boolean }[]>`
        select enabled from pos_capabilities where capability in ('unified_orders','pos_cutover') and enabled=true limit 1`;
      if (capability)
        return reply
          .code(409)
          .send({ message: 'Las ventas se registran desde el circuito unificado de comandas.' });
    }
    return recordEntry(database.sql, input, context.deviceId);
  });
  app.get('/api/v1/operator/inventory/ledger', async (request, reply) => {
    if (!(await protectOperator(request, reply, database, config))) return;
    await requireCapability(database.sql, 'stock_ledger');
    const { limit, cursor } = z
      .object({
        limit: z.coerce.number().int().min(1).max(200).default(100),
        cursor: z.uuid().optional(),
      })
      .parse(request.query);
    return stockLedgerState(database.sql, limit, cursor);
  });
  app.post('/api/v1/operator/inventory/reservations', async (request, reply) => {
    const context = await protectOperator(request, reply, database, config);
    if (!context) return;
    await requireCapability(database.sql, 'stock_ledger');
    const outcome = await reserveStock(
      database.sql,
      stockReservationRequestSchema.parse(request.body),
      {
        kind: 'device',
        deviceId: context.deviceId,
        origin: 'android',
      },
    );
    return reply
      .code(outcome.statusCode)
      .send(Object.assign({}, outcome.result as object, { reused: outcome.reused }));
  });
  app.post('/api/v1/operator/inventory/reservations/:id/release', async (request, reply) => {
    const context = await protectOperator(request, reply, database, config);
    if (!context) return;
    await requireCapability(database.sql, 'stock_ledger');
    const outcome = await releaseStockReservation(
      database.sql,
      z.uuid().parse((request.params as { id: string }).id),
      stockReservationResolveRequestSchema.parse(request.body),
      { kind: 'device', deviceId: context.deviceId, origin: 'android' },
    );
    return reply
      .code(outcome.statusCode)
      .send(Object.assign({}, outcome.result as object, { reused: outcome.reused }));
  });
  app.post('/api/v1/operator/inventory/counts', async (request, reply) => {
    const context = await protectOperator(request, reply, database, config);
    if (!context) return;
    await requireCapability(database.sql, 'stock_ledger');
    const outcome = await countStock(database.sql, stockCountRequestSchema.parse(request.body), {
      kind: 'device',
      deviceId: context.deviceId,
      origin: 'android',
    });
    return reply
      .code(outcome.statusCode)
      .send(Object.assign({}, outcome.result as object, { reused: outcome.reused }));
  });
  app.post('/api/v1/operator/inventory/write-offs', async (request, reply) => {
    const context = await protectOperator(request, reply, database, config);
    if (!context) return;
    await requireCapability(database.sql, 'stock_ledger');
    const outcome = await writeOffStock(database.sql, stockWasteRequestSchema.parse(request.body), {
      kind: 'device',
      deviceId: context.deviceId,
      origin: 'android',
    });
    return reply
      .code(outcome.statusCode)
      .send(Object.assign({}, outcome.result as object, { reused: outcome.reused }));
  });
  app.post('/api/v1/operator/purchasing/suppliers', async (request, reply) => {
    const context = await protectOperator(request, reply, database, config);
    if (!context) return;
    await requireCapability(database.sql, 'purchasing');
    const input = supplierCreateSchema.parse(request.body);
    const rows =
      await database.sql`insert into suppliers(name,contact_name,contact_phone) values(${input.name},${input.contactName},${input.contactPhone}) on conflict(name) do nothing returning *`;
    if (!rows[0])
      return reply.code(409).send({ message: 'Ya existe un proveedor con ese nombre.' });
    return reply.code(201).send({ supplier: rows[0] });
  });
  app.post('/api/v1/operator/purchasing/presentations', async (request, reply) => {
    const context = await protectOperator(request, reply, database, config);
    if (!context) return;
    await requireCapability(database.sql, 'purchasing');
    const input = presentationCreateSchema.parse(request.body);
    const rows =
      await database.sql`insert into ingredient_presentations(ingredient_id,supplier_id,name,base_quantity) values(${input.ingredientId},${input.supplierId ?? null},${input.name},${input.baseQuantity}) on conflict(ingredient_id,name) do nothing returning *`;
    if (!rows[0])
      return reply.code(409).send({ message: 'Ya existe esa presentación para el ingrediente.' });
    return reply.code(201).send({ presentation: rows[0] });
  });
  app.post('/api/v1/operator/purchasing/purchases', async (request, reply) => {
    const context = await protectOperator(request, reply, database, config);
    if (!context) return;
    await requireCapability(database.sql, 'purchasing');
    const result = await createPurchase(database.sql, purchaseCreateSchema.parse(request.body), {
      kind: 'device',
      deviceId: context.deviceId,
      origin: 'android',
    });
    return reply
      .code(result.statusCode)
      .send(Object.assign({}, result.result as object, { reused: result.reused }));
  });
  app.post('/api/v1/operator/purchasing/purchases/:id/reverse', async (request, reply) => {
    const context = await protectOperator(request, reply, database, config);
    if (!context) return;
    await requireCapability(database.sql, 'purchasing');
    const { purchaseReversalSchema } = await import('@bj/contracts');
    const { reversePurchase } = await import('./purchasing-service.js');
    const result = await reversePurchase(
      database.sql,
      z.uuid().parse((request.params as { id: string }).id),
      purchaseReversalSchema.parse(request.body),
      { kind: 'device', deviceId: context.deviceId, origin: 'android' },
    );
    return reply
      .code(result.statusCode)
      .send(Object.assign({}, result.result as object, { reused: result.reused }));
  });
  app.get('/api/v1/openapi.json', async () => ({
    openapi: '3.1.0',
    info: { title: 'B&J Burgers API', version: '1.1.0' },
    paths: {
      '/api/v1/operator/devices/activate': {
        post: { summary: 'Vincula un Android con código temporal' },
      },
      '/api/v1/operator/order-drafts/parse': {
        post: { summary: 'Interpreta mensaje de WhatsApp' },
      },
      '/api/v1/operator/orders': {
        get: { summary: 'Lista comandas' },
        post: { summary: 'Crea comanda confirmada' },
      },
      '/api/v1/operator/orders/{id}': { get: { summary: 'Detalle de comanda' } },
      '/api/v1/operator/orders/{id}/status': { patch: { summary: 'Actualiza estado de comanda' } },
      '/api/v1/operator/orders/{id}/spin-code': {
        post: { summary: 'Emite código único de ruleta' },
      },
      '/api/v1/operator/orders/stream': { get: { summary: 'Eventos SSE de comandas' } },
    },
  }));

  app.post(
    '/api/v1/operator/devices/activate',
    { config: { rateLimit: { max: 8, timeWindow: '15 minutes' } } },
    async (request, reply) => {
      const input = operatorDeviceActivationSchema.parse(request.body);
      try {
        return await database.sql.begin(async (tx) => {
          const rows = await tx<
            {
              id: string;
              name: string;
              pairing_digest: string | null;
              pairing_expires_at: Date | null;
              active: boolean;
            }[]
          >`select id, name, pairing_digest, pairing_expires_at, active from mobile_devices where id=${input.deviceId} for update`;
          const device = rows[0];
          if (
            !device ||
            !device.active ||
            !device.pairing_digest ||
            !device.pairing_expires_at ||
            device.pairing_expires_at < new Date() ||
            device.pairing_digest !== digestToken(input.pairingCode, config.SESSION_SECRET)
          )
            throw new OrderError(401, 'El código de vinculación no es válido o venció.');
          const token = createOpaqueToken();
          await tx`
            update mobile_devices
            set token_digest=${digestToken(token, config.SESSION_SECRET)}, pairing_digest=null, pairing_expires_at=null,
                pairing_used_at=now(), last_seen_at=now(), updated_at=now()
            where id=${device.id}`;
          return { device: { id: device.id, name: device.name }, credential: token };
        });
      } catch (error) {
        if (error instanceof OrderError)
          return reply.code(error.statusCode).send({ message: error.message });
        throw error;
      }
    },
  );

  app.post('/api/v1/operator/order-drafts/parse', async (request, reply) => {
    const context = await protectOperator(request, reply, database, config);
    if (!context) return;
    const input = orderDraftParseRequestSchema.parse(request.body);
    const catalog = await loadCatalog(database);
    return parseWhatsAppOrder(input.rawMessage, catalog);
  });

  app.post('/api/v1/operator/orders/:id/payments', async (request, reply) => {
    const context = await protectOperator(request, reply, database, config);
    if (!context) return;
    await requireCapability(database.sql, 'payments_refunds');
    const id = z.uuid().parse((request.params as { id: string }).id);
    const outcome = await collectOrderPayment(
      database.sql,
      id,
      orderPaymentCreateSchema.parse(request.body),
      { kind: 'device', deviceId: context.deviceId, origin: 'android' },
    );
    return reply.code(outcome.statusCode).send({ ...outcome.result, reused: outcome.reused });
  });
  app.post('/api/v1/operator/orders/:id/counter-checkout', async (request, reply) => {
    const context = await protectOperator(request, reply, database, config);
    if (!context) return;
    await requireCapability(database.sql, 'unified_orders');
    await requireCapability(database.sql, 'payments_refunds');
    const id = z.uuid().parse((request.params as { id: string }).id);
    const outcome = await checkoutCounterOrder(
      database.sql,
      id,
      counterCheckoutSchema.parse(request.body),
      { kind: 'device', deviceId: context.deviceId, origin: 'android' },
      notifier,
    );
    return reply.send(outcome);
  });
  app.post('/api/v1/operator/orders/:id/refunds', async (request, reply) => {
    const context = await protectOperator(request, reply, database, config);
    if (!context) return;
    await requireCapability(database.sql, 'payments_refunds');
    const id = z.uuid().parse((request.params as { id: string }).id);
    const outcome = await refundOrderPayment(
      database.sql,
      id,
      orderRefundCreateSchema.parse(request.body),
      { kind: 'device', deviceId: context.deviceId, origin: 'android' },
    );
    return reply.code(outcome.statusCode).send({ ...outcome.result, reused: outcome.reused });
  });
  app.post('/api/v1/operator/orders/:id/ticket', async (request, reply) => {
    const context = await protectOperator(request, reply, database, config);
    if (!context) return;
    await requireCapability(database.sql, 'pos_tickets');
    const id = z.uuid().parse((request.params as { id: string }).id);
    const outcome = await issueOrderTicket(
      database.sql,
      id,
      ticketIssueSchema.parse(request.body),
      { kind: 'device', deviceId: context.deviceId, origin: 'android' },
    );
    return reply.code(outcome.statusCode).send({ ticket: outcome.result, reused: outcome.reused });
  });
  app.post('/api/v1/operator/expenses', async (request, reply) => {
    const context = await protectOperator(request, reply, database, config);
    if (!context) return;
    await requireCapability(database.sql, 'expenses');
    const outcome = await createOperatingExpense(
      database.sql,
      expenseCreateSchema.parse(request.body),
      { kind: 'device', deviceId: context.deviceId, origin: 'android' },
    );
    return reply
      .code(outcome.statusCode)
      .send(Object.assign({}, outcome.result as object, { reused: outcome.reused }));
  });
  app.get('/api/v1/operator/reports/profitability', async (request, reply) => {
    const context = await protectOperator(request, reply, database, config);
    if (!context) return;
    await requireCapability(database.sql, 'profitability_reports');
    const query = reportPeriodSchema.parse(request.query);
    return profitabilityReportSchema.parse(await profitabilityReport(database.sql, query));
  });

  app.get('/api/v1/operator/orders', async (request, reply) => {
    const context = await protectOperator(request, reply, database, config);
    if (!context) return;
    const statusValue = (request.query as { status?: string }).status;
    const status = statusValue ? orderStatusSchema.parse(statusValue) : undefined;
    return { orders: await listOrders(database.sql, status) };
  });

  app.post('/api/v1/operator/orders', async (request, reply) => {
    const context = await protectOperator(request, reply, database, config);
    if (!context) return;
    const input = orderCreateRequestSchema.parse(request.body);
    const catalog = await loadCatalog(database);
    try {
      const [capability] = await database.sql<{ capability: string }[]>`
        select capability from pos_capabilities where capability in ('unified_orders','pos_cutover') and enabled=true limit 1`;
      if (capability) {
        await requireCapability(database.sql, 'unified_orders');
        if (!input.neighborhood || !input.streetAndNumber)
          return reply
            .code(400)
            .send({ message: 'La importación de domicilio requiere colonia y dirección.' });
        const totals = calculateCart(
          catalog,
          input.items.map((item, index) => ({
            id: `whatsapp-${index}`,
            productId: item.productId,
            quantity: item.quantity,
            removedIngredients: item.removedIngredients,
            modifierIds: item.modifierIds,
            combo: item.combo,
            ...(item.drinkProductId ? { drinkProductId: item.drinkProductId } : {}),
            note: item.note,
          })),
        );
        const result = await createUnifiedOrder(
          database.sql,
          catalog,
          {
            fulfillment: 'delivery',
            customerName: input.customerName,
            neighborhood: input.neighborhood,
            streetAndNumber: input.streetAndNumber,
            manualDiscountCents: 0,
            manualDiscountReason: '',
            items: input.items,
            quotedTotalCents: totals.totalCents,
            idempotencyKey: input.idempotencyKey,
            source: 'manual_whatsapp',
            rawMessage: input.rawMessage,
          },
          context.deviceId,
          notifier,
        );
        return reply.code(result.statusCode).send({ order: result.order, reused: result.reused });
      }
      const order = await createOrder(database.sql, catalog, input, context.deviceId, notifier);
      return reply.code(201).send({ order });
    } catch (error) {
      if (error instanceof OrderError)
        return reply.code(error.statusCode).send({ message: error.message });
      throw error;
    }
  });

  app.get('/api/v1/operator/orders/:id', async (request, reply) => {
    const context = await protectOperator(request, reply, database, config);
    if (!context) return;
    const id = z.uuid().parse((request.params as { id: string }).id);
    const order = await getOrder(database.sql, id);
    if (!order) return reply.code(404).send({ message: 'La comanda no existe.' });
    return { order };
  });

  app.patch('/api/v1/operator/orders/:id/status', async (request, reply) => {
    const context = await protectOperator(request, reply, database, config);
    if (!context) return;
    const id = z.uuid().parse((request.params as { id: string }).id);
    const input = orderStatusUpdateSchema.parse(request.body);
    const [cutover] = await database.sql<{ enabled: boolean }[]>`
      select enabled from pos_capabilities where capability='pos_cutover'`;
    if (cutover?.enabled) {
      const order = await getOrder(database.sql, id);
      if (!order) return reply.code(404).send({ message: 'La comanda no existe.' });
      if (!order.quotedAt)
        return reply
          .code(409)
          .send({ message: 'Las comandas históricas anteriores al corte son de consulta.' });
      if (!input.idempotencyKey)
        return reply
          .code(400)
          .send({ message: 'La actualización requiere clave idempotente. Actualiza la app.' });
    }
    try {
      return {
        order: await updateOrderStatus(
          database.sql,
          id,
          input.status,
          input.note,
          context.deviceId,
          notifier,
          input.idempotencyKey,
        ),
      };
    } catch (error) {
      if (error instanceof OrderError)
        return reply.code(error.statusCode).send({ message: error.message });
      throw error;
    }
  });

  app.post('/api/v1/operator/orders/:id/spin-code', async (request, reply) => {
    const context = await protectOperator(request, reply, database, config);
    if (!context) return;
    const id = z.uuid().parse((request.params as { id: string }).id);
    const input = spinCodeIssueRequestSchema.parse(request.body);
    try {
      return await issueOrderSpinCode(
        database.sql,
        id,
        input.idempotencyKey,
        context.deviceId,
        config.CODE_HMAC_SECRET,
        notifier,
      );
    } catch (error) {
      if (error instanceof OrderError)
        return reply.code(error.statusCode).send({ message: error.message });
      throw error;
    }
  });

  app.get('/api/v1/operator/orders/stream', async (request, reply) => {
    const context = await protectOperator(request, reply, database, config);
    if (!context) return;
    reply.hijack();
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    reply.raw.write(
      `event: connected\ndata: ${JSON.stringify({ device: context.deviceName })}\n\n`,
    );
    const unsubscribe = notifier.subscribe((orderId) => {
      if (!reply.raw.writableEnded)
        reply.raw.write(`event: order\ndata: ${JSON.stringify({ orderId })}\n\n`);
    });
    const heartbeat = setInterval(() => {
      if (!reply.raw.writableEnded) reply.raw.write(': keep-alive\n\n');
    }, 25000);
    request.raw.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  });
}

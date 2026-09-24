import { randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import cookie from '@fastify/cookie';
import staticPlugin from '@fastify/static';
import { verify } from '@node-rs/argon2';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  businessSettingsSchema,
  categorySchema,
  modifierSchema,
  productSchema,
  promotionSchema,
  recipeVersionCreateSchema,
  productionBatchCreateSchema,
  ticketIssueSchema,
  orderPaymentCreateSchema,
  orderRefundCreateSchema,
  capabilityActivationSchema,
  capabilityKeySchema,
  expenseCreateSchema,
  profitabilityReportSchema,
  reportPeriodSchema,
  cashSessionOpenSchema,
  cashMovementSchema,
  cashSessionCloseSchema,
  unifiedOrderQuoteSchema,
  unifiedOrderConfirmSchema,
  orderStatusUpdateSchema,
  counterCheckoutSchema,
  calculateCart,
} from '@bj/contracts';
import type { AppConfig } from './config.js';
import type { Database } from './db/client.js';
import { createOpaqueToken, digestToken } from './security.js';
import { stockLedgerState } from './stock-ledger-service.js';
import { createRecipeVersion, recipeVersionState } from './recipe-version-service.js';
import { requireCapability } from './pos-foundation-service.js';
import { createProductionBatch } from './production-service.js';
import {
  type InMemoryOrderNotifier,
  createUnifiedOrder,
  listOrders,
  updateOrderStatus,
} from './order-service.js';
import { issueOrderTicket } from './ticket-service.js';
import {
  checkoutCounterOrder,
  collectOrderPayment,
  refundOrderPayment,
} from './payment-service.js';
import { activateCapability, capabilityReadiness } from './capability-service.js';
import { createOperatingExpense } from './expense-service.js';
import { loadCatalog } from './catalog-repository.js';
import { profitabilityCsv, profitabilityReport } from './profitability-service.js';
import {
  cashSessionState,
  closeCashSession,
  openCashSession,
  recordCashMovement,
} from './cash-session-service.js';

interface AdminContext {
  userId: string;
  csrfToken: string;
}

async function sessionFor(
  request: FastifyRequest,
  database: Database,
  config: AppConfig,
): Promise<AdminContext | null> {
  const token = request.cookies.bj_admin_session;
  if (!token) return null;
  const digest = digestToken(token, config.SESSION_SECRET);
  const rows = await database.sql<{ user_id: string; csrf_token: string }[]>`
    select user_id, csrf_token from admin_sessions where token_digest = ${digest} and expires_at > now() limit 1`;
  return rows[0] ? { userId: rows[0].user_id, csrfToken: rows[0].csrf_token } : null;
}

async function audit(
  database: Database,
  context: AdminContext,
  action: string,
  entity: string,
  entityId?: string,
) {
  await database.sql`insert into audit_logs (user_id, action, entity, entity_id) values (${context.userId}, ${action}, ${entity}, ${entityId ?? null})`;
}

async function triggerDeploy(config: AppConfig) {
  if (!config.CLOUDFLARE_DEPLOY_HOOK) return;
  try {
    await fetch(config.CLOUDFLARE_DEPLOY_HOOK, {
      method: 'POST',
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    /* Runtime catalog remains current even if rebuild is delayed. */
  }
}

export async function registerAdmin(
  app: FastifyInstance,
  database: Database,
  config: AppConfig,
  notifier: InMemoryOrderNotifier,
) {
  await app.register(cookie);

  app.post(
    '/api/v1/admin/session',
    { config: { rateLimit: { max: 6, timeWindow: '15 minutes' } } },
    async (request, reply) => {
      const body = request.body as { email?: string; password?: string };
      if (!body.email || !body.password)
        return reply.code(400).send({ message: 'Correo y contraseña son obligatorios.' });
      const users = await database.sql<
        { id: string; password_hash: string }[]
      >`select id, password_hash from admin_users where lower(email) = lower(${body.email}) and active = true limit 1`;
      const user = users[0];
      if (!user || !(await verify(user.password_hash, body.password)))
        return reply.code(401).send({ message: 'Credenciales incorrectas.' });
      const token = createOpaqueToken();
      const csrfToken = randomUUID();
      await database.sql`delete from admin_sessions where expires_at <= now()`;
      await database.sql`insert into admin_sessions (token_digest, user_id, csrf_token, expires_at) values (${digestToken(token, config.SESSION_SECRET)}, ${user.id}, ${csrfToken}, now() + interval '8 hours')`;
      const secure = config.NODE_ENV === 'production';
      reply.setCookie('bj_admin_session', token, {
        httpOnly: true,
        secure,
        sameSite: 'strict',
        path: '/',
        maxAge: 8 * 60 * 60,
      });
      reply.setCookie('bj_csrf', csrfToken, {
        httpOnly: false,
        secure,
        sameSite: 'strict',
        path: '/',
        maxAge: 8 * 60 * 60,
      });
      return { authenticated: true, csrfToken };
    },
  );

  app.get('/api/v1/admin/session', async (request, reply) => {
    const context = await sessionFor(request, database, config);
    if (!context) return reply.code(401).send({ authenticated: false });
    return { authenticated: true, csrfToken: context.csrfToken };
  });

  app.delete('/api/v1/admin/session', async (request, reply) => {
    const token = request.cookies.bj_admin_session;
    if (token)
      await database.sql`delete from admin_sessions where token_digest = ${digestToken(token, config.SESSION_SECRET)}`;
    reply.clearCookie('bj_admin_session', { path: '/' }).clearCookie('bj_csrf', { path: '/' });
    return { authenticated: false };
  });

  async function protect(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<AdminContext | undefined> {
    const context = await sessionFor(request, database, config);
    if (!context) {
      await reply.code(401).send({ message: 'Sesión no válida.' });
      return;
    }
    if (request.method !== 'GET' && request.headers['x-csrf-token'] !== context.csrfToken) {
      await reply.code(403).send({ message: 'Token CSRF no válido.' });
      return;
    }
    return context;
  }

  app.get('/api/v1/admin/dashboard', async (request, reply) => {
    const context = await protect(request, reply);
    if (!context) return;
    const [categories, products, modifiers, promotions, settings, prizes, redemptions, devices] =
      await Promise.all([
        database.sql`select * from categories order by sort_order`,
        database.sql`select * from products order by category_id, sort_order`,
        database.sql`select * from modifiers order by name`,
        database.sql`select * from promotions order by priority desc`,
        database.sql`select data, updated_at from business_settings where id = 'primary'`,
        database.sql`select * from prizes order by id`,
        database.sql`select r.*, c.code_hint, p.emoji from spin_redemptions r join spin_codes c on c.id = r.code_id join prizes p on p.id = r.prize_id order by r.created_at desc limit 100`,
        database.sql`select id, name, active, pairing_expires_at, pairing_used_at, last_seen_at, created_at from mobile_devices order by created_at desc`,
      ]);
    return {
      categories,
      products,
      modifiers,
      promotions,
      business: settings[0] ?? null,
      prizes,
      redemptions,
      devices,
    };
  });

  app.get('/api/v1/admin/orders', async (request, reply) => {
    const context = await protect(request, reply);
    if (!context) return;
    reply.header('cache-control', 'no-store');
    return { orders: await listOrders(database.sql) };
  });
  app.get('/api/v1/admin/orders/stream', async (request, reply) => {
    const context = await sessionFor(request, database, config);
    if (!context)
      return reply.code(401).send({ message: 'Inicia sesión para consultar comandas.' });
    reply.hijack();
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    reply.raw.write(`event: connected\ndata: ${JSON.stringify({ userId: context.userId })}\n\n`);
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
  app.get('/api/v1/admin/pos/catalog', async (request, reply) => {
    const context = await protect(request, reply);
    if (!context) return;
    await requireCapability(database.sql, 'unified_orders');
    reply.header('cache-control', 'no-store');
    return { catalog: await loadCatalog(database) };
  });
  app.post('/api/v1/admin/unified-orders/quote', async (request, reply) => {
    const context = await protect(request, reply);
    if (!context) return;
    await requireCapability(database.sql, 'unified_orders');
    const input = unifiedOrderQuoteSchema.parse(request.body);
    const quote = calculateCart(
      await loadCatalog(database),
      input.items.map((item, index) => ({
        id: `admin-quote-${index}`,
        productId: item.productId,
        quantity: item.quantity,
        removedIngredients: item.removedIngredients,
        modifierIds: item.modifierIds,
        combo: item.combo,
        note: item.note,
        ...(item.drinkProductId ? { drinkProductId: item.drinkProductId } : {}),
      })),
    );
    if (input.manualDiscountCents > quote.totalCents)
      return reply
        .code(400)
        .send({ message: 'El descuento supera el total después de promociones.' });
    const totalCents = quote.totalCents - input.manualDiscountCents;
    return {
      fulfillment: input.fulfillment,
      subtotalCents: totalCents,
      deliveryCents: 0,
      totalCents,
      manualDiscountCents: input.manualDiscountCents,
      manualDiscountReason: input.manualDiscountReason,
      promotion: quote.promotion,
    };
  });
  app.post('/api/v1/admin/unified-orders', async (request, reply) => {
    const context = await protect(request, reply);
    if (!context) return;
    await requireCapability(database.sql, 'unified_orders');
    const input = unifiedOrderConfirmSchema.parse(request.body);
    const outcome = await createUnifiedOrder(
      database.sql,
      await loadCatalog(database),
      input,
      '',
      notifier,
      { kind: 'admin', userId: context.userId, origin: 'admin_web' },
    );
    return reply.code(outcome.statusCode).send({ order: outcome.order, reused: outcome.reused });
  });
  app.put('/api/v1/admin/orders/:id/status', async (request, reply) => {
    const context = await protect(request, reply);
    if (!context) return;
    await requireCapability(database.sql, 'unified_orders');
    const id = z.uuid().parse((request.params as { id: string }).id);
    const input = orderStatusUpdateSchema.parse(request.body);
    if (!input.idempotencyKey)
      return reply.code(400).send({ message: 'La actualización requiere clave idempotente.' });
    try {
      const order = await updateOrderStatus(
        database.sql,
        id,
        input.status,
        input.note,
        { kind: 'admin', userId: context.userId, origin: 'admin_web' },
        notifier,
        input.idempotencyKey,
      );
      return { order };
    } catch (error) {
      if (error instanceof Error && 'statusCode' in error)
        return reply.code(Number(error.statusCode)).send({ message: error.message });
      throw error;
    }
  });
  app.post('/api/v1/admin/orders/:id/counter-checkout', async (request, reply) => {
    const context = await protect(request, reply);
    if (!context) return;
    await requireCapability(database.sql, 'payments_refunds');
    const id = z.uuid().parse((request.params as { id: string }).id);
    const outcome = await checkoutCounterOrder(
      database.sql,
      id,
      counterCheckoutSchema.parse(request.body),
      { kind: 'admin', userId: context.userId, origin: 'admin_web' },
      notifier,
    );
    return { ...outcome };
  });
  app.get('/api/v1/admin/pos/capabilities', async (request, reply) => {
    const context = await protect(request, reply);
    if (!context) return;
    reply.header('cache-control', 'no-store');
    return capabilityReadiness(database.sql);
  });
  app.put('/api/v1/admin/pos/capabilities/:key', async (request, reply) => {
    const context = await protect(request, reply);
    if (!context) return;
    const key = capabilityKeySchema.parse((request.params as { key: string }).key);
    const outcome = await activateCapability(
      database.sql,
      key,
      capabilityActivationSchema.parse(request.body),
      { kind: 'admin', userId: context.userId, origin: 'admin_web' },
    );
    return reply
      .code(outcome.statusCode)
      .send(Object.assign({}, outcome.result as object, { reused: outcome.reused }));
  });
  app.post('/api/v1/admin/orders/:id/ticket', async (request, reply) => {
    const context = await protect(request, reply);
    if (!context) return;
    await requireCapability(database.sql, 'pos_tickets');
    const id = z.uuid().parse((request.params as { id: string }).id);
    const outcome = await issueOrderTicket(
      database.sql,
      id,
      ticketIssueSchema.parse(request.body),
      { kind: 'admin', userId: context.userId, origin: 'admin_web' },
    );
    return reply.code(outcome.statusCode).send({ ticket: outcome.result, reused: outcome.reused });
  });
  app.post('/api/v1/admin/orders/:id/payments', async (request, reply) => {
    const context = await protect(request, reply);
    if (!context) return;
    await requireCapability(database.sql, 'payments_refunds');
    const id = z.uuid().parse((request.params as { id: string }).id);
    const outcome = await collectOrderPayment(
      database.sql,
      id,
      orderPaymentCreateSchema.parse(request.body),
      { kind: 'admin', userId: context.userId, origin: 'admin_web' },
    );
    return reply.code(outcome.statusCode).send({ ...outcome.result, reused: outcome.reused });
  });
  app.post('/api/v1/admin/orders/:id/refunds', async (request, reply) => {
    const context = await protect(request, reply);
    if (!context) return;
    await requireCapability(database.sql, 'payments_refunds');
    const id = z.uuid().parse((request.params as { id: string }).id);
    const outcome = await refundOrderPayment(
      database.sql,
      id,
      orderRefundCreateSchema.parse(request.body),
      { kind: 'admin', userId: context.userId, origin: 'admin_web' },
    );
    return reply.code(outcome.statusCode).send({ ...outcome.result, reused: outcome.reused });
  });
  app.post('/api/v1/admin/expenses', async (request, reply) => {
    const context = await protect(request, reply);
    if (!context) return;
    await requireCapability(database.sql, 'expenses');
    const outcome = await createOperatingExpense(
      database.sql,
      expenseCreateSchema.parse(request.body),
      { kind: 'admin', userId: context.userId, origin: 'admin_web' },
    );
    return reply
      .code(outcome.statusCode)
      .send(Object.assign({}, outcome.result as object, { reused: outcome.reused }));
  });
  app.get('/api/v1/admin/expenses', async (request, reply) => {
    const context = await protect(request, reply);
    if (!context) return;
    reply.header('cache-control', 'no-store');
    const expenses = await database.sql`
      select e.*,u.email as admin_email,d.name as device_name
      from operating_expenses e left join admin_users u on u.id=e.created_by_user_id
      left join mobile_devices d on d.id=e.created_by_device_id
      order by e.incurred_at desc,e.id desc limit 200`;
    return { expenses };
  });
  app.get('/api/v1/admin/reports/profitability', async (request, reply) => {
    const context = await protect(request, reply);
    if (!context) return;
    await requireCapability(database.sql, 'profitability_reports');
    const query = reportPeriodSchema.parse(request.query);
    const report = await profitabilityReport(database.sql, query);
    return profitabilityReportSchema.parse(report);
  });
  app.get('/api/v1/admin/cash-session', async (request, reply) => {
    const context = await protect(request, reply);
    if (!context) return;
    reply.header('cache-control', 'no-store');
    return cashSessionState(database.sql);
  });
  app.post('/api/v1/admin/cash-session/open', async (request, reply) => {
    const context = await protect(request, reply);
    if (!context) return;
    await requireCapability(database.sql, 'cash_sessions');
    const outcome = await openCashSession(database.sql, cashSessionOpenSchema.parse(request.body), {
      kind: 'admin',
      userId: context.userId,
      origin: 'admin_web',
    });
    return reply
      .code(outcome.statusCode)
      .send(Object.assign({}, outcome.result as object, { reused: outcome.reused }));
  });
  app.post('/api/v1/admin/cash-session/movements', async (request, reply) => {
    const context = await protect(request, reply);
    if (!context) return;
    await requireCapability(database.sql, 'cash_sessions');
    const outcome = await recordCashMovement(database.sql, cashMovementSchema.parse(request.body), {
      kind: 'admin',
      userId: context.userId,
      origin: 'admin_web',
    });
    return reply
      .code(outcome.statusCode)
      .send(Object.assign({}, outcome.result as object, { reused: outcome.reused }));
  });
  app.post('/api/v1/admin/cash-session/close', async (request, reply) => {
    const context = await protect(request, reply);
    if (!context) return;
    await requireCapability(database.sql, 'cash_sessions');
    const outcome = await closeCashSession(
      database.sql,
      cashSessionCloseSchema.parse(request.body),
      {
        kind: 'admin',
        userId: context.userId,
        origin: 'admin_web',
      },
    );
    return reply
      .code(outcome.statusCode)
      .send(Object.assign({}, outcome.result as object, { reused: outcome.reused }));
  });
  app.get('/api/v1/admin/reports/profitability.csv', async (request, reply) => {
    const context = await protect(request, reply);
    if (!context) return;
    await requireCapability(database.sql, 'profitability_reports');
    const query = reportPeriodSchema.pick({ from: true, to: true }).parse(request.query);
    const csv = await profitabilityCsv(database.sql, query);
    reply.header('content-type', 'text/csv; charset=utf-8');
    reply.header(
      'content-disposition',
      `attachment; filename="bj-rentabilidad-${query.from}-${query.to}.csv"`,
    );
    return csv;
  });

  app.get('/api/v1/admin/inventory/ledger', async (request, reply) => {
    const context = await protect(request, reply);
    if (!context) return;
    const { limit, cursor } = z
      .object({
        limit: z.coerce.number().int().min(1).max(200).default(100),
        cursor: z.uuid().optional(),
      })
      .parse(request.query);
    reply.header('cache-control', 'no-store');
    return stockLedgerState(database.sql, limit, cursor);
  });
  app.get('/api/v1/admin/recipes/versions', async (request, reply) => {
    const context = await protect(request, reply);
    if (!context) return;
    const { productId } = z
      .object({ productId: z.string().min(1).optional() })
      .parse(request.query);
    reply.header('cache-control', 'no-store');
    return recipeVersionState(database.sql, productId);
  });
  app.post('/api/v1/admin/recipes/versions', async (request, reply) => {
    const context = await protect(request, reply);
    if (!context) return;
    await requireCapability(database.sql, 'recipe_versions');
    const outcome = await createRecipeVersion(
      database.sql,
      recipeVersionCreateSchema.parse(request.body),
      { kind: 'admin', userId: context.userId, origin: 'admin_web' },
    );
    return reply
      .code(outcome.statusCode)
      .send(Object.assign({}, outcome.result, { reused: outcome.reused }));
  });
  app.get('/api/v1/admin/production/batches', async (request, reply) => {
    const context = await protect(request, reply);
    if (!context) return;
    reply.header('cache-control', 'no-store');
    const batches =
      await database.sql`select b.*,p.name as product_name from production_batches b join products p on p.id=b.product_id order by b.created_at desc limit 100`;
    return { batches };
  });
  app.post('/api/v1/admin/production/batches', async (request, reply) => {
    const context = await protect(request, reply);
    if (!context) return;
    await requireCapability(database.sql, 'production');
    const outcome = await createProductionBatch(
      database.sql,
      productionBatchCreateSchema.parse(request.body),
      { kind: 'admin', userId: context.userId, origin: 'admin_web' },
    );
    return reply.code(outcome.statusCode).send({ ...outcome.result, reused: outcome.reused });
  });
  app.get('/api/v1/admin/purchasing', async (request, reply) => {
    const context = await protect(request, reply);
    if (!context) return;
    const [suppliers, presentations, purchases] = await Promise.all([
      database.sql`select * from suppliers order by name`,
      database.sql`select p.*,i.name as ingredient_name,s.name as supplier_name from ingredient_presentations p join stock_ingredients i on i.id=p.ingredient_id left join suppliers s on s.id=p.supplier_id order by i.name,p.name`,
      database.sql`select p.*,s.name as supplier_name from purchase_documents p join suppliers s on s.id=p.supplier_id order by p.created_at desc limit 100`,
    ]);
    reply.header('cache-control', 'no-store');
    return { suppliers, presentations, purchases };
  });

  app.post('/api/v1/admin/devices', async (request, reply) => {
    const context = await protect(request, reply);
    if (!context) return;
    const name = (request.body as { name?: string }).name?.trim();
    if (!name || name.length > 80)
      return reply.code(400).send({ message: 'Indica un nombre de hasta 80 caracteres.' });
    const pairingCode = createOpaqueToken(24);
    const rows = await database.sql<{ id: string; pairing_expires_at: Date | string }[]>`
      insert into mobile_devices (name, pairing_digest, pairing_expires_at, created_by_user_id)
      values (${name}, ${digestToken(pairingCode, config.SESSION_SECRET)}, now() + interval '15 minutes', ${context.userId})
      returning id, pairing_expires_at`;
    await audit(database, context, 'create', 'mobile_device', rows[0]!.id);
    return {
      device: {
        id: rows[0]!.id,
        name,
        pairingExpiresAt: new Date(rows[0]!.pairing_expires_at).toISOString(),
      },
      pairingCode,
    };
  });

  app.delete('/api/v1/admin/devices/:id', async (request, reply) => {
    const context = await protect(request, reply);
    if (!context) return;
    const id = (request.params as { id: string }).id;
    const rows = await database.sql<{ id: string }[]>`
      update mobile_devices set active=false, token_digest=null, pairing_digest=null, pairing_expires_at=null, updated_at=now()
      where id=${id} and active=true returning id`;
    if (!rows[0]) return reply.code(404).send({ message: 'Dispositivo no encontrado.' });
    await audit(database, context, 'revoke', 'mobile_device', id);
    return { ok: true };
  });

  app.put('/api/v1/admin/products/:id', async (request, reply) => {
    const context = await protect(request, reply);
    if (!context) return;
    const id = (request.params as { id: string }).id;
    const product = productSchema.parse({ ...(request.body as object), id });
    await database.sql`update products set slug=${product.slug}, category_id=${product.categoryId}, name=${product.name}, description=${product.description}, price_cents=${product.priceCents}, ingredients=${JSON.stringify(product.ingredients)}, removable_ingredients=${JSON.stringify(product.removableIngredients)}, combo_eligible=${product.comboEligible}, featured=${product.featured}, available=${product.available}, sort_order=${product.order}, updated_at=now() where id=${id}`;
    await audit(database, context, 'update', 'product', id);
    await triggerDeploy(config);
    return { ok: true };
  });

  app.put('/api/v1/admin/categories/:id', async (request, reply) => {
    const context = await protect(request, reply);
    if (!context) return;
    const id = (request.params as { id: string }).id;
    const category = categorySchema.parse({ ...(request.body as object), id });
    await database.sql`update categories set slug=${category.slug}, name=${category.name}, description=${category.description}, sort_order=${category.order}, active=${category.active}, updated_at=now() where id=${id}`;
    await audit(database, context, 'update', 'category', id);
    await triggerDeploy(config);
    return { ok: true };
  });

  app.put('/api/v1/admin/modifiers/:id', async (request, reply) => {
    const context = await protect(request, reply);
    if (!context) return;
    const id = (request.params as { id: string }).id;
    const modifier = modifierSchema.parse({ ...(request.body as object), id });
    await database.sql`update modifiers set name=${modifier.name}, price_cents=${modifier.priceCents}, available=${modifier.available}, updated_at=now() where id=${id}`;
    await audit(database, context, 'update', 'modifier', id);
    await triggerDeploy(config);
    return { ok: true };
  });

  app.put('/api/v1/admin/promotions/:id', async (request, reply) => {
    const context = await protect(request, reply);
    if (!context) return;
    const id = (request.params as { id: string }).id;
    const promotion = promotionSchema.parse({ ...(request.body as object), id });
    await database.sql`update promotions set name=${promotion.name}, short_description=${promotion.shortDescription}, days_of_week=${JSON.stringify(promotion.daysOfWeek)}, starts_at=${promotion.startsAt}, ends_at=${promotion.endsAt}, priority=${promotion.priority}, active=${promotion.active}, rule=${JSON.stringify(promotion.rule)}, updated_at=now() where id=${id}`;
    await audit(database, context, 'update', 'promotion', id);
    await triggerDeploy(config);
    return { ok: true };
  });

  app.put('/api/v1/admin/business', async (request, reply) => {
    const context = await protect(request, reply);
    if (!context) return;
    const settings = businessSettingsSchema.parse(request.body);
    await database.sql`update business_settings set data=${JSON.stringify(settings)}, updated_at=now() where id='primary'`;
    await audit(database, context, 'update', 'business', 'primary');
    await triggerDeploy(config);
    return { ok: true };
  });

  app.put('/api/v1/admin/prizes/:id', async (request, reply) => {
    const context = await protect(request, reply);
    if (!context) return;
    const id = (request.params as { id: string }).id;
    const body = request.body as {
      label: string;
      emoji: string;
      weight: number;
      active: boolean;
      inventory: number | null;
      targetSegments: number[];
    };
    if (!body.label || !Number.isInteger(body.weight) || body.weight < 0)
      return reply.code(400).send({ message: 'Premio no válido.' });
    await database.sql`update prizes set label=${body.label}, emoji=${body.emoji}, weight=${body.weight}, active=${body.active}, inventory=${body.inventory}, target_segments=${JSON.stringify(body.targetSegments)}, updated_at=now() where id=${id}`;
    await audit(database, context, 'update', 'prize', id);
    return { ok: true };
  });

  const adminDist = resolve(dirname(fileURLToPath(import.meta.url)), '../../admin/dist');
  if (existsSync(adminDist)) {
    await app.register(staticPlugin, { root: adminDist, prefix: '/admin/' });
    app.get('/admin', (_request, reply) => reply.redirect('/admin/'));
  }
}

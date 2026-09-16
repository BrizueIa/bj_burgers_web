import { randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import cookie from '@fastify/cookie';
import staticPlugin from '@fastify/static';
import { verify } from '@node-rs/argon2';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  businessSettingsSchema,
  categorySchema,
  modifierSchema,
  productSchema,
  promotionSchema,
} from '@bj/contracts';
import type { AppConfig } from './config.js';
import type { Database } from './db/client.js';
import { createOpaqueToken, digestToken } from './security.js';

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

export async function registerAdmin(app: FastifyInstance, database: Database, config: AppConfig) {
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
    const [categories, products, modifiers, promotions, settings, prizes, redemptions] =
      await Promise.all([
        database.sql`select * from categories order by sort_order`,
        database.sql`select * from products order by category_id, sort_order`,
        database.sql`select * from modifiers order by name`,
        database.sql`select * from promotions order by priority desc`,
        database.sql`select data, updated_at from business_settings where id = 'primary'`,
        database.sql`select * from prizes order by id`,
        database.sql`select r.*, c.code_hint, p.emoji from spin_redemptions r join spin_codes c on c.id = r.code_id join prizes p on p.id = r.prize_id order by r.created_at desc limit 100`,
      ]);
    return {
      categories,
      products,
      modifiers,
      promotions,
      business: settings[0] ?? null,
      prizes,
      redemptions,
    };
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

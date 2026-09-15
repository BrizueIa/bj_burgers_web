import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { z } from 'zod';
import { spinRedeemRequestSchema } from '@bj/contracts';
import { loadConfig } from './config.js';
import { createDatabase } from './db/client.js';
import { loadCatalog } from './catalog-repository.js';
import { registerAdmin } from './admin-routes.js';
import { createDemoSpin, lookupSpinResult, redeemSpin, SpinError } from './spin-service.js';

export async function buildApp(env = process.env) {
  const config = loadConfig(env);
  const database = createDatabase(config.DATABASE_URL);
  const app = Fastify({
    logger: config.NODE_ENV !== 'test',
    trustProxy: true,
    bodyLimit: 64 * 1024,
  });

  await app.register(helmet, {
    crossOriginEmbedderPolicy: false,
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
      },
    },
  });
  await app.register(cors, {
    credentials: true,
    origin(origin, callback) {
      if (!origin || config.webOrigins.includes(origin)) callback(null, true);
      else callback(new Error('Origin no permitido'), false);
    },
  });
  await app.register(rateLimit, { global: true, max: 180, timeWindow: '1 minute' });

  app.get('/health', async () => {
    await database.sql`select 1`;
    return { status: 'ok', time: new Date().toISOString() };
  });

  app.get('/api/v1/catalog', async (_request, reply) => {
    const catalog = await loadCatalog(database);
    reply
      .header('etag', `"${catalog.version}"`)
      .header('cache-control', 'public, max-age=60, stale-while-revalidate=86400');
    return catalog;
  });

  app.get('/api/v1/store-status', async (_request, reply) => {
    const catalog = await loadCatalog(database);
    const now = new Date();
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: catalog.business.timezone,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(now);
    const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(
      parts.find((part) => part.type === 'weekday')?.value ?? '',
    );
    const hour = parts.find((part) => part.type === 'hour')?.value ?? '00';
    const minute = parts.find((part) => part.type === 'minute')?.value ?? '00';
    const current = `${hour}:${minute}`;
    const schedule = catalog.business.schedule.find((entry) => entry.dayOfWeek === weekday);
    const open =
      !catalog.business.temporarilyClosed &&
      Boolean(schedule && current >= schedule.opens && current <= schedule.closes);
    reply.header('cache-control', 'public, max-age=30');
    return {
      open,
      temporarilyClosed: catalog.business.temporarilyClosed,
      message: catalog.business.temporarilyClosed
        ? catalog.business.closureMessage
        : open
          ? 'Estamos recibiendo pedidos'
          : 'Abrimos de jueves a domingo a las 6:00 pm',
      schedule: catalog.business.schedule,
      timezone: catalog.business.timezone,
    };
  });

  app.post(
    '/api/v1/spins/redeem',
    { config: { rateLimit: { max: 8, timeWindow: '10 minutes' } } },
    async (request, reply) => {
      const input = spinRedeemRequestSchema.parse(request.body);
      try {
        return await redeemSpin(database.sql, { ...input, secret: config.CODE_HMAC_SECRET });
      } catch (error) {
        if (error instanceof SpinError)
          return reply.code(error.statusCode).send({ message: error.message });
        throw error;
      }
    },
  );

  app.post(
    '/api/v1/spins/demo',
    { config: { rateLimit: { max: 3, timeWindow: '1 hour' } } },
    async (_request, reply) => {
      const result = await createDemoSpin(database.sql);
      reply.header('cache-control', 'no-store');
      return result;
    },
  );

  app.get('/api/v1/spins/results/:id', async (request, reply) => {
    const id = z.uuid().parse((request.params as { id: string }).id);
    const result = await lookupSpinResult(database.sql, id);
    reply.header('cache-control', 'no-store');
    if (!result) return reply.code(404).send({ message: 'Resultado no encontrado.' });
    return result;
  });

  await registerAdmin(app, database, config);
  app.setErrorHandler((error, _request, reply) => {
    const handled = error as Error & { statusCode?: number };
    if (handled.name === 'ZodError')
      return reply
        .code(400)
        .send({ message: 'Los datos enviados no son válidos.', details: handled.message });
    app.log.error(handled);
    const statusCode = handled.statusCode && handled.statusCode < 500 ? handled.statusCode : 500;
    return reply
      .code(statusCode)
      .send({ message: statusCode < 500 ? handled.message : 'Ocurrió un error inesperado.' });
  });
  app.addHook('onClose', async () => database.sql.end());
  return app;
}

if (process.env.NODE_ENV !== 'test') {
  const config = loadConfig();
  const app = await buildApp();
  await app.listen({ port: config.PORT, host: '0.0.0.0' });
}

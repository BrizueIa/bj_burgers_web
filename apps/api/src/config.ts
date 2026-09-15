import { z } from 'zod';

const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4100),
  DATABASE_URL: z.string().url(),
  WEB_ORIGINS: z.string().default('http://localhost:4321,http://localhost:5173'),
  PUBLIC_APP_ORIGIN: z.string().url().default('http://localhost:4321'),
  CODE_HMAC_SECRET: z.string().min(32),
  SESSION_SECRET: z.string().min(32),
  CLOUDFLARE_DEPLOY_HOOK: z.string().url().optional().or(z.literal('')),
});

export type AppConfig = ReturnType<typeof loadConfig>;

export function loadConfig(env = process.env) {
  const parsed = configSchema.parse(env);
  return {
    ...parsed,
    webOrigins: parsed.WEB_ORIGINS.split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
  };
}

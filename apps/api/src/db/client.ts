import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from './schema.js';

export function createDatabase(databaseUrl: string) {
  const sql = postgres(databaseUrl, { max: 12, idle_timeout: 20, connect_timeout: 10 });
  return { sql, db: drizzle(sql, { schema }) };
}

export type Database = ReturnType<typeof createDatabase>;

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import postgres from 'postgres';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required');
const sql = postgres(databaseUrl, { max: 1 });
const migration = await readFile(resolve('apps/api/migrations/0001_initial.sql'), 'utf8');
await sql.unsafe(migration);
await sql.end();
console.log('Database migrated.');

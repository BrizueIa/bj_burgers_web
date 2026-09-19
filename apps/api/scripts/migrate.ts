import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { applyMigrations } from '../src/db/migrate.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required');
const sql = postgres(databaseUrl, { max: 1 });
const migrationDirectory = fileURLToPath(new URL('../migrations', import.meta.url));
const applied = await applyMigrations(sql, migrationDirectory);
for (const filename of applied) console.log(`Applied ${filename}`);
await sql.end();
console.log('Database migrated.');

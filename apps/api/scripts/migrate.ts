import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required');
const sql = postgres(databaseUrl, { max: 1 });
const migrationDirectory = fileURLToPath(new URL('../migrations', import.meta.url));
await sql`create table if not exists schema_migrations (filename text primary key, applied_at timestamptz not null default now())`;
const files = (await readdir(migrationDirectory)).filter((file) => file.endsWith('.sql')).sort();
for (const filename of files) {
  const applied = await sql<
    { filename: string }[]
  >`select filename from schema_migrations where filename=${filename}`;
  if (applied.length) continue;
  const migration = await readFile(resolve(migrationDirectory, filename), 'utf8');
  await sql.begin(async (tx) => {
    await tx.unsafe(migration);
    await tx`insert into schema_migrations (filename) values (${filename})`;
  });
  console.log(`Applied ${filename}`);
}
await sql.end();
console.log('Database migrated.');

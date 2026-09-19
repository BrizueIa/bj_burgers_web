import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Sql } from 'postgres';

/** Applies every migration exactly once and returns the newly applied files. */
export async function applyMigrations(sql: Sql, migrationDirectory: string) {
  await sql`create table if not exists schema_migrations (filename text primary key, applied_at timestamptz not null default now())`;
  const files = (await readdir(migrationDirectory)).filter((file) => file.endsWith('.sql')).sort();
  const appliedFiles: string[] = [];
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
    appliedFiles.push(filename);
  }
  return appliedFiles;
}

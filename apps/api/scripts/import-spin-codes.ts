import { readFile } from 'node:fs/promises';
import { parse } from 'csv-parse/sync';
import { createDatabase } from '../src/db/client.js';
import { digestCode, normalizeCode } from '../src/security.js';

type CodeRow = { code?: string; remaining_spins?: string; is_active?: string; expires_at?: string };

const csvPath = process.argv[2];
const secret = process.env.CODE_HMAC_SECRET;
const databaseUrl = process.env.DATABASE_URL;
if (!csvPath || !secret || !databaseUrl) {
  console.error('Uso: CODE_HMAC_SECRET=... pnpm --filter @bj/api codes:import -- ruta/codigos.csv');
  process.exit(1);
}
const database = createDatabase(databaseUrl);

const source = await readFile(csvPath, 'utf8');
const rows = parse(source, {
  columns: true,
  bom: true,
  skip_empty_lines: true,
  trim: true,
}) as CodeRow[];
let imported = 0;

await database.sql.begin(async (tx) => {
  for (const row of rows) {
    const code = normalizeCode(row.code ?? '');
    if (code.length < 4) throw new Error(`Código inválido en la fila ${imported + 2}.`);
    const remaining = Number.parseInt(row.remaining_spins || '1', 10);
    if (!Number.isInteger(remaining) || remaining < 0)
      throw new Error(`Saldo inválido para ${code}.`);
    const active = !['false', '0', 'no'].includes((row.is_active ?? 'true').toLowerCase());
    const expiresAt = row.expires_at || null;
    await tx`insert into spin_codes (code_digest, code_hint, remaining_spins, active, expires_at)
      values (${digestCode(code, secret)}, ${code.slice(-4)}, ${remaining}, ${active}, ${expiresAt})
      on conflict (code_digest) do update set remaining_spins=excluded.remaining_spins, active=excluded.active, expires_at=excluded.expires_at, updated_at=now()`;
    imported += 1;
  }
});

const result = await database.sql<
  { count: string; balance: string }[]
>`select count(*)::text as count, coalesce(sum(remaining_spins), 0)::text as balance from spin_codes`;
console.log(
  JSON.stringify(
    {
      imported,
      databaseCount: Number(result[0]?.count),
      databaseBalance: Number(result[0]?.balance),
    },
    null,
    2,
  ),
);
await database.sql.end();

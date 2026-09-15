import { randomInt } from 'node:crypto';
import type { Sql } from 'postgres';
import type { SpinRedeemResponse } from '@bj/contracts';
import { digestCode, normalizeCode } from './security.js';

export class SpinError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

interface PrizeRow {
  id: string;
  label: string;
  emoji: string;
  weight: number;
  inventory: number | null;
  target_segments: number[];
}

export function chooseWeightedPrize(prizes: PrizeRow[], roll?: number): PrizeRow {
  const eligible = prizes.filter(
    (prize) => prize.weight > 0 && (prize.inventory === null || prize.inventory > 0),
  );
  const total = eligible.reduce((sum, prize) => sum + prize.weight, 0);
  if (total < 1) throw new SpinError(503, 'No hay premios disponibles en este momento.');
  let cursor = roll ?? randomInt(total);
  for (const prize of eligible) {
    if (cursor < prize.weight) return prize;
    cursor -= prize.weight;
  }
  return eligible[eligible.length - 1]!;
}

export async function redeemSpin(
  sql: Sql,
  input: { code: string; idempotencyKey: string; secret: string },
): Promise<SpinRedeemResponse> {
  const normalized = normalizeCode(input.code);
  if (normalized.length < 4) throw new SpinError(400, 'Ingresa un código válido.');
  const codeDigest = digestCode(normalized, input.secret);
  return sql.begin(async (tx) => {
    const previous = await tx<
      {
        id: string;
        prize_id: string;
        prize_label: string;
        target_segment: number;
        remaining_spins: number;
        emoji: string;
      }[]
    >`
      select r.id, r.prize_id, r.prize_label, r.target_segment, r.remaining_spins, p.emoji
      from spin_redemptions r join prizes p on p.id = r.prize_id
      where r.idempotency_key = ${input.idempotencyKey} limit 1`;
    if (previous[0])
      return {
        redemptionId: previous[0].id,
        prize: {
          id: previous[0].prize_id,
          label: previous[0].prize_label,
          emoji: previous[0].emoji,
        },
        remainingSpins: previous[0].remaining_spins,
        targetSegment: previous[0].target_segment,
      };

    const codes = await tx<
      { id: string; remaining_spins: number; active: boolean; expires_at: Date | null }[]
    >`
      select id, remaining_spins, active, expires_at from spin_codes where code_digest = ${codeDigest} for update`;
    const code = codes[0];
    if (!code || !code.active) throw new SpinError(404, 'El código no existe o está inactivo.');
    if (code.expires_at && code.expires_at < new Date())
      throw new SpinError(410, 'El código ha vencido.');
    if (code.remaining_spins < 1)
      throw new SpinError(409, 'Este código ya no tiene giros disponibles.');

    const prizeRows = await tx<
      PrizeRow[]
    >`select id, label, emoji, weight, inventory, target_segments from prizes where active = true for update`;
    const prize = chooseWeightedPrize(prizeRows);
    const targetSegment = prize.target_segments.length
      ? prize.target_segments[randomInt(prize.target_segments.length)]!
      : 0;
    const remainingSpins = code.remaining_spins - 1;
    await tx`update spin_codes set remaining_spins = ${remainingSpins}, updated_at = now() where id = ${code.id}`;
    if (prize.inventory !== null)
      await tx`update prizes set inventory = inventory - 1, updated_at = now() where id = ${prize.id} and inventory > 0`;
    const inserted = await tx<{ id: string }[]>`
      insert into spin_redemptions (idempotency_key, code_id, prize_id, prize_label, target_segment, remaining_spins)
      values (${input.idempotencyKey}, ${code.id}, ${prize.id}, ${prize.label}, ${targetSegment}, ${remainingSpins}) returning id`;
    return {
      redemptionId: inserted[0]!.id,
      prize: { id: prize.id, label: prize.label, emoji: prize.emoji },
      remainingSpins,
      targetSegment,
    };
  });
}

import { z } from 'zod';
import { idempotencyKeySchema, moneyCentsSchema, positiveMoneyCentsSchema } from './foundation.js';

export const cashSessionOpenSchema = z.object({
  idempotencyKey: idempotencyKeySchema,
  openingFundCents: moneyCentsSchema,
});
export const cashMovementSchema = z.object({
  idempotencyKey: idempotencyKeySchema,
  kind: z.enum(['income', 'expense', 'withdrawal', 'adjustment']),
  amountCents: positiveMoneyCentsSchema,
  reason: z.string().trim().min(3).max(300),
});
export const cashSessionCloseSchema = z.object({
  idempotencyKey: idempotencyKeySchema,
  countedCents: moneyCentsSchema,
  note: z.string().trim().max(300).default(''),
});
export const cashSessionSchema = z.object({
  id: z.uuid(),
  status: z.enum(['open', 'closed']),
  openingFundCents: moneyCentsSchema,
  expectedCents: z.number().int(),
  countedCents: z.number().int().nullable(),
  differenceCents: z.number().int().nullable(),
  openedAt: z.string().datetime({ offset: true }),
  closedAt: z.string().datetime({ offset: true }).nullable(),
});
export const cashSessionStateSchema = z.object({
  session: cashSessionSchema.nullable(),
  movements: z.array(
    z.object({
      id: z.uuid(),
      kind: z.string(),
      amountCents: z.number().int(),
      reason: z.string(),
      createdAt: z.string().datetime({ offset: true }),
    }),
  ),
});
export type CashSessionOpen = z.infer<typeof cashSessionOpenSchema>;
export type CashMovement = z.infer<typeof cashMovementSchema>;
export type CashSessionClose = z.infer<typeof cashSessionCloseSchema>;
export type CashSessionState = z.infer<typeof cashSessionStateSchema>;

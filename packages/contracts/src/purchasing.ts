import { z } from 'zod';
import { decimalStringSchema } from './foundation.js';

const cents = z.number().int().min(0).max(100_000_000);
const qty = decimalStringSchema.refine((v) => Number(v) > 0 && Number(v) <= 1_000_000);
export const supplierCreateSchema = z.object({
  name: z.string().trim().min(2).max(160),
  contactName: z.string().trim().max(120).default(''),
  contactPhone: z.string().trim().max(40).default(''),
});
export const presentationCreateSchema = z.object({
  ingredientId: z.uuid(),
  supplierId: z.uuid().optional(),
  name: z.string().trim().min(1).max(120),
  baseQuantity: qty,
});
export const purchaseCreateSchema = z
  .object({
    idempotencyKey: z.uuid(),
    supplierId: z.uuid(),
    reference: z.string().trim().max(160).default(''),
    paymentMethod: z.enum(['cash', 'card', 'transfer']),
    fundsOrigin: z.enum(['cash_session', 'external']),
    discountCents: cents.default(0),
    acquisitionCents: cents.default(0),
    lines: z
      .array(
        z.object({
          ingredientId: z.uuid(),
          presentationId: z.uuid(),
          presentationQuantity: qty,
          grossCents: cents.positive(),
        }),
      )
      .min(1)
      .max(100),
  })
  .refine(
    (x) => new Set(x.lines.map((l) => l.ingredientId)).size === x.lines.length,
    'Ingrediente repetido',
  );
export const purchaseReversalSchema = z.object({
  idempotencyKey: z.uuid(),
  reason: z.string().trim().min(3).max(300),
});
export type PurchaseCreate = z.infer<typeof purchaseCreateSchema>;

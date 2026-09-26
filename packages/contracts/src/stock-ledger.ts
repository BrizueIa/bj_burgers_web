import { z } from 'zod';
import { decimalStringSchema } from './foundation.js';

export const stockUnitSchema = z.enum(['g', 'ml', 'pz']);
export const stockReasonSchema = z.string().trim().min(3).max(300);
export const stockQuantitySchema = decimalStringSchema.refine(
  (value) => Number(value) > 0 && Number(value) <= 1_000_000,
  'La cantidad debe ser mayor a cero y no exceder el límite.',
);
export const stockUnitCostSchema = decimalStringSchema.refine(
  (value) => Number(value) >= 0 && Number(value) <= 100_000_000,
  'El costo unitario no es válido.',
);

export const stockReservationRequestSchema = z.object({
  idempotencyKey: z.uuid(),
  ingredientId: z.uuid(),
  quantity: stockQuantitySchema,
  referenceType: z.string().trim().min(1).max(80),
  referenceId: z.string().trim().min(1).max(160),
  reason: stockReasonSchema,
});

export const stockReservationResolveRequestSchema = z.object({
  idempotencyKey: z.uuid(),
  reason: stockReasonSchema,
});

export const stockCountRequestSchema = z.object({
  idempotencyKey: z.uuid(),
  ingredientId: z.uuid(),
  countedQuantity: z.string().regex(/^-?\d{1,13}(?:\.\d{1,3})?$/),
  unitCostCents: stockUnitCostSchema.optional(),
  reason: stockReasonSchema,
});

export const stockWasteRequestSchema = z.object({
  idempotencyKey: z.uuid(),
  ingredientId: z.uuid(),
  quantity: stockQuantitySchema,
  reason: stockReasonSchema,
  cause: z.enum(['waste', 'expired']),
});

const stockMovementSchema = z.object({
  id: z.uuid(),
  ingredient_id: z.uuid(),
  movement_type: z.enum([
    'initial',
    'purchase',
    'sale',
    'waste',
    'adjustment',
    'count',
    'production_consume',
    'production_output',
  ]),
  quantity_delta: z.string(),
  value_delta_cents: z.string(),
  stock_after: z.string(),
  value_after_cents: z.string(),
  reason: z.string(),
  created_at: z.string().datetime({ offset: true }),
});

export const stockLedgerStateSchema = z.object({
  ingredients: z.array(
    z.object({
      id: z.uuid(),
      name: z.string(),
      unit: stockUnitSchema,
      stock: z.string(),
      reserved: z.string(),
      available: z.string(),
      value_cents: z.string(),
      minimum: z.string(),
    }),
  ),
  movements: z.array(stockMovementSchema),
  nextCursor: z.string().nullable(),
});

export const stockIngredientBalanceSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  unit: stockUnitSchema,
  stock: z.string(),
  reserved: z.string(),
  available: z.string(),
  value_cents: z.string(),
  minimum: z.string(),
});
export const stockMutationResponseSchema = z.object({
  ingredient: stockIngredientBalanceSchema,
  reused: z.boolean(),
});
export const stockReservationResponseSchema = z.object({
  reservation: z.object({
    id: z.uuid(),
    quantity: z.union([z.string(), z.number()]),
    status: z.literal('active'),
  }),
  ingredient: stockIngredientBalanceSchema,
  reused: z.boolean(),
});
export const stockReservationReleaseResponseSchema = z.object({
  reservationId: z.uuid(),
  status: z.literal('released'),
  ingredient: stockIngredientBalanceSchema,
  reused: z.boolean(),
});

export type StockLedgerState = z.infer<typeof stockLedgerStateSchema>;
export type StockReservationRequest = z.infer<typeof stockReservationRequestSchema>;
export type StockReservationResolveRequest = z.infer<typeof stockReservationResolveRequestSchema>;
export type StockCountRequest = z.infer<typeof stockCountRequestSchema>;
export type StockWasteRequest = z.infer<typeof stockWasteRequestSchema>;

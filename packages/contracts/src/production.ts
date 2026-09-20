import { z } from 'zod';
import { stockQuantitySchema, stockReasonSchema, stockUnitSchema } from './stock-ledger.js';
export const productionBatchCreateSchema = z.object({
  idempotencyKey: z.uuid(),
  productId: z.string().min(1),
  outputQuantity: stockQuantitySchema,
  outputUnit: stockUnitSchema,
  reason: stockReasonSchema,
});
export const productionBatchResponseSchema = z.object({
  batchId: z.uuid(),
  outputIngredientId: z.uuid(),
  outputQuantity: z.string(),
  consumedCostCents: z.string(),
  reused: z.boolean(),
});
export type ProductionBatchCreate = z.infer<typeof productionBatchCreateSchema>;

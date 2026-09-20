import { z } from 'zod';
import { orderItemInputSchema } from './operator.js';
export const unifiedOrderQuoteSchema = z.object({
  fulfillment: z.enum(['counter', 'pickup', 'delivery']),
  customerName: z.string().trim().max(160).default(''),
  neighborhood: z.string().trim().max(160).default(''),
  streetAndNumber: z.string().trim().max(300).default(''),
  items: z.array(orderItemInputSchema).min(1).max(40),
});
export const unifiedOrderConfirmSchema = unifiedOrderQuoteSchema.extend({
  idempotencyKey: z.uuid(),
});
export const unifiedOrderQuoteResponseSchema = z.object({
  fulfillment: z.enum(['counter', 'pickup', 'delivery']),
  subtotalCents: z.number().int().nonnegative(),
  deliveryCents: z.number().int().nonnegative(),
  totalCents: z.number().int().nonnegative(),
  promotion: z.record(z.string(), z.unknown()).nullable(),
});
export type UnifiedOrderConfirm = z.infer<typeof unifiedOrderConfirmSchema>;

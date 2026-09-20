import { z } from 'zod';
import { moneyCentsSchema } from './foundation.js';
import { orderItemInputSchema } from './operator.js';

export const unifiedOrderQuoteSchema = z.object({
  fulfillment: z.enum(['counter', 'pickup', 'delivery']),
  customerName: z.string().trim().max(160).default(''),
  neighborhood: z.string().trim().max(160).default(''),
  streetAndNumber: z.string().trim().max(300).default(''),
  items: z.array(orderItemInputSchema).min(1).max(40),
});

/** The operator explicitly accepts the last server quote. A different amount
 * is never silently confirmed after a price or promotion change. */
export const unifiedOrderConfirmSchema = unifiedOrderQuoteSchema.extend({
  quotedTotalCents: moneyCentsSchema,
  idempotencyKey: z.uuid(),
});

export const unifiedOrderQuoteResponseSchema = z.object({
  fulfillment: z.enum(['counter', 'pickup', 'delivery']),
  subtotalCents: moneyCentsSchema,
  deliveryCents: moneyCentsSchema,
  totalCents: moneyCentsSchema,
  promotion: z.record(z.string(), z.unknown()).nullable(),
});

export type UnifiedOrderQuote = z.infer<typeof unifiedOrderQuoteSchema>;
export type UnifiedOrderConfirm = z.infer<typeof unifiedOrderConfirmSchema>;

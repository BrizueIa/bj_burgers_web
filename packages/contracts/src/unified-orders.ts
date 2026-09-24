import { z } from 'zod';
import { moneyCentsSchema } from './foundation.js';
import { orderItemInputSchema } from './operator.js';

export const unifiedOrderQuoteSchema = z
  .object({
    fulfillment: z.enum(['counter', 'pickup', 'delivery']),
    customerName: z.string().trim().max(160).default(''),
    neighborhood: z.string().trim().max(160).default(''),
    streetAndNumber: z.string().trim().max(300).default(''),
    manualDiscountCents: moneyCentsSchema.default(0),
    manualDiscountReason: z.string().trim().max(300).default(''),
    items: z.array(orderItemInputSchema).min(1).max(40),
  })
  .refine(
    (order) =>
      order.fulfillment !== 'delivery' ||
      (order.customerName.length > 0 &&
        order.neighborhood.length > 0 &&
        order.streetAndNumber.length > 0),
    'Para domicilio se requiere nombre, colonia y dirección.',
  )
  .refine(
    (order) => order.manualDiscountCents === 0 || order.manualDiscountReason.length >= 3,
    'Un descuento manual requiere un motivo de al menos 3 caracteres.',
  );

/** The operator explicitly accepts the last server quote. A different amount
 * is never silently confirmed after a price or promotion change. */
export const unifiedOrderConfirmSchema = unifiedOrderQuoteSchema.extend({
  quotedTotalCents: moneyCentsSchema,
  idempotencyKey: z.uuid(),
  source: z.enum(['pos', 'manual_whatsapp']).optional(),
  rawMessage: z.string().max(16000).optional(),
});

export const unifiedOrderQuoteResponseSchema = z.object({
  fulfillment: z.enum(['counter', 'pickup', 'delivery']),
  subtotalCents: moneyCentsSchema,
  deliveryCents: moneyCentsSchema,
  totalCents: moneyCentsSchema,
  manualDiscountCents: moneyCentsSchema,
  manualDiscountReason: z.string(),
  promotion: z.record(z.string(), z.unknown()).nullable(),
});

export type UnifiedOrderQuote = z.infer<typeof unifiedOrderQuoteSchema>;
export type UnifiedOrderConfirm = z.infer<typeof unifiedOrderConfirmSchema>;

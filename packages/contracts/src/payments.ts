import { z } from 'zod';
import { idempotencyKeySchema, positiveMoneyCentsSchema } from './foundation.js';
const paymentLine = z
  .object({
    method: z.enum(['cash', 'card', 'transfer']),
    receivedCents: positiveMoneyCentsSchema,
    appliedCents: positiveMoneyCentsSchema,
  })
  .refine((x) => x.appliedCents <= x.receivedCents, 'No se puede aplicar más que lo recibido.')
  .refine(
    (x) => x.method === 'cash' || x.appliedCents === x.receivedCents,
    'Tarjeta y transferencia no admiten cambio.',
  );
export const orderPaymentCreateSchema = z.object({
  idempotencyKey: idempotencyKeySchema,
  payments: z.array(paymentLine).min(1).max(5),
});
export const counterCheckoutSchema = orderPaymentCreateSchema;
export const orderRefundCreateSchema = z.object({
  idempotencyKey: idempotencyKeySchema,
  paymentId: z.uuid(),
  orderItemId: z.uuid().optional(),
  amountCents: positiveMoneyCentsSchema,
  reason: z.string().trim().min(3).max(300),
});
export type OrderPaymentCreate = z.infer<typeof orderPaymentCreateSchema>;
export type CounterCheckout = z.infer<typeof counterCheckoutSchema>;
export type OrderRefundCreate = z.infer<typeof orderRefundCreateSchema>;

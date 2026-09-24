import { z } from 'zod';
import { idempotencyKeySchema } from './foundation.js';
import { orderSchema } from './operator.js';

export const ticketIssueSchema = z.object({ idempotencyKey: idempotencyKeySchema });
export const ticketPaymentSchema = z.object({
  method: z.enum(['cash', 'card', 'transfer']),
  appliedCents: z.number().int().positive(),
});
export const orderTicketSchema = z.object({
  id: z.uuid(),
  orderId: z.uuid(),
  issuedAt: z.string().datetime({ offset: true }),
  order: orderSchema,
  payments: z.array(ticketPaymentSchema),
});
export const orderTicketResponseSchema = z.object({
  ticket: orderTicketSchema,
  reused: z.boolean(),
});

export type TicketIssue = z.infer<typeof ticketIssueSchema>;
export type OrderTicket = z.infer<typeof orderTicketSchema>;

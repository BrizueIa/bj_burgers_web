import { z } from 'zod';
import { idempotencyKeySchema, positiveMoneyCentsSchema } from './foundation.js';

export const expenseCreateSchema = z
  .object({
    idempotencyKey: idempotencyKeySchema,
    category: z.enum(['rent', 'utilities', 'supplies', 'maintenance', 'commission', 'other']),
    description: z.string().trim().min(3).max(300),
    amountCents: positiveMoneyCentsSchema,
    paymentMethod: z.enum(['cash', 'card', 'transfer']),
    fundsOrigin: z.enum(['cash_session', 'external']),
    occurredAt: z.string().datetime({ offset: true }),
    paymentId: z.uuid().optional(),
  })
  .refine(
    (expense) =>
      (expense.category === 'commission' &&
        Boolean(expense.paymentId) &&
        expense.fundsOrigin === 'external') ||
      (expense.category !== 'commission' && !expense.paymentId),
    'La comisión requiere el pago original y fondos externos; otros gastos no aceptan un pago ligado.',
  );
export const expenseCreateResponseSchema = z.object({
  id: z.uuid(),
  category: z.string(),
  description: z.string(),
  amountCents: z.number().int().positive(),
  paymentMethod: z.enum(['cash', 'card', 'transfer']),
  fundsOrigin: z.enum(['cash_session', 'external']),
  cashSessionId: z.uuid().nullable(),
  paymentId: z.uuid().nullable(),
  occurredAt: z.string().datetime({ offset: true }),
  reused: z.boolean(),
});

export type ExpenseCreate = z.infer<typeof expenseCreateSchema>;

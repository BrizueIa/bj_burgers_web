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

export type ExpenseCreate = z.infer<typeof expenseCreateSchema>;

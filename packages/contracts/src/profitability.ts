import { z } from 'zod';

export const reportPeriodSchema = z
  .object({
    from: z.iso.date(),
    to: z.iso.date(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(200).default(50),
  })
  .refine(
    (period) => period.from <= period.to,
    'La fecha inicial debe ser anterior o igual a la final.',
  )
  .refine(
    (period) =>
      new Date(`${period.to}T00:00:00Z`).getTime() -
        new Date(`${period.from}T00:00:00Z`).getTime() <=
      366 * 24 * 60 * 60 * 1000,
    'El reporte admite periodos de hasta 367 días naturales.',
  );

const cents = z.number().int();
export const profitabilityReportSchema = z.object({
  from: z.string().datetime({ offset: true }),
  to: z.string().datetime({ offset: true }),
  page: z.number().int(),
  pageSize: z.number().int(),
  totalRows: z.number().int().nonnegative(),
  summary: z.object({
    deliveredOrders: z.number().int().nonnegative(),
    grossSalesCents: cents,
    refundsCents: cents,
    netSalesCents: cents,
    costOfGoodsSoldCents: cents,
    grossProfitCents: cents,
    commissionsCents: cents,
    operatingExpensesCents: cents,
    wasteCents: cents,
    operatingResultCents: cents,
    cashCollectedCents: cents,
    cashRefundedCents: cents,
    cashFlowInCents: cents,
    cashFlowOutCents: cents,
    pendingCostCents: cents,
    unvaluedDeliveredOrders: z.number().int().nonnegative(),
  }),
  byFulfillment: z.array(
    z.object({ key: z.string(), orders: z.number().int(), amountCents: cents }),
  ),
  byPayment: z.array(z.object({ key: z.string(), amountCents: cents })),
  byProduct: z.array(z.object({ key: z.string(), quantity: z.number(), amountCents: cents })),
  rows: z.array(
    z.object({
      occurredAt: z.string().datetime({ offset: true }),
      kind: z.enum(['sale', 'refund', 'expense', 'waste', 'cash_movement']),
      id: z.string(),
      description: z.string(),
      amountCents: cents,
      costCents: cents,
      method: z.string(),
    }),
  ),
});

export type ReportPeriod = z.infer<typeof reportPeriodSchema>;
export type ProfitabilityReport = z.infer<typeof profitabilityReportSchema>;

import { z } from 'zod';

/** Decimal quantities cross application boundaries as strings to avoid binary
 * floating-point rounding. The database stores the same values as numeric(16,3). */
export const decimalStringSchema = z
  .string()
  .regex(/^(?:0|[1-9]\d{0,12})(?:\.\d{1,3})?$/, 'Decimal de hasta tres posiciones requerido.');
export const positiveDecimalStringSchema = decimalStringSchema.refine(
  (value) => Number(value) > 0,
  'La cantidad debe ser positiva.',
);

/** MXN amounts are integer cents and are deliberately bounded per operation. */
export const moneyCentsSchema = z.number().int().min(0).max(100_000_000);
export const positiveMoneyCentsSchema = moneyCentsSchema.positive();
export const idempotencyKeySchema = z.uuid();

export const capabilityKeySchema = z.enum([
  'stock_ledger',
  'purchasing',
  'recipe_versions',
  'production',
  'unified_orders',
  'cash_sessions',
  'payments_refunds',
  'pos_tickets',
  'expenses',
  'profitability_reports',
  'pos_cutover',
]);
export const capabilitySchema = z.object({
  key: capabilityKeySchema,
  enabled: z.boolean(),
  updatedAt: z.string().datetime({ offset: true }),
});
export const capabilitiesResponseSchema = z.object({ capabilities: z.array(capabilitySchema) });
export const capabilityActivationSchema = z.object({
  idempotencyKey: idempotencyKeySchema,
  enabled: z.boolean(),
  activationNote: z.string().trim().min(8).max(500),
});
export type CapabilityActivation = z.infer<typeof capabilityActivationSchema>;
export const capabilityReadinessSchema = z.object({
  capabilities: z.array(capabilitySchema),
  legacyPendingOrders: z.number().int().nonnegative(),
});

export const authenticatedActorSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('admin'), userId: z.uuid(), origin: z.literal('admin_web') }),
  z.object({ kind: z.literal('device'), deviceId: z.uuid(), origin: z.literal('android') }),
]);

export type DecimalString = z.infer<typeof decimalStringSchema>;
export type CapabilityKey = z.infer<typeof capabilityKeySchema>;
export type Capability = z.infer<typeof capabilitySchema>;
export type AuthenticatedActor = z.infer<typeof authenticatedActorSchema>;

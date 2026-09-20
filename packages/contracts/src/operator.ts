import { z } from 'zod';

export const orderStatusSchema = z.enum([
  'new',
  'preparing',
  'ready',
  'out_for_delivery',
  'delivered',
  'cancelled',
]);

export const operatorDeviceActivationSchema = z.object({
  deviceId: z.uuid(),
  pairingCode: z.string().trim().min(12).max(128),
});

export const orderItemInputSchema = z.object({
  productId: z.string().min(1),
  quantity: z.number().int().min(1).max(20),
  removedIngredients: z.array(z.string().trim().min(1)).max(20).default([]),
  modifierIds: z.array(z.string().min(1)).max(20).default([]),
  combo: z.boolean().default(false),
  drinkProductId: z.string().min(1).optional(),
  note: z.string().trim().max(500).default(''),
});

export const orderDraftParseRequestSchema = z.object({
  rawMessage: z.string().trim().min(3).max(16000),
});

export const orderCreateRequestSchema = z.object({
  rawMessage: z.string().trim().max(16000).default(''),
  customerName: z.string().trim().min(1).max(160),
  neighborhood: z.string().trim().max(160).default(''),
  streetAndNumber: z.string().trim().max(300).default(''),
  references: z.string().trim().max(500).default(''),
  deliveryNotes: z.string().trim().max(500).default(''),
  items: z.array(orderItemInputSchema).min(1).max(40),
  idempotencyKey: z.uuid(),
});

export const orderStatusUpdateSchema = z.object({
  status: orderStatusSchema,
  note: z.string().trim().max(500).default(''),
  idempotencyKey: z.uuid().optional(),
});

export const spinCodeIssueRequestSchema = z.object({ idempotencyKey: z.uuid() });

/** Operator API responses. Keeping these at the boundary makes every mobile
 * client reject malformed server responses before rendering or persisting them. */
export const operatorDeviceSchema = z.object({ id: z.uuid(), name: z.string().min(1) });
export const operatorDeviceActivationResponseSchema = z.object({
  device: operatorDeviceSchema,
  credential: z.string().min(20),
});

export const orderModifierSnapshotSchema = z.object({
  id: z.string(),
  name: z.string(),
  priceCents: z.number().int().nonnegative(),
});
export const orderItemSchema = z.object({
  id: z.uuid(),
  productId: z.string(),
  productName: z.string(),
  unitPriceCents: z.number().int().nonnegative(),
  quantity: z.number().int().positive(),
  removedIngredients: z.array(z.string()),
  modifiers: z.array(orderModifierSnapshotSchema),
  combo: z
    .object({
      drinkProductId: z.string(),
      drinkName: z.string(),
      priceCents: z.number().int().nonnegative(),
    })
    .nullable(),
  note: z.string(),
  lineTotalCents: z.number().int().nonnegative(),
});
export const orderEventSchema = z.object({
  id: z.uuid(),
  type: z.string(),
  status: orderStatusSchema.nullable(),
  note: z.string(),
  createdAt: z.string().datetime({ offset: true }),
});
export const orderSchema = z.object({
  id: z.uuid(),
  source: z.string(),
  fulfillment: z.enum(['counter', 'pickup', 'delivery']),
  status: orderStatusSchema,
  customerName: z.string(),
  neighborhood: z.string(),
  streetAndNumber: z.string(),
  references: z.string(),
  deliveryNotes: z.string(),
  rawMessage: z.string(),
  promotion: z.record(z.string(), z.unknown()).nullable(),
  subtotalCents: z.number().int().nonnegative(),
  deliveryCents: z.number().int().nonnegative(),
  totalCents: z.number().int().nonnegative(),
  paidCents: z.number().int().nonnegative(),
  refundedCents: z.number().int().nonnegative(),
  balanceCents: z.number().int().nonnegative(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
  quotedAt: z.string().datetime({ offset: true }).nullable(),
  preparingAt: z.string().datetime({ offset: true }).nullable(),
  deliveredAt: z.string().datetime({ offset: true }).nullable(),
  cancelledAt: z.string().datetime({ offset: true }).nullable(),
  spinCodeIssued: z.boolean(),
  items: z.array(orderItemSchema),
  events: z.array(orderEventSchema),
});
export const orderDraftSchema = z.object({
  rawMessage: z.string(),
  customerName: z.string(),
  neighborhood: z.string(),
  streetAndNumber: z.string(),
  references: z.string(),
  deliveryNotes: z.string(),
  items: z.array(orderItemInputSchema.extend({ productName: z.string() })),
  unresolvedLines: z.array(z.string()),
});
export const ordersResponseSchema = z.object({ orders: z.array(orderSchema) });
export const orderResponseSchema = z.object({ order: orderSchema });
export const spinCodeIssueResponseSchema = z.object({
  code: z.string(),
  expiresAt: z.string().datetime({ offset: true }).nullable(),
  reused: z.boolean(),
});

const decimalSchema = z.union([z.number(), z.string()]);
export const businessIngredientSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  unit: z.enum(['g', 'ml', 'pz']),
  stock: decimalSchema,
  reserved: decimalSchema,
  minimum: decimalSchema,
  value_cents: decimalSchema,
  last_cost: decimalSchema.nullable(),
  unit_cost: decimalSchema.nullable(),
});
export const businessProductSchema = z.object({
  id: z.string(),
  name: z.string(),
  price_cents: z.number().int().nonnegative(),
  available: z.boolean(),
  target_margin: z.number().int().nullable(),
  overhead_cents: z.number().int().nullable(),
  cost_cents: z.number().int().nullable(),
  recommended_price_cents: z.number().int().nullable(),
  margin_percent: decimalSchema.nullable(),
});
export const businessEntrySchema = z.object({
  id: z.uuid(),
  kind: z.enum(['purchase', 'sale', 'waste', 'expense']),
  description: z.string(),
  payment: z.enum(['', 'cash', 'card', 'transfer']),
  total_cents: z.number().int().nonnegative(),
  cost_cents: z.number().int().nonnegative(),
  lines: z.array(z.record(z.string(), z.unknown())),
  created_at: z.string().datetime({ offset: true }),
});
export const businessStateResponseSchema = z.object({
  ingredients: z.array(businessIngredientSchema),
  products: z.array(businessProductSchema),
  recipes: z.array(
    z.object({ product_id: z.string(), ingredient_id: z.uuid(), quantity: decimalSchema }),
  ),
  entries: z.array(businessEntrySchema),
  report: z.object({
    sales_count: z.number().int().nonnegative(),
    revenue_cents: decimalSchema,
    cost_cents: decimalSchema,
    purchases_cents: decimalSchema,
    expenses_cents: decimalSchema,
    waste_cents: decimalSchema,
  }),
  from: z.string().datetime({ offset: true }),
  to: z.string().datetime({ offset: true }),
});

export type OrderStatus = z.infer<typeof orderStatusSchema>;
export type OperatorDeviceActivation = z.infer<typeof operatorDeviceActivationSchema>;
export type OrderItemInput = z.infer<typeof orderItemInputSchema>;
export type OrderCreateRequest = z.infer<typeof orderCreateRequestSchema>;
export type OperatorDeviceActivationResponse = z.infer<
  typeof operatorDeviceActivationResponseSchema
>;
export type Order = z.infer<typeof orderSchema>;
export type OrderDraft = z.infer<typeof orderDraftSchema>;
export type BusinessState = z.infer<typeof businessStateResponseSchema>;

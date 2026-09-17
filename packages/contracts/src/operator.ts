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
});

export const spinCodeIssueRequestSchema = z.object({ idempotencyKey: z.uuid() });

export type OrderStatus = z.infer<typeof orderStatusSchema>;
export type OperatorDeviceActivation = z.infer<typeof operatorDeviceActivationSchema>;
export type OrderItemInput = z.infer<typeof orderItemInputSchema>;
export type OrderCreateRequest = z.infer<typeof orderCreateRequestSchema>;

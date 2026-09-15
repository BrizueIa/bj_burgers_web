import { z } from 'zod';

export const categorySchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  description: z.string().default(''),
  order: z.number().int(),
  active: z.boolean(),
});

export const modifierSchema = z.object({
  id: z.string(),
  name: z.string(),
  priceCents: z.number().int().nonnegative(),
  available: z.boolean(),
});

export const productSchema = z.object({
  id: z.string(),
  slug: z.string(),
  categoryId: z.string(),
  name: z.string(),
  description: z.string(),
  priceCents: z.number().int().nonnegative(),
  ingredients: z.array(z.string()),
  removableIngredients: z.array(z.string()),
  comboEligible: z.boolean(),
  featured: z.boolean(),
  available: z.boolean(),
  order: z.number().int(),
});

export const promotionRuleSchema = z.object({
  kind: z.enum(['bundle_fixed', 'free_item', 'price_override']),
  eligibleCategory: z.string().optional(),
  eligibleProductIds: z.array(z.string()).default([]),
  baseProductId: z.string().optional(),
  requiredQuantity: z.number().int().positive(),
  fixedPriceCents: z.number().int().nonnegative().optional(),
  freeItemLabel: z.string().optional(),
  freeQuantity: z.number().int().nonnegative().optional(),
  unitPriceCents: z.number().int().nonnegative().optional(),
  allowPaidSubstitution: z.boolean().default(false),
});

export const promotionSchema = z.object({
  id: z.string(),
  name: z.string(),
  shortDescription: z.string(),
  daysOfWeek: z.array(z.number().int().min(0).max(6)),
  startsAt: z.string().nullable(),
  endsAt: z.string().nullable(),
  priority: z.number().int(),
  active: z.boolean(),
  rule: promotionRuleSchema,
});

export const businessSettingsSchema = z.object({
  name: z.string(),
  slogan: z.string(),
  whatsappNumber: z.string(),
  phoneDisplay: z.string(),
  timezone: z.string(),
  freeDeliveryArea: z.string(),
  deliveryNotice: z.string(),
  temporarilyClosed: z.boolean(),
  closureMessage: z.string(),
  schedule: z.array(
    z.object({
      dayOfWeek: z.number().int().min(0).max(6),
      opens: z.string(),
      closes: z.string(),
    }),
  ),
  updatedAt: z.string(),
});

export const catalogSchema = z.object({
  version: z.string(),
  categories: z.array(categorySchema),
  products: z.array(productSchema),
  modifiers: z.array(modifierSchema),
  promotions: z.array(promotionSchema),
  business: businessSettingsSchema,
});

export const spinRedeemRequestSchema = z.object({
  code: z.string().trim().min(4).max(64),
  idempotencyKey: z.uuid(),
});

export const spinRedeemResponseSchema = z.object({
  redemptionId: z.uuid(),
  prize: z.object({ id: z.string(), label: z.string(), emoji: z.string() }),
  remainingSpins: z.number().int().nonnegative(),
  targetSegment: z.number().int().nonnegative(),
  mode: z.enum(['redeem', 'demo']).default('redeem'),
  verificationPath: z.string(),
});

export type Category = z.infer<typeof categorySchema>;
export type Modifier = z.infer<typeof modifierSchema>;
export type Product = z.infer<typeof productSchema>;
export type Promotion = z.infer<typeof promotionSchema>;
export type PromotionRule = z.infer<typeof promotionRuleSchema>;
export type BusinessSettings = z.infer<typeof businessSettingsSchema>;
export type Catalog = z.infer<typeof catalogSchema>;
export type SpinRedeemRequest = z.infer<typeof spinRedeemRequestSchema>;
export type SpinRedeemResponse = z.infer<typeof spinRedeemResponseSchema>;

export interface CartItem {
  id: string;
  productId: string;
  quantity: number;
  removedIngredients: string[];
  modifierIds: string[];
  combo: boolean;
  drinkProductId?: string;
  note: string;
}

export interface AppliedPromotion {
  id: string;
  name: string;
  discountCents: number;
  freeItems: string[];
}

export interface CartTotals {
  itemsCents: number;
  modifiersCents: number;
  combosCents: number;
  discountCents: number;
  totalCents: number;
  promotion: AppliedPromotion | null;
}

export interface DeliveryDetails {
  customerName: string;
  neighborhood: string;
  streetAndNumber: string;
  references: string;
  deliveryNotes: string;
}

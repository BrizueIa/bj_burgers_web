import { z } from 'zod';
import { decimalStringSchema } from './foundation.js';

const quantity = decimalStringSchema.refine(
  (value) => Number(value) > 0 && Number(value) <= 1_000_000,
);
const recipeComponentSchema = z
  .object({
    kind: z.enum(['ingredient', 'product', 'packaging', 'modifier']),
    ingredientId: z.uuid().optional(),
    productId: z.string().min(1).optional(),
    modifierId: z.string().min(1).optional(),
    quantity,
    removable: z.boolean().default(false),
    extra: z.boolean().default(false),
  })
  .superRefine((component, context) => {
    const references = [component.ingredientId, component.productId, component.modifierId].filter(
      Boolean,
    );
    if (references.length !== 1)
      context.addIssue({ code: 'custom', message: 'Cada componente requiere una referencia.' });
    if (
      (component.kind === 'ingredient' || component.kind === 'packaging') &&
      !component.ingredientId
    )
      context.addIssue({ code: 'custom', message: 'El componente requiere un insumo.' });
    if (component.kind === 'product' && !component.productId)
      context.addIssue({ code: 'custom', message: 'El componente requiere un producto.' });
    if (component.kind === 'modifier' && !component.modifierId)
      context.addIssue({ code: 'custom', message: 'El componente requiere un extra.' });
  });

export const recipeVersionCreateSchema = z.object({
  idempotencyKey: z.uuid(),
  productId: z.string().min(1),
  targetMargin: z.number().int().min(1).max(95),
  overheadCents: z.number().int().min(0).max(100_000_000),
  priceCents: z.number().int().min(0).max(100_000_000).optional(),
  components: z.array(recipeComponentSchema).min(1).max(100),
});
export const recipeVersionMutationResponseSchema = z.object({
  recipeVersionId: z.uuid(),
  versionNumber: z.number().int().positive(),
  reused: z.boolean(),
});
export const recipeVersionStateSchema = z.object({
  versions: z.array(
    z.object({
      id: z.uuid(),
      product_id: z.string(),
      product_name: z.string(),
      version_number: z.number().int().positive(),
      target_margin: z.number().int(),
      overhead_cents: z.number().int(),
      status: z.enum(['draft', 'active', 'retired']),
      created_at: z.union([z.string(), z.date()]),
      activated_at: z.union([z.string(), z.date()]).nullable(),
    }),
  ),
  components: z.array(
    z.object({
      recipe_version_id: z.uuid(),
      component_kind: z.enum(['ingredient', 'product', 'packaging', 'modifier']),
      ingredient_id: z.uuid().nullable(),
      component_product_id: z.string().nullable(),
      modifier_id: z.string().nullable(),
      component_name: z.string(),
      quantity: z.string(),
      removable: z.boolean(),
      extra: z.boolean(),
    }),
  ),
});

export type RecipeVersionCreate = z.infer<typeof recipeVersionCreateSchema>;
export type RecipeVersionState = z.infer<typeof recipeVersionStateSchema>;

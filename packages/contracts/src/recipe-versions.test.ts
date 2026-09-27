import { describe, expect, it } from 'vitest';
import { recipeVersionCreateSchema } from './recipe-versions.js';

const base = {
  idempotencyKey: '00000000-0000-4000-8000-000000000001',
  productId: 'bj-burger',
  targetMargin: 65,
  overheadCents: 0,
  components: [
    {
      kind: 'modifier' as const,
      modifierId: 'extra-tocino',
      ingredientId: '00000000-0000-4000-8000-000000000002',
      quantity: '30',
      removable: false,
      extra: true,
    },
  ],
};

describe('contrato de versiones de recetas', () => {
  it('requiere ligar cada extra con su insumo físico', () => {
    expect(recipeVersionCreateSchema.safeParse(base).success).toBe(true);
    expect(
      recipeVersionCreateSchema.safeParse({
        ...base,
        components: [{ ...base.components[0], ingredientId: undefined }],
      }).success,
    ).toBe(false);
  });
});

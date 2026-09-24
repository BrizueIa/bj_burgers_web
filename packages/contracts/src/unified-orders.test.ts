import { describe, expect, it } from 'vitest';
import { unifiedOrderQuoteSchema } from './unified-orders.js';

const quote = {
  fulfillment: 'counter' as const,
  items: [
    {
      productId: 'burger',
      quantity: 1,
      removedIngredients: [],
      modifierIds: [],
      combo: false,
      note: '',
    },
  ],
};

describe('cotización de comanda', () => {
  it('exige motivo para descuento manual y acepta cotización sin descuento', () => {
    expect(unifiedOrderQuoteSchema.safeParse(quote).success).toBe(true);
    expect(unifiedOrderQuoteSchema.safeParse({ ...quote, manualDiscountCents: 100 }).success).toBe(
      false,
    );
    expect(
      unifiedOrderQuoteSchema.safeParse({
        ...quote,
        manualDiscountCents: 100,
        manualDiscountReason: 'Atención por demora',
      }).success,
    ).toBe(true);
  });
});

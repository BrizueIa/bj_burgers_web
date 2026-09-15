import { describe, expect, it } from 'vitest';
import { calculateCart } from './cart.js';
import { seedCatalog } from './catalog.js';
import type { CartItem } from './types.js';

const item = (productId: string, quantity = 1): CartItem => ({
  id: crypto.randomUUID(),
  productId,
  quantity,
  removedIngredients: [],
  modifierIds: [],
  combo: false,
  note: '',
});

describe('promotion rules', () => {
  it('applies Thursday classic bundle', () => {
    const total = calculateCart(
      seedCatalog,
      [item('clasica', 2)],
      new Date('2026-09-17T20:00:00-06:00'),
    );
    expect(total.totalCents).toBe(12000);
    expect(total.promotion?.name).toBe('Jueves Clásico');
  });

  it('charges substitutions above the classic price', () => {
    const total = calculateCart(
      seedCatalog,
      [item('clasica'), item('bj-smash')],
      new Date('2026-09-17T20:00:00-06:00'),
    );
    expect(total.totalCents).toBe(16000);
  });

  it('includes two free portions on Friday', () => {
    const total = calculateCart(
      seedCatalog,
      [item('bbq', 2)],
      new Date('2026-09-18T20:00:00-06:00'),
    );
    expect(total.promotion?.freeItems).toEqual(['2 × Porción de papas 100 g']);
  });

  it('applies Saturday price override', () => {
    const total = calculateCart(
      seedCatalog,
      [item('salchiburger')],
      new Date('2026-09-19T20:00:00-06:00'),
    );
    expect(total.totalCents).toBe(7900);
  });
});

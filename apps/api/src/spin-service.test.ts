import { describe, expect, it } from 'vitest';
import { chooseWeightedPrize, SpinError } from './spin-service.js';

const prizes = [
  { id: 'a', label: 'A', emoji: 'A', weight: 2, inventory: null, target_segments: [0] },
  { id: 'b', label: 'B', emoji: 'B', weight: 3, inventory: 1, target_segments: [1] },
  { id: 'c', label: 'C', emoji: 'C', weight: 50, inventory: 0, target_segments: [2] },
];

describe('selección de premios', () => {
  it('respeta los límites exactos de cada peso', () => {
    expect(chooseWeightedPrize(prizes, 0).id).toBe('a');
    expect(chooseWeightedPrize(prizes, 1).id).toBe('a');
    expect(chooseWeightedPrize(prizes, 2).id).toBe('b');
    expect(chooseWeightedPrize(prizes, 4).id).toBe('b');
  });

  it('excluye inventario agotado y falla si no queda premio elegible', () => {
    expect(() => chooseWeightedPrize([{ ...prizes[2]!, weight: 1 }], 0)).toThrow(SpinError);
  });
});

import { describe, expect, it } from 'vitest';
import { centsFromInput, statusLabel } from './format.js';

describe('mobile formatting', () => {
  it('preserves MXN cents when an operator uses a comma decimal separator', () => {
    expect(centsFromInput('250,50')).toBe(25050);
  });

  it('labels the full order-state workflow in Spanish', () => {
    expect(statusLabel('out_for_delivery')).toBe('En camino');
    expect(statusLabel('cancelled')).toBe('Cancelada');
  });
});

import { describe, expect, it } from 'vitest';
import { centsFromInput, isMoneyInput, statusLabel } from './format.js';

describe('mobile formatting', () => {
  it('preserves MXN cents when an operator uses a comma decimal separator', () => {
    expect(centsFromInput('250,50')).toBe(25050);
  });

  it('treats the Android decimal-pad dot as cents, not a thousands separator', () => {
    expect(centsFromInput('250.50')).toBe(25050);
  });

  it('accepts grouped amounts in either Mexican or English formatting', () => {
    expect(centsFromInput('1,250.50')).toBe(125050);
    expect(centsFromInput('1.250,50')).toBe(125050);
    expect(centsFromInput('1,250')).toBe(125000);
  });

  it('rejects blank and non-numeric values before submitting cash operations', () => {
    expect(isMoneyInput('')).toBe(false);
    expect(isMoneyInput('abc')).toBe(false);
    expect(isMoneyInput('12.3.4')).toBe(false);
    expect(isMoneyInput('0')).toBe(true);
    expect(centsFromInput('abc')).toBe(0);
  });

  it('labels the full order-state workflow in Spanish', () => {
    expect(statusLabel('out_for_delivery')).toBe('En camino');
    expect(statusLabel('cancelled')).toBe('Cancelada');
  });
});

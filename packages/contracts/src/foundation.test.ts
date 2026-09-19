import { describe, expect, it } from 'vitest';
import {
  capabilitiesResponseSchema,
  decimalStringSchema,
  moneyCentsSchema,
  positiveDecimalStringSchema,
} from './foundation.js';

describe('contratos de fundación POS', () => {
  it('intercambia cantidades exactas como cadenas de hasta tres decimales', () => {
    expect(decimalStringSchema.parse('1000.125')).toBe('1000.125');
    expect(positiveDecimalStringSchema.safeParse('0')).toMatchObject({ success: false });
    expect(decimalStringSchema.safeParse('1.0001')).toMatchObject({ success: false });
    expect(decimalStringSchema.safeParse('01.2')).toMatchObject({ success: false });
  });

  it('limita los importes definitivos a centavos enteros por operación', () => {
    expect(moneyCentsSchema.parse(100_000_000)).toBe(100_000_000);
    expect(moneyCentsSchema.safeParse(1.5)).toMatchObject({ success: false });
    expect(moneyCentsSchema.safeParse(100_000_001)).toMatchObject({ success: false });
  });

  it('publica capacidades controladas por el servidor', () => {
    expect(
      capabilitiesResponseSchema.parse({
        capabilities: [
          { key: 'stock_ledger', enabled: false, updatedAt: '2026-09-19T00:00:00.000Z' },
        ],
      }),
    ).toHaveProperty('capabilities.0.key', 'stock_ledger');
  });
});

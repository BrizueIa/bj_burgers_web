import { describe, expect, it } from 'vitest';
import { stockCountRequestSchema } from './stock-ledger.js';

describe('contrato de conteo de inventario', () => {
  it('acepta saldos negativos para representar faltantes y sobregiros', () => {
    expect(
      stockCountRequestSchema.parse({
        idempotencyKey: '00000000-0000-4000-8000-000000000001',
        ingredientId: '00000000-0000-4000-8000-000000000002',
        countedQuantity: '-12.500',
        reason: 'Ajuste de faltante',
      }).countedQuantity,
    ).toBe('-12.500');
  });
});

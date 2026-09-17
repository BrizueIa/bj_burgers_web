import { describe, expect, it } from 'vitest';
import { seedCatalog } from '@bj/contracts';
import { decryptSecret, encryptSecret } from './security.js';
import { parseWhatsAppOrder } from './order-service.js';

describe('importación de pedidos por WhatsApp', () => {
  it('reconoce el formato público y conserva las modificaciones', () => {
    const draft = parseWhatsAppOrder(
      `Hola B&J Burgers 👑
Quiero hacer este pedido:

1. 2 × Clásica
   Sin: Cebolla, Mostaza
   Extras: Tocino
   Combo +$46 · Coca-Cola
   Nota: bien dorada

Subtotal: $200
Nombre: Ana López
Colonia: Canarios
Dirección: Calle 4 #12
Referencias: Portón negro
Indicaciones: Tocar dos veces`,
      seedCatalog,
    );
    expect(draft.customerName).toBe('Ana López');
    expect(draft.items).toHaveLength(1);
    expect(draft.items[0]).toMatchObject({
      productId: 'clasica',
      quantity: 2,
      removedIngredients: ['Mostaza', 'Cebolla'],
      modifierIds: ['extra-tocino'],
      combo: true,
      drinkProductId: 'coca-cola',
      note: 'bien dorada',
    });
  });

  it('deja visibles productos que el operador debe corregir', () => {
    const draft = parseWhatsAppOrder('1. 1 × Burger imposible\nNombre: Cliente', seedCatalog);
    expect(draft.items).toHaveLength(0);
    expect(draft.unresolvedLines).toEqual(['1. 1 × Burger imposible']);
  });
});

describe('secretos operativos', () => {
  it('cifra el código antes de persistirlo y permite recuperarlo en un reintento', () => {
    const secret = 'secreto-de-prueba-con-mas-de-treinta-y-dos-caracteres';
    const encrypted = encryptSecret('BJ-AB12CD34', secret);
    expect(encrypted).not.toContain('BJ-AB12CD34');
    expect(decryptSecret(encrypted, secret)).toBe('BJ-AB12CD34');
  });
});

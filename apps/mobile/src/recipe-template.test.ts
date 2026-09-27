import { describe, expect, it } from 'vitest';
import { seedCatalog } from '@bj/contracts';
import { recipeTemplateForProduct } from './recipe-template';

const inventory = [
  'Aderezo B&J',
  'Aderezo B&J Smash',
  'Aros de cebolla',
  'Carne Angus',
  'Catsup',
  'Cebolla',
  'Cebolla caramelizada',
  'Jamón',
  'Jalapeño',
  'Lechuga',
  'Mayonesa',
  'Mostaza',
  'Pan de hamburguesa',
  'Pan de hot dog',
  'Papas',
  'Piña asada',
  'Queso americano',
  'Queso asadero',
  'Queso Philadelphia',
  'Salchicha premium',
  'Salchichón',
  'Salsa BBQ',
  'Tomate',
  'Tocino',
  'Coca-Cola',
  'Coca-Cola Zero',
  'Delaware',
  'Escuis',
  'Fanta',
].map((name, index) => ({ id: `ingredient-${index}`, name }));

describe('plantillas de receta desde el catálogo', () => {
  it('mapea todos los ingredientes de alimentos a inventario y agrega el pan correspondiente', () => {
    for (const product of seedCatalog.products) {
      const template = recipeTemplateForProduct(product, inventory);
      expect(template.missingNames, product.name).toEqual([]);
      expect(template.lines.length, product.name).toBeGreaterThan(0);
    }

    const smash = recipeTemplateForProduct(
      seedCatalog.products.find((product) => product.id === 'bj-smash')!,
      inventory,
    );
    expect(smash.lines.map((line) => line.name)).toContain('Pan de hamburguesa');
    expect(smash.lines.map((line) => line.name)).toContain('Carne Angus');
  });

  it('unifica componentes dobles y fraccionarios sin duplicar filas físicas', () => {
    const monstruosa = recipeTemplateForProduct(
      seedCatalog.products.find((product) => product.id === 'monstruosa')!,
      inventory,
    );
    expect(monstruosa.lines.filter((line) => line.name === 'Carne Angus')).toHaveLength(1);
    expect(monstruosa.lines.filter((line) => line.name === 'Queso americano')).toHaveLength(1);
    expect(monstruosa.lines.filter((line) => line.name === 'Tocino')).toHaveLength(1);
    expect(monstruosa.lines.find((line) => line.name === 'Carne Angus')?.multiplicity).toBe(2);
    expect(monstruosa.lines.find((line) => line.name === 'Queso americano')?.multiplicity).toBe(2);
    expect(monstruosa.lines.find((line) => line.name === 'Tocino')?.multiplicity).toBe(2);

    const mixDog = recipeTemplateForProduct(
      seedCatalog.products.find((product) => product.id === 'mix-dog')!,
      inventory,
    );
    expect(mixDog.lines.map((line) => line.name)).toContain('Salchicha premium');
    expect(mixDog.lines.map((line) => line.name)).toContain('Salchichón');
    expect(mixDog.lines.find((line) => line.name === 'Salchicha premium')?.multiplicity).toBe(0.5);
    expect(mixDog.lines.find((line) => line.name === 'Salchichón')?.multiplicity).toBe(0.5);
  });

  it('prefills only known portions and maps drinks to one inventory unit', () => {
    const fries = recipeTemplateForProduct(
      seedCatalog.products.find((product) => product.id === 'papas-250')!,
      inventory,
    );
    expect(fries.lines[0]).toMatchObject({ name: 'Papas', suggestedQuantity: 250 });

    const onionRings = recipeTemplateForProduct(
      seedCatalog.products.find((product) => product.id === 'aros-100')!,
      inventory,
    );
    expect(onionRings.lines[0]).toMatchObject({
      name: 'Aros de cebolla',
      suggestedQuantity: 100,
    });

    const cola = recipeTemplateForProduct(
      seedCatalog.products.find((product) => product.id === 'coca-cola')!,
      inventory,
    );
    expect(cola.lines).toEqual([
      expect.objectContaining({ name: 'Coca-Cola', suggestedQuantity: 1 }),
    ]);
  });

  it('mapea los extras del POS a su insumo físico y marca los ingredientes removibles', () => {
    const classic = recipeTemplateForProduct(
      seedCatalog.products.find((product) => product.id === 'clasica')!,
      inventory,
      seedCatalog.modifiers,
    );
    expect(classic.lines.find((line) => line.name === 'Cebolla')).toMatchObject({
      removable: true,
    });
    expect(classic.lines.find((line) => line.name === 'Carne Angus')).toMatchObject({
      removable: false,
    });
    expect(classic.extras).toHaveLength(seedCatalog.modifiers.length);
    expect(classic.extras.find((line) => line.modifierId === 'extra-tocino')).toMatchObject({
      inventoryName: 'Tocino',
      kind: 'modifier',
      extra: true,
    });
    expect(classic.extras.find((line) => line.modifierId === 'extra-papas-150')).toMatchObject({
      inventoryName: 'Papas',
      suggestedQuantity: 100,
    });
  });
});

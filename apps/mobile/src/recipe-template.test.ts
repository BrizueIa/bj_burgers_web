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
].map((name, index) => ({ id: `ingredient-${index}`, name }));

describe('plantillas de receta desde el catálogo', () => {
  it('mapea todos los ingredientes de alimentos a inventario y agrega el pan correspondiente', () => {
    const foodProducts = seedCatalog.products.filter((product) => product.categoryId !== 'drinks');
    for (const product of foodProducts) {
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

    const mixDog = recipeTemplateForProduct(
      seedCatalog.products.find((product) => product.id === 'mix-dog')!,
      inventory,
    );
    expect(mixDog.lines.map((line) => line.name)).toContain('Salchicha premium');
    expect(mixDog.lines.map((line) => line.name)).toContain('Salchichón');
  });
});

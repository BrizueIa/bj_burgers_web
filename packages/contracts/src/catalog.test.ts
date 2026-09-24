import { describe, expect, it } from 'vitest';
import { seedCatalog } from './catalog.js';

describe('catálogo de venta POS', () => {
  it('incluye la composición confirmada de hamburguesas y hot dogs', () => {
    const burgers = seedCatalog.products.filter((product) => product.categoryId === 'burgers');
    for (const burger of burgers) {
      expect(
        burger.ingredients.some((ingredient) =>
          ingredient.toLocaleLowerCase().includes('queso americano'),
        ),
      ).toBe(true);
      expect(burger.ingredients.some((ingredient) => ingredient.includes('Angus'))).toBe(true);
    }

    const hotDogs = seedCatalog.products.filter((product) => product.categoryId === 'dogs');
    for (const hotDog of hotDogs.filter((product) => product.id !== 'salchi-dog')) {
      expect(
        hotDog.ingredients.some((ingredient) =>
          ingredient.toLocaleLowerCase().includes('salchicha premium'),
        ),
      ).toBe(true);
    }
    expect(seedCatalog.products.find((product) => product.id === 'mix-dog')?.ingredients).toContain(
      'Media salchicha premium',
    );
    expect(
      seedCatalog.products.find((product) => product.id === 'salchi-dog')?.ingredients,
    ).not.toContain('Salchicha premium');
  });

  it('conserva tamaños y precios actuales de complementos y bebidas', () => {
    const product = (id: string) => seedCatalog.products.find((candidate) => candidate.id === id);
    expect(product('papas-250')).toMatchObject({ priceCents: 4900, ingredients: ['Papas'] });
    expect(product('aros-200')).toMatchObject({
      priceCents: 5900,
      ingredients: ['Aros de cebolla'],
    });
    expect(product('aros-100')).toMatchObject({
      name: 'Porción de aros de cebolla',
      priceCents: 2600,
      ingredients: ['Aros de cebolla'],
    });
    expect(product('jalapeno-cremoso')?.ingredients).toEqual(['Jalapeño', 'Queso Philadelphia']);
    expect(product('coca-cola')?.priceCents).toBe(3900);
    for (const id of ['coca-cola-zero', 'delaware', 'escuis', 'fanta'])
      expect(product(id)?.priceCents).toBe(3600);
  });
});

import { describe, expect, it } from 'vitest';
import { categoryAfterSwipe, menuCategories } from './pos-catalog';

describe('menuCategories', () => {
  it('shows the requested selling categories in order and renames drinks', () => {
    const categories = menuCategories({
      categories: [
        { id: 'drinks', name: 'Bebidas', order: 4, active: true },
        { id: 'sides', name: 'Complementos', order: 3, active: true },
        { id: 'dogs', name: 'Hot dogs', order: 2, active: true },
        { id: 'burgers', name: 'Hamburguesas', order: 1, active: true },
      ],
    });

    expect(categories.map(({ id, name }) => ({ id, name }))).toEqual([
      { id: 'burgers', name: 'Hamburguesas' },
      { id: 'dogs', name: 'Hot dogs' },
      { id: 'sides', name: 'Complementos' },
      { id: 'extras', name: 'Extras' },
      { id: 'drinks', name: 'Refrescos' },
    ]);
  });

  it('omits inactive server categories', () => {
    const categories = menuCategories({
      categories: [{ id: 'legacy', name: 'Legacy', order: 5, active: false }],
    });

    expect(categories.map(({ id }) => id)).toEqual(['extras']);
  });
});

describe('swipe horizontal del catálogo', () => {
  const categories = ['burgers', 'dogs', 'sides', 'extras', 'drinks'].map((id) => ({ id }));

  it('avanza y retrocede una categoría según la dirección del gesto', () => {
    expect(categoryAfterSwipe(categories, 'burgers', -110, 8)).toBe('dogs');
    expect(categoryAfterSwipe(categories, 'drinks', 110, 8)).toBe('extras');
  });

  it('ignora desplazamientos verticales, cortos y los límites del catálogo', () => {
    expect(categoryAfterSwipe(categories, 'burgers', 10, 110)).toBeUndefined();
    expect(categoryAfterSwipe(categories, 'burgers', 32, 0)).toBeUndefined();
    expect(categoryAfterSwipe(categories, 'burgers', 110, 0)).toBeUndefined();
    expect(categoryAfterSwipe(categories, 'drinks', -110, 0)).toBeUndefined();
  });
});

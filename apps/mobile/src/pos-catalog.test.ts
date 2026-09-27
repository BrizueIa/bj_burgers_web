import { describe, expect, it } from 'vitest';
import { menuCategories } from './pos-catalog';

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

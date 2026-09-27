import type { Catalog } from '@bj/contracts';

type CatalogCategory = Pick<Catalog['categories'][number], 'id' | 'name' | 'order' | 'active'>;

export function menuCategories(catalog: { categories: CatalogCategory[] }) {
  return [
    ...catalog.categories
      .filter((category) => category.active && category.id !== 'drinks')
      .sort((a, b) => a.order - b.order),
    { id: 'extras', name: 'Extras', order: 4 },
    ...catalog.categories
      .filter((category) => category.active && category.id === 'drinks')
      .map((category) => ({ ...category, name: 'Refrescos' })),
  ];
}

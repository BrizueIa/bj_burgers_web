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

export function categoryAfterSwipe(
  categories: ReadonlyArray<{ id: string }>,
  currentId: string,
  distanceX: number,
  distanceY: number,
) {
  if (Math.abs(distanceX) < 72 || Math.abs(distanceX) < Math.abs(distanceY) * 1.35)
    return undefined;
  const currentIndex = categories.findIndex((category) => category.id === currentId);
  if (currentIndex < 0) return undefined;
  return categories[currentIndex + (distanceX < 0 ? 1 : -1)]?.id;
}

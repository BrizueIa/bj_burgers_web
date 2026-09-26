import type { Catalog } from '@bj/contracts';

export type RecipeInventoryIngredient = { id: string; name: string };

function normalize(value: string) {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase('es-MX');
}

function canonicalMenuIngredient(name: string) {
  if (normalize(name) === 'aderezo especial b&j smash') return 'Aderezo B&J Smash';
  return name
    .replace(/^doble\s+/i, '')
    .replace(/^medi[ao]\s+/i, '')
    .replace(/^aderezo especial\s+/i, '')
    .replace(/\s+estilo smash$/i, '')
    .trim();
}

export function recipeTemplateForProduct(
  product: Catalog['products'][number],
  inventory: RecipeInventoryIngredient[],
) {
  const names = [...product.ingredients];
  if (product.categoryId === 'burgers') names.push('Pan de hamburguesa');
  if (product.categoryId === 'dogs') names.push('Pan de hot dog');

  const lines: RecipeInventoryIngredient[] = [];
  const missingNames: string[] = [];
  for (const name of names) {
    const canonical = normalize(canonicalMenuIngredient(name));
    const ingredient = inventory.find((candidate) => normalize(candidate.name) === canonical);
    if (!ingredient) {
      missingNames.push(name);
      continue;
    }
    if (!lines.some((line) => line.id === ingredient.id)) lines.push(ingredient);
  }
  return { lines, missingNames };
}

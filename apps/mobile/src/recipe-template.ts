import type { Catalog } from '@bj/contracts';

export type RecipeInventoryIngredient = { id: string; name: string };
export type RecipeTemplateLine = RecipeInventoryIngredient & {
  kind: 'ingredient';
  suggestedQuantity?: number;
  multiplicity?: number;
  removable: boolean;
};
export type RecipeExtraTemplateLine = {
  id: `modifier:${string}`;
  name: string;
  kind: 'modifier';
  modifierId: string;
  ingredientId: string;
  inventoryName: string;
  suggestedQuantity?: number;
  extra: true;
};

function normalize(value: string) {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase('es-MX');
}

function canonicalMenuIngredient(name: string) {
  if (normalize(name) === 'aderezo especial b&j smash') return 'Aderezo B&J Smash';
  const canonical = name
    .replace(/^doble\s+/i, '')
    .replace(/^medi[ao]\s+/i, '')
    .replace(/^aderezo especial\s+/i, '')
    .replace(/\s+estilo smash$/i, '')
    .trim();
  if (normalize(canonical) === 'aderezo b&j') return 'Aderezo B&J Smash';
  return canonical;
}

function multiplicity(name: string) {
  if (/^doble\s+/i.test(name)) return 2;
  if (/^medi[ao]\s+/i.test(name)) return 0.5;
  return 1;
}

function knownQuantity(product: Catalog['products'][number], ingredientName: string) {
  if (product.categoryId === 'drinks') return 1;
  if (product.id === 'papas-250' && normalize(ingredientName) === 'papas') return 250;
  if (product.id === 'aros-200' && normalize(ingredientName) === 'aros de cebolla') return 200;
  if (product.id === 'aros-100' && normalize(ingredientName) === 'aros de cebolla') return 100;
  if (
    (product.categoryId === 'burgers' && normalize(ingredientName) === 'pan de hamburguesa') ||
    (product.categoryId === 'dogs' && normalize(ingredientName) === 'pan de hot dog')
  ) {
    return 1;
  }
  return undefined;
}

function extraInventoryName(modifierId: string) {
  const ingredients: Record<string, string> = {
    'extra-papas-150': 'Papas',
    'extra-tocino': 'Tocino',
    'extra-queso': 'Queso asadero',
    'extra-pina': 'Piña asada',
    'extra-salchichon': 'Salchichón',
    'extra-carne': 'Carne Angus',
  };
  return ingredients[modifierId];
}

export function recipeTemplateForProduct(
  product: Catalog['products'][number],
  inventory: RecipeInventoryIngredient[],
  modifiers: Pick<Catalog['modifiers'][number], 'id' | 'name'>[] = [],
) {
  const names = [...product.ingredients];
  if (product.categoryId === 'drinks' && !names.length) names.push(product.name);
  if (product.categoryId === 'burgers') names.push('Pan de hamburguesa');
  if (product.categoryId === 'dogs') names.push('Pan de hot dog');

  const lines: RecipeTemplateLine[] = [];
  const missingNames: string[] = [];
  const removableIngredients = new Set(product.removableIngredients.map(normalize));
  for (const name of names) {
    const canonical = normalize(canonicalMenuIngredient(name));
    const ingredient = inventory.find((candidate) => normalize(candidate.name) === canonical);
    if (!ingredient) {
      missingNames.push(name);
      continue;
    }
    const existing = lines.find((line) => line.id === ingredient.id);
    if (existing) {
      existing.multiplicity = (existing.multiplicity ?? 1) + multiplicity(name);
    } else {
      lines.push({
        ...ingredient,
        kind: 'ingredient',
        suggestedQuantity: knownQuantity(product, name),
        multiplicity: multiplicity(name),
        removable: removableIngredients.has(normalize(canonicalMenuIngredient(name))),
      });
    }
  }
  const extras: RecipeExtraTemplateLine[] = [];
  for (const modifier of modifiers) {
    const inventoryName = extraInventoryName(modifier.id);
    const ingredient = inventoryName
      ? inventory.find((item) => normalize(item.name) === normalize(inventoryName))
      : undefined;
    if (!inventoryName || !ingredient) {
      missingNames.push(`Extra ${modifier.name}`);
      continue;
    }
    extras.push({
      id: `modifier:${modifier.id}`,
      name: modifier.name,
      kind: 'modifier',
      modifierId: modifier.id,
      ingredientId: ingredient.id,
      inventoryName: ingredient.name,
      ...(modifier.id === 'extra-papas-150' ? { suggestedQuantity: 100 } : {}),
      extra: true,
    });
  }
  return { lines, extras, missingNames };
}

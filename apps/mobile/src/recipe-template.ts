import type { Catalog } from '@bj/contracts';

export type RecipeInventoryIngredient = { id: string; name: string; unit: 'g' | 'ml' | 'pz' };
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

function menuMultiplicity(productId: string, name: string) {
  if (
    normalize(canonicalMenuIngredient(name)) === 'aros de cebolla' &&
    ['bbq', 'monstruosa', 'crispy-dog'].includes(productId)
  )
    return 2;
  return multiplicity(name);
}

const weighedPortions: Record<string, Record<string, number>> = {
  clasica: { 'carne angus': 150, mayonesa: 15, catsup: 10, mostaza: 5 },
  hawaiana: { 'carne angus': 150, mayonesa: 15, catsup: 10, mostaza: 5 },
  'bj-smash': {
    'carne angus': 180,
    mayonesa: 15,
    catsup: 10,
    mostaza: 5,
    'aderezo b&j smash': 30,
  },
  salchiburger: { 'carne angus': 150, mayonesa: 15, catsup: 10, mostaza: 5 },
  bbq: {
    'carne angus': 150,
    mayonesa: 15,
    catsup: 10,
    mostaza: 5,
    'salsa bbq': 15,
  },
  monstruosa: {
    'carne angus': 300,
    mayonesa: 15,
    catsup: 10,
    mostaza: 5,
  },
  'dog-clasico': { mayonesa: 15, catsup: 10, mostaza: 5 },
  'bacon-dog': { mayonesa: 15, catsup: 10, mostaza: 5 },
  'salchi-dog': { mayonesa: 15, catsup: 10, mostaza: 5 },
  'crispy-dog': { 'salsa bbq': 15 },
  'bj-dog': { 'salsa bbq': 15 },
  'mix-dog': { mayonesa: 15, catsup: 10, mostaza: 5 },
  'jalapeno-cremoso': { 'queso philadelphia': 25 },
};

function knownQuantity(
  product: Catalog['products'][number],
  ingredientName: string,
  unit: RecipeInventoryIngredient['unit'],
) {
  const weighed = weighedPortions[product.id]?.[normalize(canonicalMenuIngredient(ingredientName))];
  if (weighed !== undefined) return weighed;
  if (
    unit === 'pz' &&
    normalize(canonicalMenuIngredient(ingredientName)) === 'aros de cebolla' &&
    ['bbq', 'monstruosa', 'crispy-dog'].includes(product.id)
  )
    return 2;
  if (product.id === 'aros-200' && unit === 'pz') return 1;
  if (product.id === 'papas-250' && normalize(ingredientName) === 'papas') return 250;
  if (product.id === 'aros-100' && normalize(ingredientName) === 'aros de cebolla') return 100;
  if (product.categoryId === 'drinks' || unit === 'pz') return multiplicity(ingredientName);
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
  if (product.categoryId === 'burgers')
    names.push(product.id === 'bj-smash' ? 'Pan brioche' : 'Pan de hamburguesa');
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
      existing.multiplicity = (existing.multiplicity ?? 1) + menuMultiplicity(product.id, name);
    } else {
      lines.push({
        ...ingredient,
        kind: 'ingredient',
        suggestedQuantity: knownQuantity(product, name, ingredient.unit),
        multiplicity: menuMultiplicity(product.id, name),
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
      suggestedQuantity:
        modifier.id === 'extra-papas-150' || modifier.id === 'extra-carne'
          ? 150
          : ingredient.unit === 'pz'
            ? 1
            : undefined,
      extra: true,
    });
  }
  return { lines, extras, missingNames };
}

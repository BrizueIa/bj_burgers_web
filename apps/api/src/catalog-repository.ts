import { asc, desc } from 'drizzle-orm';
import { catalogSchema, seedCatalog, type Catalog } from '@bj/contracts';
import type { Database } from './db/client.js';
import { businessSettings, categories, modifiers, products, promotions } from './db/schema.js';
import { stableVersion } from './security.js';

export async function loadCatalog(database: Database): Promise<Catalog> {
  const [categoryRows, productRows, modifierRows, promotionRows, settingsRows] = await Promise.all([
    database.db.select().from(categories).orderBy(asc(categories.sortOrder)),
    database.db.select().from(products).orderBy(asc(products.sortOrder)),
    database.db.select().from(modifiers).orderBy(asc(modifiers.name)),
    database.db.select().from(promotions).orderBy(desc(promotions.priority)),
    database.db.select().from(businessSettings).limit(1),
  ]);
  if (!categoryRows.length || !settingsRows[0]) return seedCatalog;
  const raw = {
    version: '',
    categories: categoryRows.map((row) => ({
      id: row.id,
      slug: row.slug,
      name: row.name,
      description: row.description,
      order: row.sortOrder,
      active: row.active,
    })),
    products: productRows.map((row) => ({
      id: row.id,
      slug: row.slug,
      categoryId: row.categoryId,
      name: row.name,
      description: row.description,
      priceCents: row.priceCents,
      ingredients: row.ingredients,
      removableIngredients: row.removableIngredients,
      comboEligible: row.comboEligible,
      featured: row.featured,
      available: row.available,
      order: row.sortOrder,
    })),
    modifiers: modifierRows.map((row) => ({
      id: row.id,
      name: row.name,
      priceCents: row.priceCents,
      available: row.available,
    })),
    promotions: promotionRows.map((row) => ({
      id: row.id,
      name: row.name,
      shortDescription: row.shortDescription,
      daysOfWeek: row.daysOfWeek,
      startsAt: row.startsAt?.toISOString() ?? null,
      endsAt: row.endsAt?.toISOString() ?? null,
      priority: row.priority,
      active: row.active,
      rule: row.rule,
    })),
    business: { ...settingsRows[0].data, updatedAt: settingsRows[0].updatedAt.toISOString() },
  };
  raw.version = stableVersion(raw);
  return catalogSchema.parse(raw);
}

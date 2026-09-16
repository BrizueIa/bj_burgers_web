import { hash } from '@node-rs/argon2';
import { seedCatalog } from '@bj/contracts';
import { createDatabase } from '../src/db/client.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL es obligatoria.');
const database = createDatabase(databaseUrl);

const defaultPrizes = [
  {
    id: 'no-premio',
    label: 'Sigue participando',
    emoji: '⭐',
    weight: 35,
    inventory: null,
    targetSegments: [1, 4, 8, 11],
  },
  {
    id: 'descuento-10',
    label: '10% de descuento',
    emoji: '🏷️',
    weight: 18,
    inventory: null,
    targetSegments: [0, 6],
  },
  {
    id: 'descuento-15',
    label: '15% de descuento',
    emoji: '🏷️',
    weight: 10,
    inventory: null,
    targetSegments: [2],
  },
  {
    id: 'bebida-mitad',
    label: 'Bebida a mitad de precio',
    emoji: '🥤',
    weight: 10,
    inventory: null,
    targetSegments: [10],
  },
  {
    id: 'extra-gratis',
    label: 'Extra gratis',
    emoji: '🎁',
    weight: 10,
    inventory: null,
    targetSegments: [3],
  },
  {
    id: 'papas-100-gratis',
    label: 'Papas de 100 g gratis',
    emoji: '🍟',
    weight: 5,
    inventory: null,
    targetSegments: [5],
  },
  {
    id: 'orden-papas-mitad',
    label: 'Orden de papas a mitad de precio',
    emoji: '🍟',
    weight: 4,
    inventory: null,
    targetSegments: [5],
  },
  {
    id: 'orden-papas-gratis',
    label: 'Orden de papas gratis',
    emoji: '🍟',
    weight: 3,
    inventory: null,
    targetSegments: [5],
  },
  {
    id: 'descuento-20',
    label: '20% de descuento',
    emoji: '🎉',
    weight: 3,
    inventory: null,
    targetSegments: [9],
  },
  {
    id: 'dog-clasico-gratis',
    label: 'Dog Clásico gratis',
    emoji: '🌭',
    weight: 1,
    inventory: null,
    targetSegments: [7],
  },
  {
    id: 'clasica-gratis',
    label: 'Hamburguesa Clásica gratis',
    emoji: '🍔',
    weight: 1,
    inventory: null,
    targetSegments: [7],
  },
];

async function seed() {
  await database.sql.begin(async (tx) => {
    for (const category of seedCatalog.categories) {
      await tx`insert into categories (id, slug, name, description, sort_order, active)
        values (${category.id}, ${category.slug}, ${category.name}, ${category.description}, ${category.order}, ${category.active})
        on conflict (id) do nothing`;
    }
    await tx`insert into modifier_groups (id, name, minimum_selections, maximum_selections, active)
      values ('extras', 'Extras', 0, null, true)
      on conflict (id) do nothing`;
    for (const product of seedCatalog.products) {
      await tx`insert into products (id, slug, category_id, name, description, price_cents, ingredients, removable_ingredients, combo_eligible, featured, available, sort_order)
        values (${product.id}, ${product.slug}, ${product.categoryId}, ${product.name}, ${product.description}, ${product.priceCents}, ${tx.json(product.ingredients)}, ${tx.json(product.removableIngredients)}, ${product.comboEligible}, ${product.featured}, ${product.available}, ${product.order})
        on conflict (id) do nothing`;
    }
    for (const modifier of seedCatalog.modifiers) {
      await tx`insert into modifiers (id, group_id, name, price_cents, available) values (${modifier.id}, 'extras', ${modifier.name}, ${modifier.priceCents}, ${modifier.available})
        on conflict (id) do nothing`;
    }
    for (const promotion of seedCatalog.promotions) {
      await tx`insert into promotions (id, name, short_description, days_of_week, starts_at, ends_at, priority, active, rule)
        values (${promotion.id}, ${promotion.name}, ${promotion.shortDescription}, ${tx.json(promotion.daysOfWeek)}, ${promotion.startsAt}, ${promotion.endsAt}, ${promotion.priority}, ${promotion.active}, ${tx.json(promotion.rule)})
        on conflict (id) do nothing`;
    }
    await tx`insert into business_settings (id, data) values ('primary', ${tx.json(seedCatalog.business)})
      on conflict (id) do nothing`;
    for (const prize of defaultPrizes) {
      await tx`insert into prizes (id, label, emoji, weight, inventory, target_segments)
        values (${prize.id}, ${prize.label}, ${prize.emoji}, ${prize.weight}, ${prize.inventory}, ${tx.json(prize.targetSegments)})
        on conflict (id) do nothing`;
    }
  });

  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  const passwordHash =
    process.env.ADMIN_PASSWORD_HASH ||
    (password ? await hash(password, { memoryCost: 65_536, timeCost: 3, parallelism: 1 }) : '');
  if (email && passwordHash) {
    await database.sql`insert into admin_users (email, password_hash) values (${email}, ${passwordHash})
      on conflict (email) do nothing`;
    console.log(`Administrador configurado: ${email}`);
  } else {
    console.log(
      'Catálogo sembrado. Define ADMIN_EMAIL y ADMIN_PASSWORD o ADMIN_PASSWORD_HASH para crear el acceso inicial.',
    );
  }
  await database.sql.end();
}

seed().catch(async (error) => {
  console.error(error);
  await database.sql.end();
  process.exitCode = 1;
});

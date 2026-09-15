import {
  boolean,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const categories = pgTable('categories', {
  id: text('id').primaryKey(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  sortOrder: integer('sort_order').notNull().default(0),
  active: boolean('active').notNull().default(true),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const products = pgTable('products', {
  id: text('id').primaryKey(),
  slug: text('slug').notNull().unique(),
  categoryId: text('category_id')
    .notNull()
    .references(() => categories.id),
  name: text('name').notNull(),
  description: text('description').notNull(),
  priceCents: integer('price_cents').notNull(),
  ingredients: jsonb('ingredients').$type<string[]>().notNull().default([]),
  removableIngredients: jsonb('removable_ingredients').$type<string[]>().notNull().default([]),
  comboEligible: boolean('combo_eligible').notNull().default(false),
  featured: boolean('featured').notNull().default(false),
  available: boolean('available').notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const modifierGroups = pgTable('modifier_groups', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  minimumSelections: integer('minimum_selections').notNull().default(0),
  maximumSelections: integer('maximum_selections'),
  active: boolean('active').notNull().default(true),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const modifiers = pgTable('modifiers', {
  id: text('id').primaryKey(),
  groupId: text('group_id').references(() => modifierGroups.id),
  name: text('name').notNull(),
  priceCents: integer('price_cents').notNull(),
  available: boolean('available').notNull().default(true),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const promotions = pgTable('promotions', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  shortDescription: text('short_description').notNull(),
  daysOfWeek: jsonb('days_of_week').$type<number[]>().notNull(),
  startsAt: timestamp('starts_at', { withTimezone: true }),
  endsAt: timestamp('ends_at', { withTimezone: true }),
  priority: integer('priority').notNull().default(0),
  active: boolean('active').notNull().default(true),
  rule: jsonb('rule').$type<Record<string, unknown>>().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const businessSettings = pgTable('business_settings', {
  id: text('id').primaryKey().default('primary'),
  data: jsonb('data').$type<Record<string, unknown>>().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const prizes = pgTable('prizes', {
  id: text('id').primaryKey(),
  label: text('label').notNull(),
  emoji: text('emoji').notNull(),
  weight: integer('weight').notNull(),
  active: boolean('active').notNull().default(true),
  inventory: integer('inventory'),
  targetSegments: jsonb('target_segments').$type<number[]>().notNull().default([]),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const spinCodes = pgTable(
  'spin_codes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    codeDigest: text('code_digest').notNull(),
    codeHint: text('code_hint').notNull(),
    remainingSpins: integer('remaining_spins').notNull().default(1),
    active: boolean('active').notNull().default(true),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('spin_codes_digest_unique').on(table.codeDigest)],
);

export const spinRedemptions = pgTable(
  'spin_redemptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    idempotencyKey: uuid('idempotency_key').notNull(),
    codeId: uuid('code_id')
      .notNull()
      .references(() => spinCodes.id),
    prizeId: text('prize_id')
      .notNull()
      .references(() => prizes.id),
    prizeLabel: text('prize_label').notNull(),
    targetSegment: integer('target_segment').notNull(),
    remainingSpins: integer('remaining_spins').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('spin_redemptions_idempotency_unique').on(table.idempotencyKey)],
);

export const demoSpinResults = pgTable('demo_spin_results', {
  id: uuid('id').primaryKey().defaultRandom(),
  prizeId: text('prize_id')
    .notNull()
    .references(() => prizes.id),
  prizeLabel: text('prize_label').notNull(),
  targetSegment: integer('target_segment').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const adminUsers = pgTable('admin_users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const adminSessions = pgTable('admin_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  tokenDigest: text('token_digest').notNull().unique(),
  userId: uuid('user_id')
    .notNull()
    .references(() => adminUsers.id, { onDelete: 'cascade' }),
  csrfToken: text('csrf_token').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const auditLogs = pgTable('audit_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => adminUsers.id),
  action: text('action').notNull(),
  entity: text('entity').notNull(),
  entityId: text('entity_id'),
  details: jsonb('details').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

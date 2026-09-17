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
    orderId: uuid('order_id'),
    issuedByDeviceId: uuid('issued_by_device_id'),
    issueIdempotencyKey: uuid('issue_idempotency_key'),
    issuedCodeCiphertext: text('issued_code_ciphertext'),
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

export const mobileDevices = pgTable('mobile_devices', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  tokenDigest: text('token_digest').unique(),
  pairingDigest: text('pairing_digest').unique(),
  pairingExpiresAt: timestamp('pairing_expires_at', { withTimezone: true }),
  pairingUsedAt: timestamp('pairing_used_at', { withTimezone: true }),
  active: boolean('active').notNull().default(true),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const orders = pgTable('orders', {
  id: uuid('id').primaryKey().defaultRandom(),
  source: text('source').notNull().default('manual_whatsapp'),
  status: text('status').notNull().default('new'),
  customerName: text('customer_name').notNull(),
  neighborhood: text('neighborhood').notNull().default(''),
  streetAndNumber: text('street_and_number').notNull().default(''),
  references: text('references').notNull().default(''),
  deliveryNotes: text('delivery_notes').notNull().default(''),
  rawMessage: text('raw_message').notNull().default(''),
  promotionSnapshot: jsonb('promotion_snapshot').$type<Record<string, unknown> | null>(),
  subtotalCents: integer('subtotal_cents').notNull(),
  deliveryCents: integer('delivery_cents').notNull().default(0),
  totalCents: integer('total_cents').notNull(),
  idempotencyKey: uuid('idempotency_key').notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const orderItems = pgTable('order_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  orderId: uuid('order_id')
    .notNull()
    .references(() => orders.id, { onDelete: 'cascade' }),
  productId: text('product_id')
    .notNull()
    .references(() => products.id),
  productName: text('product_name').notNull(),
  unitPriceCents: integer('unit_price_cents').notNull(),
  quantity: integer('quantity').notNull(),
  removedIngredients: jsonb('removed_ingredients').$type<string[]>().notNull().default([]),
  modifiers: jsonb('modifiers').$type<Record<string, unknown>[]>().notNull().default([]),
  combo: jsonb('combo').$type<Record<string, unknown> | null>(),
  note: text('note').notNull().default(''),
  lineTotalCents: integer('line_total_cents').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const orderEvents = pgTable('order_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  orderId: uuid('order_id')
    .notNull()
    .references(() => orders.id, { onDelete: 'cascade' }),
  eventType: text('event_type').notNull(),
  status: text('status'),
  note: text('note').notNull().default(''),
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

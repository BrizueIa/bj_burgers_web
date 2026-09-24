import {
  boolean,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
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
  createdByUserId: uuid('created_by_user_id').references(() => adminUsers.id),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const orders = pgTable('orders', {
  id: uuid('id').primaryKey().defaultRandom(),
  source: text('source').notNull().default('manual_whatsapp'),
  fulfillment: text('fulfillment').notNull().default('delivery'),
  status: text('status').notNull().default('new'),
  customerName: text('customer_name').notNull(),
  neighborhood: text('neighborhood').notNull().default(''),
  streetAndNumber: text('street_and_number').notNull().default(''),
  references: text('delivery_references').notNull().default(''),
  deliveryNotes: text('delivery_notes').notNull().default(''),
  rawMessage: text('raw_message').notNull().default(''),
  promotionSnapshot: jsonb('promotion_snapshot').$type<Record<string, unknown> | null>(),
  subtotalCents: integer('subtotal_cents').notNull(),
  deliveryCents: integer('delivery_cents').notNull().default(0),
  totalCents: integer('total_cents').notNull(),
  idempotencyKey: uuid('idempotency_key').notNull().unique(),
  createdByDeviceId: uuid('created_by_device_id').references(() => mobileDevices.id),
  quotedAt: timestamp('quoted_at', { withTimezone: true }),
  preparingAt: timestamp('preparing_at', { withTimezone: true }),
  deliveredAt: timestamp('delivered_at', { withTimezone: true }),
  cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
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
  compositionSnapshot: jsonb('composition_snapshot')
    .$type<Record<string, unknown>[]>()
    .notNull()
    .default([]),
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
  deviceId: uuid('device_id').references(() => mobileDevices.id),
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

/** Tables introduced by migration 0004_business.sql. They are declared here so
 * Drizzle's typed schema covers every persisted business record. */
export const stockIngredients = pgTable('stock_ingredients', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull().unique(),
  unit: text('unit').notNull(),
  stock: numeric('stock', { precision: 16, scale: 3 }).notNull().default('0'),
  valueCents: numeric('value_cents', { precision: 20, scale: 6 }).notNull().default('0'),
  lastCost: numeric('last_cost', { precision: 20, scale: 6 }),
  minimum: numeric('minimum', { precision: 16, scale: 3 }).notNull().default('0'),
  reserved: numeric('reserved', { precision: 16, scale: 3 }).notNull().default('0'),
  preparationProductId: text('preparation_product_id').references(() => products.id),
});

export const stockReservations = pgTable('stock_reservations', {
  id: uuid('id').primaryKey().defaultRandom(),
  ingredientId: uuid('ingredient_id')
    .notNull()
    .references(() => stockIngredients.id),
  quantity: numeric('quantity', { precision: 16, scale: 3 }).notNull(),
  status: text('status').notNull(),
  referenceType: text('reference_type').notNull().default(''),
  referenceId: text('reference_id').notNull().default(''),
  reason: text('reason').notNull().default(''),
  createdByDeviceId: uuid('created_by_device_id').references(() => mobileDevices.id),
  createdByUserId: uuid('created_by_user_id').references(() => adminUsers.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
});

export const orderStockReservations = pgTable(
  'order_stock_reservations',
  {
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    reservationId: uuid('reservation_id')
      .notNull()
      .references(() => stockReservations.id),
    componentKind: text('component_kind').notNull(),
  },
  (table) => [primaryKey({ columns: [table.orderId, table.reservationId] })],
);

export const orderCostAllocations = pgTable('order_cost_allocations', {
  id: uuid('id').primaryKey().defaultRandom(),
  orderId: uuid('order_id')
    .notNull()
    .references(() => orders.id, { onDelete: 'cascade' }),
  reservationId: uuid('reservation_id')
    .notNull()
    .references(() => stockReservations.id),
  ingredientId: uuid('ingredient_id')
    .notNull()
    .references(() => stockIngredients.id),
  costCents: numeric('cost_cents', { precision: 20, scale: 6 }).notNull(),
  classification: text('classification').notNull().default('pending'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  classifiedAt: timestamp('classified_at', { withTimezone: true }),
});
export const stockLedgerMovements = pgTable('stock_ledger_movements', {
  id: uuid('id').primaryKey().defaultRandom(),
  ingredientId: uuid('ingredient_id')
    .notNull()
    .references(() => stockIngredients.id),
  businessEntryId: uuid('business_entry_id').references(() => businessEntries.id),
  reservationId: uuid('reservation_id').references(() => stockReservations.id),
  movementType: text('movement_type').notNull(),
  quantityDelta: numeric('quantity_delta', { precision: 16, scale: 3 }).notNull(),
  valueDeltaCents: numeric('value_delta_cents', { precision: 20, scale: 6 }).notNull(),
  stockAfter: numeric('stock_after', { precision: 16, scale: 3 }).notNull(),
  valueAfterCents: numeric('value_after_cents', { precision: 20, scale: 6 }).notNull(),
  reason: text('reason').notNull().default(''),
  createdByDeviceId: uuid('created_by_device_id').references(() => mobileDevices.id),
  createdByUserId: uuid('created_by_user_id').references(() => adminUsers.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const suppliers = pgTable('suppliers', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull().unique(),
  contactName: text('contact_name').notNull().default(''),
  contactPhone: text('contact_phone').notNull().default(''),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
export const ingredientPresentations = pgTable('ingredient_presentations', {
  id: uuid('id').primaryKey().defaultRandom(),
  ingredientId: uuid('ingredient_id')
    .notNull()
    .references(() => stockIngredients.id),
  supplierId: uuid('supplier_id').references(() => suppliers.id),
  name: text('name').notNull(),
  baseQuantity: numeric('base_quantity', { precision: 16, scale: 3 }).notNull(),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const productRecipes = pgTable('product_recipes', {
  productId: text('product_id')
    .primaryKey()
    .references(() => products.id),
  targetMargin: integer('target_margin').notNull().default(65),
  overheadCents: integer('overhead_cents').notNull().default(0),
});

export const recipeLines = pgTable(
  'recipe_lines',
  {
    productId: text('product_id')
      .notNull()
      .references(() => productRecipes.productId),
    ingredientId: uuid('ingredient_id')
      .notNull()
      .references(() => stockIngredients.id),
    quantity: numeric('quantity', { precision: 16, scale: 3 }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.productId, table.ingredientId] })],
);

export const recipeVersions = pgTable(
  'recipe_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    productId: text('product_id')
      .notNull()
      .references(() => products.id),
    versionNumber: integer('version_number').notNull(),
    targetMargin: integer('target_margin').notNull(),
    overheadCents: integer('overhead_cents').notNull().default(0),
    status: text('status').notNull(),
    createdByDeviceId: uuid('created_by_device_id').references(() => mobileDevices.id),
    createdByUserId: uuid('created_by_user_id').references(() => adminUsers.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    activatedAt: timestamp('activated_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('recipe_versions_product_version_idx').on(table.productId, table.versionNumber),
  ],
);

export const recipeVersionComponents = pgTable('recipe_version_components', {
  id: uuid('id').primaryKey().defaultRandom(),
  recipeVersionId: uuid('recipe_version_id')
    .notNull()
    .references(() => recipeVersions.id),
  componentKind: text('component_kind').notNull(),
  ingredientId: uuid('ingredient_id').references(() => stockIngredients.id),
  componentProductId: text('component_product_id').references(() => products.id),
  modifierId: text('modifier_id').references(() => modifiers.id),
  quantity: numeric('quantity', { precision: 16, scale: 3 }).notNull(),
  removable: boolean('removable').notNull().default(false),
  extra: boolean('extra').notNull().default(false),
});

export const productionBatches = pgTable('production_batches', {
  id: uuid('id').primaryKey().defaultRandom(),
  productId: text('product_id')
    .notNull()
    .references(() => products.id),
  recipeVersionId: uuid('recipe_version_id')
    .notNull()
    .references(() => recipeVersions.id),
  outputIngredientId: uuid('output_ingredient_id')
    .notNull()
    .references(() => stockIngredients.id),
  idempotencyKey: uuid('idempotency_key').notNull().unique(),
  outputQuantity: numeric('output_quantity', { precision: 16, scale: 3 }).notNull(),
  outputUnit: text('output_unit').notNull(),
  consumedCostCents: numeric('consumed_cost_cents', { precision: 20, scale: 6 }).notNull(),
  createdByDeviceId: uuid('created_by_device_id').references(() => mobileDevices.id),
  createdByUserId: uuid('created_by_user_id').references(() => adminUsers.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const businessEntries = pgTable('business_entries', {
  id: uuid('id').primaryKey().defaultRandom(),
  idempotencyKey: uuid('idempotency_key').notNull().unique(),
  requestPayload: jsonb('request_payload').$type<Record<string, unknown>>().notNull(),
  kind: text('kind').notNull(),
  description: text('description').notNull(),
  payment: text('payment').notNull().default(''),
  totalCents: integer('total_cents').notNull(),
  costCents: integer('cost_cents').notNull().default(0),
  lines: jsonb('lines').$type<Record<string, unknown>[]>().notNull(),
  deviceId: uuid('device_id')
    .notNull()
    .references(() => mobileDevices.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const stockMovements = pgTable('stock_movements', {
  id: uuid('id').primaryKey().defaultRandom(),
  entryId: uuid('entry_id')
    .notNull()
    .references(() => businessEntries.id),
  ingredientId: uuid('ingredient_id')
    .notNull()
    .references(() => stockIngredients.id),
  quantity: numeric('quantity', { precision: 16, scale: 3 }).notNull(),
  valueCents: numeric('value_cents', { precision: 20, scale: 6 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const cashSessions = pgTable('cash_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  status: text('status').notNull(),
  openingFundCents: integer('opening_fund_cents').notNull(),
  expectedCents: integer('expected_cents').notNull(),
  countedCents: integer('counted_cents'),
  differenceCents: integer('difference_cents'),
  openedByDeviceId: uuid('opened_by_device_id').references(() => mobileDevices.id),
  openedByUserId: uuid('opened_by_user_id').references(() => adminUsers.id),
  openedAt: timestamp('opened_at', { withTimezone: true }).notNull().defaultNow(),
  closedAt: timestamp('closed_at', { withTimezone: true }),
});
export const cashMovements = pgTable('cash_movements', {
  id: uuid('id').primaryKey().defaultRandom(),
  cashSessionId: uuid('cash_session_id')
    .notNull()
    .references(() => cashSessions.id),
  idempotencyKey: uuid('idempotency_key').notNull().unique(),
  kind: text('kind').notNull(),
  amountCents: integer('amount_cents').notNull(),
  reason: text('reason').notNull(),
  createdByDeviceId: uuid('created_by_device_id').references(() => mobileDevices.id),
  createdByUserId: uuid('created_by_user_id').references(() => adminUsers.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const orderPayments = pgTable('order_payments', {
  id: uuid('id').primaryKey().defaultRandom(),
  orderId: uuid('order_id')
    .notNull()
    .references(() => orders.id),
  cashSessionId: uuid('cash_session_id').references(() => cashSessions.id),
  idempotencyKey: uuid('idempotency_key').notNull().unique(),
  method: text('method').notNull(),
  receivedCents: integer('received_cents').notNull(),
  appliedCents: integer('applied_cents').notNull(),
  changeCents: integer('change_cents').notNull(),
  createdByDeviceId: uuid('created_by_device_id').references(() => mobileDevices.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const orderRefunds = pgTable('order_refunds', {
  id: uuid('id').primaryKey().defaultRandom(),
  orderId: uuid('order_id')
    .notNull()
    .references(() => orders.id),
  paymentId: uuid('payment_id')
    .notNull()
    .references(() => orderPayments.id),
  cashSessionId: uuid('cash_session_id').references(() => cashSessions.id),
  idempotencyKey: uuid('idempotency_key').notNull().unique(),
  method: text('method').notNull(),
  amountCents: integer('amount_cents').notNull(),
  reason: text('reason').notNull(),
  createdByDeviceId: uuid('created_by_device_id').references(() => mobileDevices.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const orderTickets = pgTable(
  'order_tickets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id),
    idempotencyKey: uuid('idempotency_key').notNull().unique(),
    orderSnapshot: jsonb('order_snapshot').$type<Record<string, unknown>>().notNull(),
    paymentSnapshot: jsonb('payment_snapshot').$type<Record<string, unknown>[]>().notNull(),
    issuedByDeviceId: uuid('issued_by_device_id').references(() => mobileDevices.id),
    issuedByUserId: uuid('issued_by_user_id').references(() => adminUsers.id),
    issuedAt: timestamp('issued_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('order_tickets_order_idx').on(table.orderId)],
);

export const posCapabilities = pgTable('pos_capabilities', {
  capability: text('capability').primaryKey(),
  enabled: boolean('enabled').notNull().default(false),
  updatedByUserId: uuid('updated_by_user_id').references(() => adminUsers.id),
  activationNote: text('activation_note').notNull().default(''),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const idempotencyOperations = pgTable('idempotency_operations', {
  id: uuid('id').primaryKey().defaultRandom(),
  idempotencyKey: uuid('idempotency_key').notNull().unique(),
  operation: text('operation').notNull(),
  requestFingerprint: text('request_fingerprint').notNull(),
  responseStatus: integer('response_status').notNull(),
  responseBody: jsonb('response_body').$type<Record<string, unknown>>().notNull(),
  actorKind: text('actor_kind').notNull(),
  adminUserId: uuid('admin_user_id').references(() => adminUsers.id),
  deviceId: uuid('device_id').references(() => mobileDevices.id),
  origin: text('origin').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const operationAuditLogs = pgTable('operation_audit_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  actorKind: text('actor_kind').notNull(),
  adminUserId: uuid('admin_user_id').references(() => adminUsers.id),
  deviceId: uuid('device_id').references(() => mobileDevices.id),
  origin: text('origin').notNull(),
  action: text('action').notNull(),
  entity: text('entity').notNull(),
  entityId: text('entity_id'),
  reason: text('reason').notNull().default(''),
  idempotencyKey: uuid('idempotency_key'),
  details: jsonb('details').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

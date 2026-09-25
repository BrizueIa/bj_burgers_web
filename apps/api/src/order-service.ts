import { randomBytes } from 'node:crypto';
import type {
  Catalog,
  AuthenticatedActor,
  Order,
  OrderCreateRequest,
  OrderItemInput,
  OrderStatus,
  UnifiedOrderConfirm,
} from '@bj/contracts';
import { calculateCart, COMBO_PRICE_CENTS } from '@bj/contracts';
import type { Sql } from 'postgres';
import { decryptSecret, digestCode, encryptSecret } from './security.js';
import { appendMovement } from './stock-ledger-service.js';
import { auditOperation, runIdempotent } from './pos-foundation-service.js';

export class OrderError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

export interface OrderNotifier {
  publish(orderId: string): void;
}

export class InMemoryOrderNotifier implements OrderNotifier {
  private listeners = new Set<(orderId: string) => void>();

  subscribe(listener: (orderId: string) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  publish(orderId: string) {
    for (const listener of this.listeners) listener(orderId);
  }
}

type ProductRow = {
  id: string;
  name: string;
  price_cents: number;
  removable_ingredients: string[];
  combo_eligible: boolean;
  available: boolean;
};
type ModifierRow = { id: string; name: string; price_cents: number; available: boolean };

function normalizeText(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function productForName(catalog: Catalog, name: string) {
  const normalized = normalizeText(name)
    .replace(/^burger\s+/, '')
    .replace(/^hamburguesa\s+/, '');
  return catalog.products.find((product) => {
    const candidate = normalizeText(product.name);
    return candidate === normalized || candidate.replace(/^burger\s+/, '') === normalized;
  });
}

function extractValue(lines: string[], labels: string[]) {
  const matcher = new RegExp(`^(?:${labels.join('|')})\\s*:\\s*(.*)$`, 'i');
  return lines.map((line) => line.match(matcher)?.[1]?.trim()).find(Boolean) ?? '';
}

/** Parses the exact public WhatsApp format and leaves uncertain lines visible
 * for an operator to correct before the order is created. */
export function parseWhatsAppOrder(rawMessage: string, catalog: Catalog) {
  const lines = rawMessage
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const items: Array<OrderItemInput & { productName: string }> = [];
  const unresolved: string[] = [];
  let current: (OrderItemInput & { productName: string }) | null = null;
  const fieldPrefix =
    /^(nombre|colonia|direcci[oó]n|referencias|indicaciones|subtotal|env[ií]o|promo aplicada|incluye)\s*:/i;

  for (const line of lines) {
    if (fieldPrefix.test(line) || /^(hola|quiero hacer)/i.test(line)) continue;
    const productLine = line.match(/^(?:\d+\.\s*)?(\d+)\s*[×x]\s*(.+)$/i);
    if (productLine) {
      const quantity = Number(productLine[1]);
      const text = productLine[2]!.split(/[—–]/)[0]!.replace(/\$.*$/, '').trim();
      const product = productForName(catalog, text);
      if (!product) {
        unresolved.push(line);
        current = null;
        continue;
      }
      current = {
        productId: product.id,
        productName: product.name,
        quantity: Number.isInteger(quantity) && quantity > 0 ? quantity : 1,
        removedIngredients: [],
        modifierIds: [],
        combo: false,
        note: '',
      };
      items.push(current);
      continue;
    }
    if (!current) continue;
    if (/^sin\s*:/i.test(line)) {
      const product = catalog.products.find((candidate) => candidate.id === current!.productId);
      const requested = line
        .replace(/^sin\s*:/i, '')
        .split(',')
        .map((item) => normalizeText(item));
      current.removedIngredients = (product?.removableIngredients ?? []).filter((ingredient) =>
        requested.includes(normalizeText(ingredient)),
      );
    } else if (/^extras\s*:/i.test(line)) {
      const requested = line
        .replace(/^extras\s*:/i, '')
        .split(',')
        .map((item) => normalizeText(item));
      current.modifierIds = catalog.modifiers
        .filter((modifier) => requested.includes(normalizeText(modifier.name)))
        .map((modifier) => modifier.id);
    } else if (/^combo\b/i.test(line)) {
      current.combo = true;
      const drink = productForName(catalog, line.split(/[·—–]/).at(-1) ?? '');
      if (drink) current.drinkProductId = drink.id;
    } else if (/^nota\s*:/i.test(line)) {
      current.note = line.replace(/^nota\s*:/i, '').trim();
    }
  }

  return {
    rawMessage,
    customerName: extractValue(lines, ['nombre']),
    neighborhood: extractValue(lines, ['colonia']),
    streetAndNumber: extractValue(lines, ['direcci[oó]n']),
    references: extractValue(lines, ['referencias']),
    deliveryNotes: extractValue(lines, ['indicaciones']),
    items,
    unresolvedLines: unresolved,
  };
}

const asIso = (value: unknown) =>
  value instanceof Date ? value.toISOString() : ((value as string | null) ?? null);

function mapOrder(
  row: Record<string, unknown>,
  items: Record<string, unknown>[],
  events: Record<string, unknown>[],
  payments: Record<string, unknown>[],
) {
  return {
    id: row.id,
    source: row.source,
    fulfillment: row.fulfillment,
    status: row.status,
    customerName: row.customer_name,
    neighborhood: row.neighborhood,
    streetAndNumber: row.street_and_number,
    references: row.delivery_references,
    deliveryNotes: row.delivery_notes,
    rawMessage: row.raw_message,
    promotion: row.promotion_snapshot,
    subtotalCents: row.subtotal_cents,
    deliveryCents: row.delivery_cents,
    totalCents: row.total_cents,
    manualDiscountCents: row.manual_discount_cents ?? 0,
    manualDiscountReason: row.manual_discount_reason ?? '',
    paidCents: row.paid_cents,
    refundedCents: row.refunded_cents,
    balanceCents: ['delivered', 'cancelled'].includes(String(row.status))
      ? 0
      : Math.max(0, Number(row.total_cents) - Number(row.paid_cents) + Number(row.refunded_cents)),
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
    quotedAt: asIso(row.quoted_at),
    preparingAt: asIso(row.preparing_at),
    deliveredAt: asIso(row.delivered_at),
    cancelledAt: asIso(row.cancelled_at),
    spinCodeIssued: Boolean(row.spin_code_id),
    payments: payments.map((payment) => ({
      id: payment.id,
      method: payment.method,
      receivedCents: payment.received_cents,
      appliedCents: payment.applied_cents,
      changeCents: payment.change_cents,
      refundedCents: payment.refunded_cents,
      refundableCents: Math.max(0, Number(payment.applied_cents) - Number(payment.refunded_cents)),
    })),
    items: items.map((item) => ({
      id: item.id,
      productId: item.product_id,
      productName: item.product_name,
      unitPriceCents: item.unit_price_cents,
      quantity: item.quantity,
      removedIngredients: item.removed_ingredients,
      modifiers: item.modifiers,
      combo: item.combo,
      note: item.note,
      lineTotalCents: item.line_total_cents,
    })),
    events: events.map((event) => ({
      id: event.id,
      type: event.event_type,
      status: event.status,
      note: event.note,
      createdAt:
        event.created_at instanceof Date ? event.created_at.toISOString() : event.created_at,
    })),
  };
}

export async function getOrder(sql: Sql, id: string) {
  const rows = await sql<Record<string, unknown>[]>`
    select o.*, sc.id as spin_code_id, coalesce((select sum(applied_cents) from order_payments where order_id=o.id),0)::int as paid_cents, coalesce((select sum(amount_cents) from order_refunds where order_id=o.id),0)::int as refunded_cents from orders o left join spin_codes sc on sc.order_id=o.id where o.id=${id} limit 1`;
  const row = rows[0];
  if (!row) return null;
  const [items, events, payments] = await Promise.all([
    sql<
      Record<string, unknown>[]
    >`select * from order_items where order_id=${id} order by created_at, id`,
    sql<
      Record<string, unknown>[]
    >`select * from order_events where order_id=${id} order by created_at, id`,
    sql<
      Record<string, unknown>[]
    >`select p.id,p.method,p.received_cents,p.applied_cents,p.change_cents,coalesce(sum(r.amount_cents),0)::int as refunded_cents from order_payments p left join order_refunds r on r.payment_id=p.id where p.order_id=${id} group by p.id order by p.created_at,p.id`,
  ]);
  return mapOrder(row, items, events, payments);
}

export async function listOrders(sql: Sql, status?: OrderStatus) {
  const rows = status
    ? await sql<Record<string, unknown>[]>`
        select o.*, sc.id as spin_code_id,
          coalesce((select sum(applied_cents) from order_payments where order_id=o.id),0)::int as paid_cents,
          coalesce((select sum(amount_cents) from order_refunds where order_id=o.id),0)::int as refunded_cents
        from orders o left join spin_codes sc on sc.order_id=o.id
        where o.status=${status} order by o.created_at desc limit 250`
    : await sql<Record<string, unknown>[]>`
        select o.*, sc.id as spin_code_id,
          coalesce((select sum(applied_cents) from order_payments where order_id=o.id),0)::int as paid_cents,
          coalesce((select sum(amount_cents) from order_refunds where order_id=o.id),0)::int as refunded_cents
        from orders o left join spin_codes sc on sc.order_id=o.id
        order by o.created_at desc limit 250`;
  const ids = rows.map((row) => row.id as string);
  if (!ids.length) return [];
  const [items, events, payments] = await Promise.all([
    sql<
      Record<string, unknown>[]
    >`select * from order_items where order_id = any(${ids}) order by created_at, id`,
    sql<
      Record<string, unknown>[]
    >`select * from order_events where order_id = any(${ids}) order by created_at, id`,
    sql<
      Record<string, unknown>[]
    >`select p.id,p.order_id,p.method,p.received_cents,p.applied_cents,p.change_cents,coalesce(sum(r.amount_cents),0)::int as refunded_cents from order_payments p left join order_refunds r on r.payment_id=p.id where p.order_id = any(${ids}) group by p.id order by p.created_at,p.id`,
  ]);
  return rows.map((row) =>
    mapOrder(
      row,
      items.filter((item) => item.order_id === row.id),
      events.filter((event) => event.order_id === row.id),
      payments.filter((payment) => payment.order_id === row.id),
    ),
  );
}

async function validateItems(sql: Sql, input: OrderItemInput[]) {
  const ids = [
    ...new Set(
      input.flatMap((item) => [
        item.productId,
        ...(item.drinkProductId ? [item.drinkProductId] : []),
      ]),
    ),
  ];
  const modifierIds = [...new Set(input.flatMap((item) => item.modifierIds))];
  const [products, modifiers] = await Promise.all([
    sql<
      ProductRow[]
    >`select id, name, price_cents, removable_ingredients, combo_eligible, available from products where id = any(${ids}) for share`,
    modifierIds.length
      ? sql<
          ModifierRow[]
        >`select id, name, price_cents, available from modifiers where id = any(${modifierIds}) for share`
      : Promise.resolve([]),
  ]);
  const productMap = new Map(products.map((product) => [product.id, product]));
  const modifierMap = new Map(modifiers.map((modifier) => [modifier.id, modifier]));
  for (const item of input) {
    const product = productMap.get(item.productId);
    if (!product || !product.available)
      throw new OrderError(409, 'Un producto ya no está disponible.');
    if (
      item.removedIngredients.some(
        (ingredient) => !product.removable_ingredients.includes(ingredient),
      )
    )
      throw new OrderError(400, `Hay ingredientes no removibles en ${product.name}.`);
    if (item.modifierIds.some((id) => !modifierMap.get(id)?.available))
      throw new OrderError(409, 'Un extra ya no está disponible.');
    if (item.combo && !product.combo_eligible)
      throw new OrderError(400, `${product.name} no puede convertirse en combo.`);
    if (item.combo) {
      const drink = item.drinkProductId ? productMap.get(item.drinkProductId) : undefined;
      if (!drink || !drink.available)
        throw new OrderError(400, 'Selecciona un refresco disponible para el combo.');
    }
  }
  return { productMap, modifierMap };
}

type OrderCreationOptions = {
  fulfillment?: 'counter' | 'pickup' | 'delivery';
  reserveInventory?: boolean;
  source?: 'manual_whatsapp' | 'pos';
  quotedAt?: boolean;
  manualDiscountCents?: number;
  manualDiscountReason?: string;
};
type Requirement = {
  ingredientId: string;
  quantity: string;
  componentKind: 'ingredient' | 'prepared';
};
type ItemComposition = Record<string, unknown>[];

const qtyScale = 1000n;
function quantityToScaled(value: string) {
  const [whole = '0', fraction = ''] = value.split('.');
  return BigInt(whole) * qtyScale + BigInt((fraction + '000').slice(0, 3));
}
function scaledToQuantity(value: bigint) {
  return `${value / qtyScale}.${(value % qtyScale).toString().padStart(3, '0')}`;
}
function multiplyQuantity(value: string, multiplier: bigint) {
  return scaledToQuantity((quantityToScaled(value) * multiplier) / qtyScale);
}
function allocateLineTotals(totalCents: number, weights: number[]) {
  const weightTotal = weights.reduce((sum, weight) => sum + weight, 0);
  if (weightTotal <= 0) return weights.map(() => 0);
  const denominator = BigInt(weightTotal);
  const shares = weights.map((weight, index) => {
    const numerator = BigInt(totalCents) * BigInt(weight);
    return { index, cents: Number(numerator / denominator), remainder: numerator % denominator };
  });
  let remaining = totalCents - shares.reduce((sum, share) => sum + share.cents, 0);
  for (const share of [...shares].sort(
    (left, right) =>
      (left.remainder === right.remainder ? 0 : left.remainder > right.remainder ? -1 : 1) ||
      left.index - right.index,
  )) {
    if (remaining-- <= 0) break;
    shares[share.index]!.cents += 1;
  }
  return shares.sort((left, right) => left.index - right.index).map((share) => share.cents);
}

async function resolveInventoryRequirements(
  tx: Sql,
  items: OrderItemInput[],
): Promise<{ requirements: Requirement[]; compositions: ItemComposition[] }> {
  const requirements = new Map<
    string,
    { quantity: bigint; componentKind: 'ingredient' | 'prepared' }
  >();
  const compositions: ItemComposition[] = [];
  const add = (
    ingredientId: string,
    quantity: string,
    componentKind: 'ingredient' | 'prepared',
  ) => {
    const existing = requirements.get(ingredientId);
    requirements.set(ingredientId, {
      quantity: (existing?.quantity ?? 0n) + quantityToScaled(quantity),
      componentKind:
        existing?.componentKind === 'prepared' || componentKind === 'prepared'
          ? 'prepared'
          : 'ingredient',
    });
  };
  const activeVersion = async (productId: string) => {
    const rows = await tx<{ id: string }[]>`
      select id from recipe_versions where product_id=${productId} and status='active' limit 1 for share`;
    return rows[0]?.id;
  };
  const expand = async (
    productId: string,
    multiplier: bigint,
    removed: string[],
    modifierIds: string[],
    stack: string[],
    composition: ItemComposition,
  ): Promise<void> => {
    if (stack.includes(productId)) throw new OrderError(409, 'La receta activa contiene un ciclo.');
    const prepared = await tx<{ id: string }[]>`
      select id from stock_ingredients where preparation_product_id=${productId} limit 1 for share`;
    if (prepared[0]) {
      const quantity = scaledToQuantity(multiplier);
      add(prepared[0].id, quantity, 'prepared');
      composition.push({ productId, kind: 'prepared', ingredientId: prepared[0].id, quantity });
      return;
    }
    const versionId = await activeVersion(productId);
    if (!versionId) throw new OrderError(409, 'Falta una receta activa para reservar la comanda.');
    const components = await tx<
      {
        id: string;
        component_kind: 'ingredient' | 'product' | 'packaging' | 'modifier';
        ingredient_id: string | null;
        component_product_id: string | null;
        modifier_id: string | null;
        quantity: string;
        removable: boolean;
        extra: boolean;
        component_name: string;
      }[]
    >`select c.id,c.component_kind,c.ingredient_id,c.component_product_id,c.modifier_id,c.quantity::text,
        c.removable,c.extra,coalesce(i.name,p.name,m.name) as component_name
      from recipe_version_components c
      left join stock_ingredients i on i.id=c.ingredient_id
      left join products p on p.id=c.component_product_id
      left join modifiers m on m.id=c.modifier_id
      where c.recipe_version_id=${versionId} order by c.id`;
    if (!components.length) throw new OrderError(409, 'La receta activa no tiene componentes.');
    const normalizedRemoved = new Set(removed.map(normalizeText));
    for (const component of components) {
      const isSelectedExtra =
        component.extra && component.modifier_id && modifierIds.includes(component.modifier_id);
      if (component.extra && !isSelectedExtra) continue;
      if (component.removable && normalizedRemoved.has(normalizeText(component.component_name))) {
        composition.push({ recipeVersionId: versionId, componentId: component.id, removed: true });
        continue;
      }
      const quantity = multiplyQuantity(component.quantity, multiplier);
      composition.push({
        recipeVersionId: versionId,
        componentId: component.id,
        kind: component.component_kind,
        ingredientId: component.ingredient_id,
        productId: component.component_product_id,
        modifierId: component.modifier_id,
        quantity,
        removable: component.removable,
        extra: component.extra,
      });
      if (component.component_kind === 'ingredient' || component.component_kind === 'packaging')
        add(component.ingredient_id!, quantity, 'ingredient');
      else if (component.component_kind === 'product')
        await expand(
          component.component_product_id!,
          quantityToScaled(quantity),
          [],
          [],
          [...stack, productId],
          composition,
        );
    }
    for (const modifierId of modifierIds) {
      if (!components.some((component) => component.extra && component.modifier_id === modifierId))
        throw new OrderError(409, 'El extra seleccionado no está vinculado a la receta activa.');
    }
  };
  for (const item of items) {
    const composition: ItemComposition = [];
    await expand(
      item.productId,
      BigInt(item.quantity) * qtyScale,
      item.removedIngredients,
      item.modifierIds,
      [],
      composition,
    );
    if (item.combo && item.drinkProductId)
      await expand(item.drinkProductId, BigInt(item.quantity) * qtyScale, [], [], [], composition);
    compositions.push(composition);
  }
  return {
    requirements: [...requirements.entries()].map(([ingredientId, requirement]) => ({
      ingredientId,
      quantity: scaledToQuantity(requirement.quantity),
      componentKind: requirement.componentKind,
    })),
    compositions,
  };
}

async function createOrderInTransaction(
  tx: Sql,
  catalog: Catalog,
  input: OrderCreateRequest,
  actor: AuthenticatedActor,
  options: OrderCreationOptions = {},
) {
  const actorIds =
    actor.kind === 'device'
      ? { deviceId: actor.deviceId, userId: null }
      : { deviceId: null, userId: actor.userId };
  const { productMap, modifierMap } = await validateItems(tx, input.items);
  const totals = calculateCart(
    catalog,
    input.items.map((item, index) => ({
      id: `operator-${index}`,
      productId: item.productId,
      quantity: item.quantity,
      removedIngredients: item.removedIngredients,
      modifierIds: item.modifierIds,
      combo: item.combo,
      ...(item.drinkProductId ? { drinkProductId: item.drinkProductId } : {}),
      note: item.note,
    })),
  );
  const manualDiscountCents = options.manualDiscountCents ?? 0;
  if (manualDiscountCents > totals.totalCents)
    throw new OrderError(
      400,
      'El descuento manual no puede superar el total después de promociones.',
    );
  if (manualDiscountCents > 0 && (options.manualDiscountReason?.trim().length ?? 0) < 3)
    throw new OrderError(400, 'Un descuento manual requiere un motivo de al menos 3 caracteres.');
  const finalSubtotalCents = totals.totalCents - manualDiscountCents;
  const rawLineTotals = input.items.map((item) => {
    const product = productMap.get(item.productId)!;
    const modifiers = item.modifierIds.map((id) => modifierMap.get(id)!);
    return (
      (product.price_cents +
        modifiers.reduce((sum, modifier) => sum + modifier.price_cents, 0) +
        (item.combo ? COMBO_PRICE_CENTS : 0)) *
      item.quantity
    );
  });
  const allocatedLineTotals = allocateLineTotals(finalSubtotalCents, rawLineTotals);
  const resolved = options.reserveInventory
    ? await resolveInventoryRequirements(tx, input.items)
    : undefined;
  const inserted = await tx<{ id: string }[]>`
    insert into orders (
      source, customer_name, neighborhood, street_and_number, delivery_references, delivery_notes, raw_message,
      promotion_snapshot, subtotal_cents, delivery_cents, total_cents, manual_discount_cents, manual_discount_reason,
      idempotency_key, created_by_device_id, created_by_user_id, fulfillment, quoted_at
    ) values (
      ${options.source ?? 'manual_whatsapp'}, ${input.customerName}, ${input.neighborhood}, ${input.streetAndNumber}, ${input.references}, ${input.deliveryNotes}, ${input.rawMessage},
      ${totals.promotion ? JSON.stringify(totals.promotion) : null}, ${finalSubtotalCents}, 0, ${finalSubtotalCents}, ${manualDiscountCents}, ${options.manualDiscountReason?.trim() ?? ''},
      ${input.idempotencyKey}, ${actorIds.deviceId}, ${actorIds.userId}, ${options.fulfillment ?? 'delivery'},
      case when ${options.quotedAt ?? false} then now() else null end
    ) returning id`;
  const orderId = inserted[0]?.id;
  if (!orderId) throw new OrderError(500, 'No fue posible crear la comanda.');
  for (const [index, item] of input.items.entries()) {
    const product = productMap.get(item.productId)!;
    const selectedModifiers = item.modifierIds.map((id) => modifierMap.get(id)!);
    const combo = item.combo
      ? {
          drinkProductId: item.drinkProductId,
          drinkName: productMap.get(item.drinkProductId!)!.name,
          priceCents: COMBO_PRICE_CENTS,
        }
      : null;
    const lineTotal = allocatedLineTotals[index]!;
    await tx`
      insert into order_items (order_id, product_id, product_name, unit_price_cents, quantity, removed_ingredients, modifiers, combo, note, line_total_cents, composition_snapshot)
      values (${orderId}, ${product.id}, ${product.name}, ${product.price_cents}, ${item.quantity}, ${JSON.stringify(item.removedIngredients)}, ${JSON.stringify(selectedModifiers.map((modifier) => ({ id: modifier.id, name: modifier.name, priceCents: modifier.price_cents })))}, ${combo ? JSON.stringify(combo) : null}, ${item.note}, ${lineTotal}, ${JSON.stringify(resolved?.compositions[index] ?? [])})`;
  }
  if (resolved) {
    if (!resolved.requirements.length)
      throw new OrderError(409, 'La receta no requiere componentes reservables.');
    for (const need of resolved.requirements.sort((left, right) =>
      left.ingredientId.localeCompare(right.ingredientId),
    )) {
      const [reservation] = await tx<{ id: string }[]>`
        with updated as (
          update stock_ingredients set reserved=reserved+${need.quantity}::numeric
          where id=${need.ingredientId} returning id
        ) insert into stock_reservations(ingredient_id,quantity,status,reference_type,reference_id,reason,created_by_device_id,created_by_user_id)
        select id,${need.quantity}::numeric,'active','unified_order',${orderId},'Reserva de comanda unificada',${actorIds.deviceId},${actorIds.userId} from updated returning id`;
      if (!reservation)
        throw new OrderError(409, 'No hay existencia disponible para confirmar la comanda.');
      await tx`insert into order_stock_reservations(order_id,reservation_id,component_kind) values(${orderId},${reservation.id},${need.componentKind})`;
    }
  }
  await tx`insert into order_events (order_id, event_type, status, note, device_id, created_by_user_id)
    values (${orderId}, 'created', 'new', ${options.source === 'pos' ? 'Comanda creada desde el POS.' : 'Comanda creada desde WhatsApp.'}, ${actorIds.deviceId}, ${actorIds.userId})`;
  return getOrder(tx, orderId);
}

export async function createOrder(
  sql: Sql,
  catalog: Catalog,
  input: OrderCreateRequest,
  deviceId: string,
  notifier: OrderNotifier,
  options?: OrderCreationOptions,
) {
  const order = await sql.begin((tx) =>
    createOrderInTransaction(
      tx as unknown as Sql,
      catalog,
      input,
      { kind: 'device', deviceId, origin: 'android' },
      options,
    ),
  );
  if (!order) throw new OrderError(500, 'No fue posible crear la comanda.');
  notifier.publish(order.id as string);
  return order;
}

export async function createUnifiedOrder(
  sql: Sql,
  catalog: Catalog,
  input: UnifiedOrderConfirm,
  deviceId: string,
  notifier: OrderNotifier,
  actor: AuthenticatedActor = { kind: 'device', deviceId, origin: 'android' },
) {
  const request = {
    fulfillment: input.fulfillment,
    customerName: input.customerName,
    neighborhood: input.neighborhood,
    streetAndNumber: input.streetAndNumber,
    manualDiscountCents: input.manualDiscountCents,
    manualDiscountReason: input.manualDiscountReason,
    quotedTotalCents: input.quotedTotalCents,
    idempotencyKey: input.idempotencyKey,
    source: input.source ?? 'pos',
    rawMessage: input.rawMessage ?? '',
    items: input.items.map((item) => ({
      productId: item.productId,
      quantity: item.quantity,
      removedIngredients: item.removedIngredients,
      modifierIds: item.modifierIds,
      combo: item.combo,
      note: item.note,
      ...(item.drinkProductId ? { drinkProductId: item.drinkProductId } : {}),
    })),
  };
  const outcome = await runIdempotent(
    sql,
    {
      idempotencyKey: input.idempotencyKey,
      operation: 'unified-order.confirm',
      request,
      actor,
      statusCode: 201,
    },
    async (transaction) => {
      const quote = calculateCart(
        catalog,
        input.items.map((item, index) => ({
          id: `confirm-${index}`,
          productId: item.productId,
          quantity: item.quantity,
          removedIngredients: item.removedIngredients,
          modifierIds: item.modifierIds,
          combo: item.combo,
          note: item.note,
          ...(item.drinkProductId ? { drinkProductId: item.drinkProductId } : {}),
        })),
      );
      if (input.manualDiscountCents > quote.totalCents)
        throw new OrderError(
          400,
          'El descuento manual no puede superar el total después de promociones.',
        );
      const confirmedTotal = quote.totalCents - input.manualDiscountCents;
      if (confirmedTotal !== input.quotedTotalCents)
        throw new OrderError(
          409,
          `El total cambió a ${confirmedTotal} centavos. Vuelve a cotizar antes de confirmar.`,
        );
      const order = await createOrderInTransaction(
        transaction,
        catalog,
        {
          ...input,
          customerName:
            input.customerName || (input.fulfillment === 'counter' ? 'Mostrador' : 'Cliente'),
          rawMessage: input.rawMessage ?? '',
          references: '',
          deliveryNotes: '',
        },
        actor,
        {
          fulfillment: input.fulfillment,
          reserveInventory: true,
          source: input.source ?? 'pos',
          quotedAt: true,
          manualDiscountCents: input.manualDiscountCents,
          manualDiscountReason: input.manualDiscountReason,
        },
      );
      if (!order) throw new OrderError(500, 'No fue posible crear la comanda.');
      await auditOperation(transaction, actor, {
        action: 'create',
        entity: 'unified_order',
        entityId: order.id as string,
        idempotencyKey: input.idempotencyKey,
      });
      return order as unknown as Record<string, never>;
    },
  );
  const order = outcome.result as unknown as Order;
  if (!outcome.reused) notifier.publish(order.id);
  return { order, reused: outcome.reused, statusCode: outcome.statusCode };
}
const allowedTransitions: Record<OrderStatus, OrderStatus[]> = {
  new: ['preparing', 'cancelled'],
  preparing: ['ready', 'cancelled'],
  ready: ['out_for_delivery', 'cancelled'],
  out_for_delivery: ['delivered'],
  delivered: [],
  cancelled: [],
};

export async function updateOrderStatusInTransaction(
  tx: Sql,
  orderId: string,
  nextStatus: OrderStatus,
  note: string,
  actorInput: AuthenticatedActor | string,
) {
  const actor: AuthenticatedActor =
    typeof actorInput === 'string'
      ? { kind: 'device', deviceId: actorInput, origin: 'android' }
      : actorInput;
  const actorIds =
    actor.kind === 'device'
      ? { deviceId: actor.deviceId, userId: null }
      : { deviceId: null, userId: actor.userId };
  const rows = await tx<
    { status: OrderStatus; total_cents: number; fulfillment: string }[]
  >`select status,total_cents,fulfillment from orders where id=${orderId} for update`;
  const current = rows[0];
  if (!current) throw new OrderError(404, 'La comanda no existe.');
  const counterHandoff =
    current.status === 'ready' && nextStatus === 'delivered' && current.fulfillment === 'counter';
  if (!allowedTransitions[current.status].includes(nextStatus) && !counterHandoff)
    throw new OrderError(409, 'Ese cambio de estado no está permitido.');
  if (nextStatus === 'delivered') {
    const [payment] =
      await tx`select coalesce((select sum(applied_cents) from order_payments where order_id=${orderId}),0)::int as paid,coalesce((select sum(amount_cents) from order_refunds where order_id=${orderId}),0)::int as refunded`;
    if (payment!.paid - payment!.refunded < current.total_cents)
      throw new OrderError(409, 'La entrega exige pago completo.');
  }
  if (nextStatus === 'cancelled' && current.status === 'new') {
    const reservations = await tx<
      { reservation_id: string; ingredient_id: string; quantity: string }[]
    >`
      select r.id as reservation_id,r.ingredient_id,r.quantity::text from order_stock_reservations x
      join stock_reservations r on r.id=x.reservation_id where x.order_id=${orderId} and r.status='active'
      order by r.ingredient_id for update`;
    for (const reservation of reservations) {
      const released =
        await tx`update stock_ingredients set reserved=reserved-${reservation.quantity}::numeric
        where id=${reservation.ingredient_id} and reserved>=${reservation.quantity}::numeric returning id`;
      if (!released[0]) throw new OrderError(409, 'La reserva ya no coincide con el inventario.');
      await tx`update stock_reservations set status='released',resolved_at=now(),reason=${note || 'Cancelación de comanda'} where id=${reservation.reservation_id}`;
    }
  }
  if (nextStatus === 'preparing') {
    const reservations = await tx<
      { reservation_id: string; ingredient_id: string; quantity: string }[]
    >`
      select r.id as reservation_id,r.ingredient_id,r.quantity::text from order_stock_reservations x
      join stock_reservations r on r.id=x.reservation_id where x.order_id=${orderId} and r.status='active'
      order by r.ingredient_id for update`;
    if (!reservations.length) throw new OrderError(409, 'La comanda no tiene reservas activas.');
    for (const reservation of reservations) {
      const [consumed] = await tx<{ stock: string; value_cents: string; cost: string }[]>`
        with before as (select stock,reserved,value_cents,last_cost from stock_ingredients where id=${reservation.ingredient_id} for update)
        update stock_ingredients i set stock=b.stock-${reservation.quantity}::numeric,
          reserved=b.reserved-${reservation.quantity}::numeric,
          value_cents=case when b.stock<=${reservation.quantity}::numeric then 0 else b.value_cents-(b.value_cents/b.stock)*${reservation.quantity}::numeric end
        from before b where i.id=${reservation.ingredient_id} and b.reserved>=${reservation.quantity}::numeric
          and (b.last_cost is not null or (b.stock>0 and b.stock>=${reservation.quantity}::numeric))
        returning i.stock::text,i.value_cents::text,
          (least(greatest(b.stock,0),${reservation.quantity}::numeric)*case when b.stock>0 then b.value_cents/b.stock else 0 end
            + greatest(0,${reservation.quantity}::numeric-greatest(b.stock,0))*coalesce(b.last_cost,0))::text as cost`;
      if (!consumed)
        throw new OrderError(
          409,
          'No se puede valorar el consumo. Registra una compra o un costo inicial antes de preparar.',
        );
      await tx`update stock_reservations set status='consumed',resolved_at=now() where id=${reservation.reservation_id}`;
      await tx`insert into order_cost_allocations(order_id,reservation_id,ingredient_id,cost_cents)
        values(${orderId},${reservation.reservation_id},${reservation.ingredient_id},${consumed.cost}::numeric)`;
      await appendMovement(tx, {
        ingredientId: reservation.ingredient_id,
        reservationId: reservation.reservation_id,
        type: 'sale',
        quantityDelta: `-${reservation.quantity}`,
        valueDeltaCents: `-${consumed.cost}`,
        stockAfter: consumed.stock,
        valueAfterCents: consumed.value_cents,
        reason: 'Consumo al preparar comanda unificada',
        actor,
      });
    }
  }
  if (nextStatus === 'cancelled' && current.status !== 'new')
    await tx`update order_cost_allocations set classification='waste', classified_at=now()
      where order_id=${orderId} and classification='pending'`;
  if (nextStatus === 'delivered')
    await tx`update order_cost_allocations set classification='sold', classified_at=now()
      where order_id=${orderId} and classification='pending'`;
  await tx`update orders set status=${nextStatus}, updated_at=now(),
    preparing_at=case when ${nextStatus}='preparing' then now() else preparing_at end,
    delivered_at=case when ${nextStatus}='delivered' then now() else delivered_at end,
    cancelled_at=case when ${nextStatus}='cancelled' then now() else cancelled_at end
    where id=${orderId}`;
  await tx`insert into order_events (order_id, event_type, status, note, device_id, created_by_user_id)
    values (${orderId}, 'status_changed', ${nextStatus}, ${note}, ${actorIds.deviceId}, ${actorIds.userId})`;
  return getOrder(tx, orderId);
}

export async function updateOrderStatus(
  sql: Sql,
  orderId: string,
  nextStatus: OrderStatus,
  note: string,
  actorInput: AuthenticatedActor | string,
  notifier: OrderNotifier,
  idempotencyKey?: string,
) {
  const actor: AuthenticatedActor =
    typeof actorInput === 'string'
      ? { kind: 'device', deviceId: actorInput, origin: 'android' }
      : actorInput;
  if (idempotencyKey) {
    const outcome = await runIdempotent(
      sql,
      {
        idempotencyKey,
        operation: 'order.status.update',
        request: { orderId, status: nextStatus, note },
        actor,
      },
      async (transaction) => {
        const order = await updateOrderStatusInTransaction(
          transaction,
          orderId,
          nextStatus,
          note,
          actor,
        );
        if (!order) throw new OrderError(500, 'No fue posible actualizar la comanda.');
        await auditOperation(transaction, actor, {
          action: 'update',
          entity: 'order_status',
          entityId: orderId,
          reason: note,
          idempotencyKey,
        });
        return order as unknown as Record<string, never>;
      },
    );
    const order = outcome.result as unknown as Order;
    if (!outcome.reused) notifier.publish(orderId);
    return order;
  }
  const order = await sql.begin((tx) =>
    updateOrderStatusInTransaction(tx as unknown as Sql, orderId, nextStatus, note, actor),
  );
  if (!order) throw new OrderError(500, 'No fue posible actualizar la comanda.');
  notifier.publish(orderId);
  return order;
}

function createSpinCode() {
  return `BJ-${randomBytes(5).toString('hex').toUpperCase()}`;
}

export async function issueOrderSpinCode(
  sql: Sql,
  orderId: string,
  idempotencyKey: string,
  deviceId: string,
  secret: string,
  notifier: OrderNotifier,
) {
  const result = await sql.begin(async (tx) => {
    const orders = await tx<
      { status: OrderStatus }[]
    >`select status from orders where id=${orderId} for update`;
    if (!orders[0]) throw new OrderError(404, 'La comanda no existe.');
    const existing = await tx<
      {
        id: string;
        issue_idempotency_key: string | null;
        issued_code_ciphertext: string | null;
        expires_at: Date | null;
      }[]
    >`select id, issue_idempotency_key, issued_code_ciphertext, expires_at from spin_codes where order_id=${orderId} for update`;
    if (existing[0]) {
      if (
        existing[0].issue_idempotency_key !== idempotencyKey ||
        !existing[0].issued_code_ciphertext
      )
        throw new OrderError(409, 'Esta comanda ya tiene un código de ruleta emitido.');
      return {
        code: decryptSecret(existing[0].issued_code_ciphertext, secret),
        expiresAt: existing[0].expires_at?.toISOString() ?? null,
        reused: true,
      };
    }
    if (orders[0].status !== 'delivered')
      throw new OrderError(409, 'El código solo puede emitirse cuando la comanda está entregada.');
    const code = createSpinCode();
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await tx`
      insert into spin_codes (code_digest, code_hint, remaining_spins, expires_at, order_id, issued_by_device_id, issue_idempotency_key, issued_code_ciphertext)
      values (${digestCode(code, secret)}, ${code.slice(-4)}, 1, ${expiresAt}, ${orderId}, ${deviceId}, ${idempotencyKey}, ${encryptSecret(code, secret)})`;
    await tx`insert into order_events (order_id, event_type, note, device_id) values (${orderId}, 'spin_code_issued', 'Código de ruleta emitido.', ${deviceId})`;
    return { code, expiresAt: expiresAt.toISOString(), reused: false };
  });
  notifier.publish(orderId);
  return result;
}

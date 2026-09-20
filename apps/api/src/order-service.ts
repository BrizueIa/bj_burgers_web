import { randomBytes } from 'node:crypto';
import type { Catalog, OrderCreateRequest, OrderItemInput, OrderStatus } from '@bj/contracts';
import { calculateCart, COMBO_PRICE_CENTS } from '@bj/contracts';
import type { Sql } from 'postgres';
import { decryptSecret, digestCode, encryptSecret } from './security.js';

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

function mapOrder(
  row: Record<string, unknown>,
  items: Record<string, unknown>[],
  events: Record<string, unknown>[],
) {
  return {
    id: row.id,
    source: row.source,
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
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
    spinCodeIssued: Boolean(row.spin_code_id),
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
    select o.*, sc.id as spin_code_id from orders o left join spin_codes sc on sc.order_id=o.id where o.id=${id} limit 1`;
  const row = rows[0];
  if (!row) return null;
  const [items, events] = await Promise.all([
    sql<
      Record<string, unknown>[]
    >`select * from order_items where order_id=${id} order by created_at, id`,
    sql<
      Record<string, unknown>[]
    >`select * from order_events where order_id=${id} order by created_at, id`,
  ]);
  return mapOrder(row, items, events);
}

export async function listOrders(sql: Sql, status?: OrderStatus) {
  const rows = status
    ? await sql<Record<string, unknown>[]>`
        select o.*, sc.id as spin_code_id from orders o left join spin_codes sc on sc.order_id=o.id
        where o.status=${status} order by o.created_at desc limit 250`
    : await sql<Record<string, unknown>[]>`
        select o.*, sc.id as spin_code_id from orders o left join spin_codes sc on sc.order_id=o.id
        order by o.created_at desc limit 250`;
  const ids = rows.map((row) => row.id as string);
  if (!ids.length) return [];
  const [items, events] = await Promise.all([
    sql<
      Record<string, unknown>[]
    >`select * from order_items where order_id = any(${ids}) order by created_at, id`,
    sql<
      Record<string, unknown>[]
    >`select * from order_events where order_id = any(${ids}) order by created_at, id`,
  ]);
  return rows.map((row) =>
    mapOrder(
      row,
      items.filter((item) => item.order_id === row.id),
      events.filter((event) => event.order_id === row.id),
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

export async function createOrder(
  sql: Sql,
  catalog: Catalog,
  input: OrderCreateRequest,
  deviceId: string,
  notifier: OrderNotifier,
  options?: { fulfillment?: 'counter' | 'pickup' | 'delivery'; reserveInventory?: boolean },
) {
  const order = await sql.begin(async (tx) => {
    const { productMap, modifierMap } = await validateItems(tx as unknown as Sql, input.items);
    const totals = calculateCart(
      catalog,
      input.items.map((item) => ({
        id: `operator-${item.productId}`,
        productId: item.productId,
        quantity: item.quantity,
        removedIngredients: item.removedIngredients,
        modifierIds: item.modifierIds,
        combo: item.combo,
        ...(item.drinkProductId ? { drinkProductId: item.drinkProductId } : {}),
        note: item.note,
      })),
    );
    const inserted = await tx<{ id: string }[]>`
      insert into orders (
        source, customer_name, neighborhood, street_and_number, delivery_references, delivery_notes, raw_message,
        promotion_snapshot, subtotal_cents, delivery_cents, total_cents, idempotency_key, created_by_device_id, fulfillment
      ) values (
        'manual_whatsapp', ${input.customerName}, ${input.neighborhood}, ${input.streetAndNumber}, ${input.references}, ${input.deliveryNotes}, ${input.rawMessage},
        ${totals.promotion ? JSON.stringify(totals.promotion) : null}, ${totals.totalCents}, 0, ${totals.totalCents}, ${input.idempotencyKey}, ${deviceId}, ${options?.fulfillment ?? 'delivery'}
      ) on conflict (idempotency_key) do nothing returning id`;
    if (!inserted[0]) {
      const previous = await tx<{ id: string }[]>`
        select id from orders where idempotency_key=${input.idempotencyKey} limit 1`;
      if (!previous[0]) throw new OrderError(409, 'No se pudo recuperar la comanda creada.');
      return getOrder(tx as unknown as Sql, previous[0].id);
    }
    const orderId = inserted[0].id;
    for (const item of input.items) {
      const product = productMap.get(item.productId)!;
      const selectedModifiers = item.modifierIds.map((id) => modifierMap.get(id)!);
      const combo = item.combo
        ? {
            drinkProductId: item.drinkProductId,
            drinkName: productMap.get(item.drinkProductId!)!.name,
            priceCents: COMBO_PRICE_CENTS,
          }
        : null;
      const lineTotal =
        (product.price_cents +
          selectedModifiers.reduce((sum, modifier) => sum + modifier.price_cents, 0) +
          (item.combo ? COMBO_PRICE_CENTS : 0)) *
        item.quantity;
      await tx`
        insert into order_items (order_id, product_id, product_name, unit_price_cents, quantity, removed_ingredients, modifiers, combo, note, line_total_cents)
        values (${orderId}, ${product.id}, ${product.name}, ${product.price_cents}, ${item.quantity}, ${JSON.stringify(item.removedIngredients)}, ${JSON.stringify(selectedModifiers.map((modifier) => ({ id: modifier.id, name: modifier.name, priceCents: modifier.price_cents })))}, ${combo ? JSON.stringify(combo) : null}, ${item.note}, ${lineTotal})`;
    }
    if (options?.reserveInventory) {
      const needs = await tx<{ ingredient_id: string; quantity: string }[]>`
        select l.ingredient_id, sum(l.quantity * i.quantity)::text as quantity
        from recipe_lines l join jsonb_to_recordset(${JSON.stringify(input.items)}::jsonb) as i(productId text, quantity numeric)
          on i.productId=l.product_id group by l.ingredient_id order by l.ingredient_id`;
      if (!needs.length) throw new OrderError(409, 'Falta la receta para reservar esta comanda.');
      for (const need of needs) {
        const [reservation] = await tx<{ id: string }[]>`
          with updated as (
            update stock_ingredients set reserved=reserved+${need.quantity}::numeric
            where id=${need.ingredient_id} and stock-reserved>=${need.quantity}::numeric returning id
          ) insert into stock_reservations(ingredient_id,quantity,status,reference_type,reference_id,reason,created_by_device_id)
          select id,${need.quantity}::numeric,'active','unified_order',${orderId},'Reserva de comanda unificada',${deviceId} from updated returning id`;
        if (!reservation)
          throw new OrderError(409, 'No hay existencia disponible para confirmar la comanda.');
        await tx`insert into order_stock_reservations(order_id,reservation_id,component_kind) values(${orderId},${reservation.id},'ingredient')`;
      }
    }
    await tx`insert into order_events (order_id, event_type, status, note, device_id) values (${orderId}, 'created', 'new', 'Comanda creada desde WhatsApp.', ${deviceId})`;
    return getOrder(tx as unknown as Sql, orderId);
  });
  if (!order) throw new OrderError(500, 'No fue posible crear la comanda.');
  notifier.publish(order.id as string);
  return order;
}

const allowedTransitions: Record<OrderStatus, OrderStatus[]> = {
  new: ['preparing', 'cancelled'],
  preparing: ['ready', 'cancelled'],
  ready: ['out_for_delivery', 'cancelled'],
  out_for_delivery: ['delivered'],
  delivered: [],
  cancelled: [],
};

export async function updateOrderStatus(
  sql: Sql,
  orderId: string,
  nextStatus: OrderStatus,
  note: string,
  deviceId: string,
  notifier: OrderNotifier,
) {
  const order = await sql.begin(async (tx) => {
    const rows = await tx<
      { status: OrderStatus }[]
    >`select status from orders where id=${orderId} for update`;
    const current = rows[0];
    if (!current) throw new OrderError(404, 'La comanda no existe.');
    if (!allowedTransitions[current.status].includes(nextStatus))
      throw new OrderError(409, 'Ese cambio de estado no está permitido.');
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
    await tx`update orders set status=${nextStatus}, updated_at=now(),
      preparing_at=case when ${nextStatus}='preparing' then now() else preparing_at end,
      delivered_at=case when ${nextStatus}='delivered' then now() else delivered_at end,
      cancelled_at=case when ${nextStatus}='cancelled' then now() else cancelled_at end
      where id=${orderId}`;
    await tx`insert into order_events (order_id, event_type, status, note, device_id) values (${orderId}, 'status_changed', ${nextStatus}, ${note}, ${deviceId})`;
    return getOrder(tx as unknown as Sql, orderId);
  });
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

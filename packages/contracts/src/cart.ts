import type {
  AppliedPromotion,
  CartItem,
  CartTotals,
  Catalog,
  DeliveryDetails,
  Product,
  Promotion,
} from './types.js';

export const COMBO_PRICE_CENTS = 4600;

export function formatMoney(cents: number): string {
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN',
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

function weekdayInTimezone(date: Date, timezone: string): number {
  const label = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: timezone }).format(
    date,
  );
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(label);
}

export function activePromotion(catalog: Catalog, date = new Date()): Promotion | null {
  const weekday = weekdayInTimezone(date, catalog.business.timezone);
  const iso = date.toISOString();
  return (
    [...catalog.promotions]
      .filter(
        (promo) =>
          promo.active &&
          promo.daysOfWeek.includes(weekday) &&
          (!promo.startsAt || promo.startsAt <= iso) &&
          (!promo.endsAt || promo.endsAt >= iso),
      )
      .sort((a, b) => b.priority - a.priority)[0] ?? null
  );
}

function expandedProducts(items: CartItem[], products: Map<string, Product>): Product[] {
  return items.flatMap((item) => {
    const product = products.get(item.productId);
    return product ? Array.from({ length: item.quantity }, () => product) : [];
  });
}

export function calculateCart(catalog: Catalog, items: CartItem[], date = new Date()): CartTotals {
  const products = new Map(catalog.products.map((product) => [product.id, product]));
  const modifiers = new Map(catalog.modifiers.map((modifier) => [modifier.id, modifier]));
  const itemsCents = items.reduce(
    (sum, item) => sum + (products.get(item.productId)?.priceCents ?? 0) * item.quantity,
    0,
  );
  const modifiersCents = items.reduce(
    (sum, item) =>
      sum +
      item.modifierIds.reduce(
        (modifierSum, id) => modifierSum + (modifiers.get(id)?.priceCents ?? 0),
        0,
      ) *
        item.quantity,
    0,
  );
  const combosCents = items.reduce(
    (sum, item) => sum + (item.combo ? COMBO_PRICE_CENTS * item.quantity : 0),
    0,
  );
  const promo = activePromotion(catalog, date);
  const applied = promo ? applyPromotion(promo, expandedProducts(items, products), products) : null;
  const discountCents = applied?.discountCents ?? 0;
  return {
    itemsCents,
    modifiersCents,
    combosCents,
    discountCents,
    totalCents: Math.max(0, itemsCents + modifiersCents + combosCents - discountCents),
    promotion: applied,
  };
}

function applyPromotion(
  promo: Promotion,
  expanded: Product[],
  products: Map<string, Product>,
): AppliedPromotion | null {
  const rule = promo.rule;
  const eligible = expanded.filter((product) =>
    rule.eligibleCategory
      ? product.categoryId === rule.eligibleCategory
      : rule.eligibleProductIds.includes(product.id),
  );
  if (eligible.length < rule.requiredQuantity) return null;
  let discountCents = 0;
  const freeItems: string[] = [];

  if (rule.kind === 'price_override' && rule.unitPriceCents !== undefined) {
    discountCents = eligible.reduce(
      (sum, product) => sum + Math.max(0, product.priceCents - rule.unitPriceCents!),
      0,
    );
  }
  if (rule.kind === 'free_item' && rule.freeItemLabel && rule.freeQuantity) {
    const groups = Math.floor(eligible.length / rule.requiredQuantity);
    freeItems.push(`${groups * rule.freeQuantity} × ${rule.freeItemLabel}`);
  }
  if (rule.kind === 'bundle_fixed' && rule.fixedPriceCents !== undefined) {
    const base = rule.baseProductId ? products.get(rule.baseProductId) : undefined;
    const groups = Math.floor(eligible.length / rule.requiredQuantity);
    const sorted = [...eligible].sort((a, b) => a.priceCents - b.priceCents);
    for (let group = 0; group < groups; group += 1) {
      const selected = sorted.slice(
        group * rule.requiredQuantity,
        (group + 1) * rule.requiredQuantity,
      );
      const regular = selected.reduce((sum, product) => sum + product.priceCents, 0);
      const upgrades =
        base && rule.allowPaidSubstitution
          ? selected.reduce(
              (sum, product) => sum + Math.max(0, product.priceCents - base.priceCents),
              0,
            )
          : 0;
      discountCents += Math.max(0, regular - (rule.fixedPriceCents + upgrades));
    }
    if (rule.freeItemLabel && rule.freeQuantity)
      freeItems.push(`${groups * rule.freeQuantity} × ${rule.freeItemLabel}`);
  }
  return { id: promo.id, name: promo.name, discountCents, freeItems };
}

export function buildWhatsAppMessage(
  catalog: Catalog,
  items: CartItem[],
  delivery: DeliveryDetails,
  date = new Date(),
): string {
  const products = new Map(catalog.products.map((product) => [product.id, product]));
  const modifiers = new Map(catalog.modifiers.map((modifier) => [modifier.id, modifier]));
  const totals = calculateCart(catalog, items, date);
  const lines = items.flatMap((item, index) => {
    const product = products.get(item.productId);
    if (!product) return [];
    const detail = [`${index + 1}. ${item.quantity} × ${product.name}`];
    if (item.removedIngredients.length)
      detail.push(`   Sin: ${item.removedIngredients.join(', ')}`);
    if (item.modifierIds.length)
      detail.push(
        `   Extras: ${item.modifierIds
          .map((id) => modifiers.get(id)?.name)
          .filter(Boolean)
          .join(', ')}`,
      );
    if (item.combo)
      detail.push(
        `   Combo +${formatMoney(COMBO_PRICE_CENTS)} · ${products.get(item.drinkProductId ?? '')?.name ?? 'refresco por confirmar'}`,
      );
    if (item.note.trim()) detail.push(`   Nota: ${item.note.trim()}`);
    return detail;
  });
  return [
    'Hola B&J Burgers 👑',
    'Quiero hacer este pedido:',
    '',
    ...lines,
    '',
    totals.promotion ? `Promo aplicada: ${totals.promotion.name}` : '',
    ...(totals.promotion?.freeItems.map((item) => `Incluye: ${item}`) ?? []),
    `Subtotal: ${formatMoney(totals.totalCents)}`,
    'Envío: por confirmar (gratis en Canarios)',
    '',
    `Nombre: ${delivery.customerName}`,
    `Colonia: ${delivery.neighborhood}`,
    `Dirección: ${delivery.streetAndNumber}`,
    `Referencias: ${delivery.references || 'Sin referencias'}`,
    `Indicaciones: ${delivery.deliveryNotes || 'Sin indicaciones adicionales'}`,
  ]
    .filter((line) => line !== '')
    .join('\n');
}

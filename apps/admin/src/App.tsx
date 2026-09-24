import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  BadgeDollarSign,
  Clock3,
  ClipboardList,
  ChefHat,
  Truck,
  Gift,
  LayoutDashboard,
  LoaderCircle,
  LogOut,
  Save,
  ShieldCheck,
  ReceiptText,
  ShoppingBag,
  Smartphone,
  Tags,
} from 'lucide-react';
import type {
  Catalog,
  BusinessSettings,
  Order,
  OrderTicket,
  PromotionRule,
  StockLedgerState,
} from '@bj/contracts';

type Tab =
  | 'overview'
  | 'menu'
  | 'promotions'
  | 'business'
  | 'inventory'
  | 'recipes'
  | 'purchasing'
  | 'orders'
  | 'pos'
  | 'activation'
  | 'expenses'
  | 'cash'
  | 'reports'
  | 'roulette'
  | 'devices';
type CategoryRow = {
  id: string;
  name: string;
  slug: string;
  description: string;
  sort_order: number;
  active: boolean;
};
type ProductRow = {
  id: string;
  slug: string;
  category_id: string;
  name: string;
  description: string;
  price_cents: number;
  ingredients: string[];
  removable_ingredients: string[];
  combo_eligible: boolean;
  featured: boolean;
  available: boolean;
  sort_order: number;
};
type ModifierRow = { id: string; name: string; price_cents: number; available: boolean };
type PromotionRow = {
  id: string;
  name: string;
  short_description: string;
  days_of_week: number[];
  starts_at: string | null;
  ends_at: string | null;
  priority: number;
  active: boolean;
  rule: PromotionRule;
};
type PrizeRow = {
  id: string;
  label: string;
  emoji: string;
  weight: number;
  active: boolean;
  inventory: number | null;
  target_segments: number[];
};
type RedemptionRow = {
  id: string;
  prize_label: string;
  emoji: string;
  code_hint: string;
  remaining_spins: number;
  created_at: string;
};
type DeviceRow = {
  id: string;
  name: string;
  active: boolean;
  pairing_expires_at: string | null;
  pairing_used_at: string | null;
  last_seen_at: string | null;
  created_at: string;
};
type Dashboard = {
  categories: CategoryRow[];
  products: ProductRow[];
  modifiers: ModifierRow[];
  promotions: PromotionRow[];
  business: { data: BusinessSettings; updated_at: string };
  prizes: PrizeRow[];
  redemptions: RedemptionRow[];
  devices: DeviceRow[];
};

const tabItems: Array<{ id: Tab; label: string; icon: typeof LayoutDashboard }> = [
  { id: 'overview', label: 'Resumen', icon: LayoutDashboard },
  { id: 'menu', label: 'Menú', icon: ShoppingBag },
  { id: 'promotions', label: 'Promociones', icon: Tags },
  { id: 'business', label: 'Negocio', icon: Clock3 },
  { id: 'inventory', label: 'Inventario', icon: ClipboardList },
  { id: 'recipes', label: 'Recetas', icon: ChefHat },
  { id: 'purchasing', label: 'Compras', icon: Truck },
  { id: 'orders', label: 'Comandas', icon: ClipboardList },
  { id: 'pos', label: 'Vender', icon: ShoppingBag },
  { id: 'expenses', label: 'Gastos', icon: ReceiptText },
  { id: 'cash', label: 'Caja', icon: BadgeDollarSign },
  { id: 'reports', label: 'Reportes', icon: BadgeDollarSign },
  { id: 'activation', label: 'Activación POS', icon: ShieldCheck },
  { id: 'roulette', label: 'Ruleta', icon: Gift },
  { id: 'devices', label: 'Dispositivos', icon: Smartphone },
];

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    credentials: 'include',
    ...options,
    headers: {
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...options.headers,
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new AdminApiError(
      typeof body.message === 'string' ? body.message : 'No fue posible completar la operación.',
      response.status,
    );
  return body as T;
}

class AdminApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

type PendingAdminOperation = { fingerprint: string; key: string };
const pendingAdminOperations = new Map<string, PendingAdminOperation>();
function pendingStorageKey(scope: string) {
  return `bj-pos-pending:${scope}`;
}
function readAdminOperation(scope: string): PendingAdminOperation | undefined {
  const inMemory = pendingAdminOperations.get(scope);
  if (inMemory) return inMemory;
  try {
    const saved = sessionStorage.getItem(pendingStorageKey(scope));
    const pending = saved ? (JSON.parse(saved) as PendingAdminOperation) : undefined;
    if (pending) pendingAdminOperations.set(scope, pending);
    return pending;
  } catch {
    return undefined;
  }
}
function readAdminOperationPayload<T>(scope: string): T | undefined {
  try {
    const pending = readAdminOperation(scope);
    return pending ? (JSON.parse(pending.fingerprint) as T) : undefined;
  } catch {
    return undefined;
  }
}
function beginAdminOperation(scope: string, fingerprint: string): PendingAdminOperation | null {
  const existing = readAdminOperation(scope);
  if (existing && existing.fingerprint !== fingerprint) return null;
  const pending = existing ?? { fingerprint, key: crypto.randomUUID() };
  pendingAdminOperations.set(scope, pending);
  try {
    sessionStorage.setItem(pendingStorageKey(scope), JSON.stringify(pending));
  } catch {
    // The in-memory key still makes retries safe for this mounted screen.
  }
  return pending;
}
function finishAdminOperation(scope: string) {
  pendingAdminOperations.delete(scope);
  try {
    sessionStorage.removeItem(pendingStorageKey(scope));
  } catch {
    // Storage may be disabled by the browser; the server remains authoritative.
  }
}
function releaseRejectedAdminOperation(scope: string, cause: unknown) {
  if (cause instanceof AdminApiError && cause.status < 500) finishAdminOperation(scope);
}

function formatMoney(cents: number) {
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN',
    maximumFractionDigits: 0,
  }).format(cents / 100);
}
function formatDate(value: string) {
  return new Intl.DateTimeFormat('es-MX', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'America/Mexico_City',
  }).format(new Date(value));
}

function InventoryLedger({ data }: { data: StockLedgerState | null }) {
  if (!data) return <p>Cargando inventario…</p>;
  return (
    <div className="settings-grid">
      <section className="admin-card">
        <p className="eyebrow">Libro mayor</p>
        <h2>Existencia, reservas y disponibilidad</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Ingrediente</th>
                <th>Físico</th>
                <th>Reservado</th>
                <th>Disponible</th>
                <th>Valor</th>
              </tr>
            </thead>
            <tbody>
              {data.ingredients.length ? (
                data.ingredients.map((item) => (
                  <tr key={item.id}>
                    <td>{item.name}</td>
                    <td>
                      {item.stock} {item.unit}
                    </td>
                    <td>
                      {item.reserved} {item.unit}
                    </td>
                    <td>
                      {item.available} {item.unit}
                    </td>
                    <td>{formatMoney(Number(item.value_cents))}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={5}>Todavía no hay ingredientes.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
      <section className="admin-card">
        <h2>Movimientos recientes</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Tipo</th>
                <th>Cantidad</th>
                <th>Saldo</th>
                <th>Motivo</th>
              </tr>
            </thead>
            <tbody>
              {data.movements.length ? (
                data.movements.map((movement) => (
                  <tr key={movement.id}>
                    <td>{formatDate(movement.created_at)}</td>
                    <td>{movement.movement_type}</td>
                    <td>{movement.quantity_delta}</td>
                    <td>{movement.stock_after}</td>
                    <td>{movement.reason || '—'}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={5}>El saldo inicial aparecerá al migrar existencias.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

type Purchasing = {
  suppliers: Array<{ id: string; name: string; active: boolean }>;
  presentations: Array<{
    id: string;
    name: string;
    ingredient_name: string;
    supplier_name: string | null;
    base_quantity: string;
    active: boolean;
  }>;
  purchases: Array<{
    id: string;
    supplier_name: string;
    reference: string;
    status: string;
    total_cents: number;
    payment_method: string;
    funds_origin: string;
    created_at: string;
  }>;
};

type RecipeVersions = {
  versions: Array<{
    id: string;
    product_id: string;
    product_name: string;
    version_number: number;
    target_margin: number;
    overhead_cents: number;
    status: 'draft' | 'active' | 'retired';
    created_at: string;
    activated_at: string | null;
  }>;
  components: Array<{
    recipe_version_id: string;
    component_kind: string;
    component_name: string;
    quantity: string;
    removable: boolean;
    extra: boolean;
  }>;
};

function RecipeVersionsView({
  data,
  products,
  ingredients,
  modifiers,
  csrf,
  onSaved,
}: {
  data: RecipeVersions | null;
  products: ProductRow[];
  ingredients: StockLedgerState['ingredients'];
  modifiers: ModifierRow[];
  csrf: string;
  onSaved(): void;
}) {
  const [productId, setProductId] = useState('');
  const [targetMargin, setTargetMargin] = useState('65');
  const [overhead, setOverhead] = useState('0');
  const [kind, setKind] = useState<'ingredient' | 'product' | 'packaging' | 'modifier'>(
    'ingredient',
  );
  const [componentId, setComponentId] = useState('');
  const [componentQuantity, setComponentQuantity] = useState('');
  const [components, setComponents] = useState<
    Array<{
      kind: 'ingredient' | 'product' | 'packaging' | 'modifier';
      id: string;
      name: string;
      quantity: string;
      removable: boolean;
      extra: boolean;
    }>
  >([]);
  const [error, setError] = useState('');
  if (!data) return <p>Cargando recetas…</p>;
  const selectable =
    kind === 'product'
      ? products.filter((product) => product.id !== productId)
      : kind === 'modifier'
        ? modifiers
        : ingredients;
  const addComponent = () => {
    const selected = selectable.find((item) => item.id === componentId);
    if (
      !selected ||
      !/^\d+(?:\.\d{1,3})?$/.test(componentQuantity) ||
      Number(componentQuantity) <= 0
    ) {
      setError('Selecciona un componente y una cantidad de hasta tres decimales.');
      return;
    }
    setComponents((current) => [
      ...current,
      {
        kind,
        id: selected.id,
        name: selected.name,
        quantity: componentQuantity,
        removable: false,
        extra: false,
      },
    ]);
    setComponentId('');
    setComponentQuantity('');
    setError('');
  };
  const save = async () => {
    if (!productId || !components.length) {
      setError('Selecciona un producto y agrega al menos un componente.');
      return;
    }
    try {
      await request('/api/v1/admin/recipes/versions', {
        method: 'POST',
        headers: { 'x-csrf-token': csrf },
        body: JSON.stringify({
          idempotencyKey: crypto.randomUUID(),
          productId,
          targetMargin: Number(targetMargin),
          overheadCents: Math.round(Number(overhead) * 100),
          components: components.map((component) => ({
            kind: component.kind,
            quantity: component.quantity,
            removable: component.removable,
            extra: component.extra,
            ...(component.kind === 'product'
              ? { productId: component.id }
              : component.kind === 'modifier'
                ? { modifierId: component.id }
                : { ingredientId: component.id }),
          })),
        }),
      });
      setComponents([]);
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No fue posible guardar la receta.');
    }
  };
  const componentsFor = (versionId: string) =>
    data.components.filter((component) => component.recipe_version_id === versionId);
  return (
    <div className="row-list">
      <section className="admin-card">
        <p className="eyebrow">Historial inmutable</p>
        <h2>Versiones de recetas</h2>
        <p>
          Las nuevas versiones se habilitan por etapas en el servidor. Los cambios de precio de
          lista permanecen separados del costo y la composición de la receta.
        </p>
      </section>
      <section className="admin-card">
        <p className="eyebrow">Nueva versión</p>
        <h2>Composición confirmable</h2>
        <div className="settings-grid">
          <label>
            Producto
            <select value={productId} onChange={(event) => setProductId(event.target.value)}>
              <option value="">Selecciona…</option>
              {products.map((product) => (
                <option value={product.id} key={product.id}>
                  {product.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Margen objetivo (%)
            <input value={targetMargin} onChange={(event) => setTargetMargin(event.target.value)} />
          </label>
          <label>
            Costos fijos (MXN)
            <input value={overhead} onChange={(event) => setOverhead(event.target.value)} />
          </label>
        </div>
        <div className="settings-grid">
          <label>
            Tipo de componente
            <select
              value={kind}
              onChange={(event) => {
                setKind(event.target.value as typeof kind);
                setComponentId('');
              }}
            >
              <option value="ingredient">Insumo</option>
              <option value="packaging">Empaque</option>
              <option value="product">Producto o preparación</option>
              <option value="modifier">Extra</option>
            </select>
          </label>
          <label>
            Componente
            <select value={componentId} onChange={(event) => setComponentId(event.target.value)}>
              <option value="">Selecciona…</option>
              {selectable.map((item) => (
                <option value={item.id} key={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Cantidad
            <input
              inputMode="decimal"
              value={componentQuantity}
              onChange={(event) => setComponentQuantity(event.target.value)}
            />
          </label>
        </div>
        <button className="secondary" onClick={addComponent}>
          Agregar componente
        </button>
        {components.length ? (
          <div className="table-wrap">
            <table>
              <tbody>
                {components.map((component, index) => (
                  <tr key={`${component.kind}-${component.id}-${index}`}>
                    <td>{component.name}</td>
                    <td>{component.quantity}</td>
                    <td>
                      <label>
                        <input
                          type="checkbox"
                          checked={component.removable}
                          onChange={(event) =>
                            setComponents((current) =>
                              current.map((item, itemIndex) =>
                                itemIndex === index
                                  ? { ...item, removable: event.target.checked }
                                  : item,
                              ),
                            )
                          }
                        />
                        Removible
                      </label>
                      <label>
                        <input
                          type="checkbox"
                          checked={component.extra}
                          onChange={(event) =>
                            setComponents((current) =>
                              current.map((item, itemIndex) =>
                                itemIndex === index
                                  ? { ...item, extra: event.target.checked }
                                  : item,
                              ),
                            )
                          }
                        />
                        Extra
                      </label>
                    </td>
                    <td>
                      <button
                        className="secondary"
                        onClick={() =>
                          setComponents((current) =>
                            current.filter((_, itemIndex) => itemIndex !== index),
                          )
                        }
                      >
                        Quitar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        {error ? <p className="error">{error}</p> : null}
        <button onClick={save}>Guardar nueva versión</button>
      </section>
      {data.versions.length ? (
        data.versions.map((version) => (
          <section className="admin-card" key={version.id}>
            <div className="section-heading">
              <div>
                <p className="eyebrow">
                  {version.status === 'active' ? 'Activa' : 'Histórica'} · v{version.version_number}
                </p>
                <h2>{version.product_name}</h2>
              </div>
              <p>
                Margen objetivo {version.target_margin}% · costos fijos{' '}
                {formatMoney(version.overhead_cents)}
              </p>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Componente</th>
                    <th>Clase</th>
                    <th>Cantidad</th>
                    <th>Regla</th>
                  </tr>
                </thead>
                <tbody>
                  {componentsFor(version.id).map((component) => (
                    <tr key={`${version.id}-${component.component_name}`}>
                      <td>{component.component_name}</td>
                      <td>{component.component_kind}</td>
                      <td>{component.quantity}</td>
                      <td>
                        {component.extra ? 'Extra' : component.removable ? 'Removible' : 'Base'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))
      ) : (
        <section className="admin-card">Aún no hay recetas versionadas.</section>
      )}
    </div>
  );
}
function PurchasingView({ data }: { data: Purchasing | null }) {
  if (!data) return <p>Cargando compras…</p>;
  return (
    <div className="settings-grid">
      <section className="admin-card">
        <p className="eyebrow">Proveedores y presentaciones</p>
        <h2>Equivalencias guardadas</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Proveedor</th>
                <th>Presentación</th>
                <th>Ingrediente</th>
                <th>Equivale a</th>
              </tr>
            </thead>
            <tbody>
              {data.presentations.length ? (
                data.presentations.map((p) => (
                  <tr key={p.id}>
                    <td>{p.supplier_name ?? '—'}</td>
                    <td>{p.name}</td>
                    <td>{p.ingredient_name}</td>
                    <td>{p.base_quantity}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={4}>Aún no hay presentaciones.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
      <section className="admin-card">
        <h2>Compras recientes</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Proveedor</th>
                <th>Folio</th>
                <th>Total</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {data.purchases.length ? (
                data.purchases.map((p) => (
                  <tr key={p.id}>
                    <td>{formatDate(p.created_at)}</td>
                    <td>{p.supplier_name}</td>
                    <td>{p.reference || '—'}</td>
                    <td>{formatMoney(p.total_cents)}</td>
                    <td>{p.status}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={5}>No hay compras registradas en el circuito nuevo.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function escapeHtml(value: string) {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[character]!,
  );
}

function ticketHtml(ticket: OrderTicket) {
  const rows = ticket.order.items
    .map(
      (item) =>
        `<tr><td>${item.quantity} × ${escapeHtml(item.productName)}</td><td>${formatMoney(item.lineTotalCents)}</td></tr>`,
    )
    .join('');
  const payments = ticket.payments
    .map(
      (payment) =>
        `<li>${{ cash: 'Efectivo', card: 'Tarjeta', transfer: 'Transferencia' }[payment.method]}: ${formatMoney(payment.appliedCents)}</li>`,
    )
    .join('');
  return `<!doctype html><html lang="es"><meta charset="utf-8"><title>Ticket B&J</title><style>body{font:16px Arial,sans-serif;max-width:560px;margin:32px auto;color:#171717}h1,p{text-align:center}table{width:100%;border-collapse:collapse;margin:24px 0}td{padding:12px 0;border-bottom:1px solid #ddd}td:last-child{text-align:right}.total{text-align:right;font-size:20px;font-weight:bold}@media print{button{display:none}}</style><body><h1>B&amp;J Burgers</h1><p>Ticket ${escapeHtml(ticket.id.slice(0, 8).toUpperCase())}<br>${new Date(ticket.issuedAt).toLocaleString('es-MX', { timeZone: 'America/Mexico_City' })}</p><p>${escapeHtml(ticket.order.customerName || 'Mostrador')}</p><table>${rows}</table>${ticket.order.manualDiscountCents > 0 ? `<p>Descuento ${formatMoney(ticket.order.manualDiscountCents)} · ${escapeHtml(ticket.order.manualDiscountReason)}</p>` : ''}<p class="total">Total ${formatMoney(ticket.order.totalCents)}</p><ul>${payments}</ul><p style="text-align:center">Gracias por tu compra</p></body></html>`;
}

function RefundAction({ order, csrf, onSaved }: { order: Order; csrf: string; onSaved(): void }) {
  const operationScope = `refund:${order.id}`;
  const savedRefund = readAdminOperationPayload<{
    paymentId: string;
    orderItemId: string;
    amountCents: number;
    reason: string;
  }>(operationScope);
  const refundable = order.payments.filter((payment) => payment.refundableCents > 0);
  const [paymentId, setPaymentId] = useState(savedRefund?.paymentId ?? refundable[0]?.id ?? '');
  const [orderItemId, setOrderItemId] = useState(savedRefund?.orderItemId ?? '');
  const [amount, setAmount] = useState(
    savedRefund ? (savedRefund.amountCents / 100).toFixed(2) : '',
  );
  const [reason, setReason] = useState(savedRefund?.reason ?? '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function refund() {
    const payment = refundable.find((entry) => entry.id === paymentId);
    const amountCents = Math.round(Number(amount) * 100);
    const fingerprint = JSON.stringify({
      paymentId,
      orderItemId,
      amountCents,
      reason: reason.trim(),
    });
    const isRetry = readAdminOperation(operationScope)?.fingerprint === fingerprint;
    if (
      !payment ||
      !Number.isSafeInteger(amountCents) ||
      amountCents <= 0 ||
      (!isRetry && amountCents > payment.refundableCents) ||
      reason.trim().length < 3
    ) {
      setError('Elige un pago, un importe disponible y un motivo de al menos 3 caracteres.');
      return;
    }
    const pending = beginAdminOperation(operationScope, fingerprint);
    if (!pending) {
      setError(
        'Hay una devolución pendiente. Reinténtala con los mismos datos antes de cambiarla.',
      );
      return;
    }
    setBusy(true);
    setError('');
    try {
      await request(`/api/v1/admin/orders/${order.id}/refunds`, {
        method: 'POST',
        headers: { 'x-csrf-token': csrf },
        body: JSON.stringify({
          idempotencyKey: pending.key,
          paymentId,
          ...(orderItemId ? { orderItemId } : {}),
          amountCents,
          reason: reason.trim(),
        }),
      });
      finishAdminOperation(operationScope);
      setAmount('');
      setReason('');
      onSaved();
    } catch (cause) {
      releaseRejectedAdminOperation(operationScope, cause);
      setError(cause instanceof Error ? cause.message : 'No se pudo registrar la devolución.');
    } finally {
      setBusy(false);
    }
  }
  if (!refundable.length) return null;
  return (
    <details>
      <summary>Devolver pago</summary>
      <div className="settings-grid">
        <label>
          Pago original
          <select value={paymentId} onChange={(event) => setPaymentId(event.target.value)}>
            {refundable.map((payment) => (
              <option value={payment.id} key={payment.id}>
                {{ cash: 'Efectivo', card: 'Tarjeta', transfer: 'Transferencia' }[payment.method]} ·{' '}
                {formatMoney(payment.refundableCents)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Partida (opcional)
          <select value={orderItemId} onChange={(event) => setOrderItemId(event.target.value)}>
            <option value="">Importe general de la comanda</option>
            {order.items.map((item) => (
              <option value={item.id} key={item.id}>
                {item.quantity} × {item.productName} · {formatMoney(item.lineTotalCents)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Importe (MXN)
          <input
            type="number"
            min="0.01"
            step="0.01"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
          />
        </label>
        <label>
          Motivo
          <input value={reason} onChange={(event) => setReason(event.target.value)} />
        </label>
      </div>
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
      <button className="secondary" disabled={busy} onClick={() => void refund()}>
        {busy ? 'Registrando…' : 'Registrar devolución'}
      </button>
    </details>
  );
}

function PaymentAction({ order, csrf, onSaved }: { order: Order; csrf: string; onSaved(): void }) {
  const [method, setMethod] = useState<'cash' | 'card' | 'transfer'>('cash');
  const [received, setReceived] = useState('');
  const [splitMethod, setSplitMethod] = useState<'none' | 'cash' | 'card' | 'transfer'>('none');
  const [splitAmount, setSplitAmount] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const operationScope = `payment:${order.id}`;
  if (order.balanceCents <= 0 || ['cancelled', 'delivered'].includes(order.status)) return null;
  async function collect() {
    const receivedCents = Math.round(Number(received) * 100);
    if (!Number.isSafeInteger(receivedCents) || receivedCents <= 0) {
      setError('Escribe un importe válido.');
      return;
    }
    const splitCents = splitMethod === 'none' ? 0 : Math.round(Number(splitAmount) * 100);
    const appliedCents = order.balanceCents - splitCents;
    if (
      appliedCents <= 0 ||
      receivedCents < appliedCents ||
      (method !== 'cash' && receivedCents !== appliedCents) ||
      (splitMethod !== 'none' && (!Number.isSafeInteger(splitCents) || splitCents <= 0))
    ) {
      setError('Revisa el saldo y la distribución entre medios.');
      return;
    }
    const payments = [
      { method, receivedCents, appliedCents },
      ...(splitMethod === 'none'
        ? []
        : [{ method: splitMethod, receivedCents: splitCents, appliedCents: splitCents }]),
    ];
    const fingerprint = JSON.stringify({ orderId: order.id, payments });
    const pending = beginAdminOperation(operationScope, fingerprint);
    if (!pending) {
      setError('Hay un cobro pendiente. Reinténtalo con los mismos datos antes de cambiarlo.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const path =
        order.fulfillment === 'counter' &&
        order.status === 'ready' &&
        appliedCents + splitCents === order.balanceCents
          ? `/api/v1/admin/orders/${order.id}/counter-checkout`
          : `/api/v1/admin/orders/${order.id}/payments`;
      await request(path, {
        method: 'POST',
        headers: { 'x-csrf-token': csrf },
        body: JSON.stringify({ idempotencyKey: pending.key, payments }),
      });
      finishAdminOperation(operationScope);
      setReceived('');
      setSplitAmount('');
      setSplitMethod('none');
      onSaved();
    } catch (cause) {
      releaseRejectedAdminOperation(operationScope, cause);
      setError(
        cause instanceof Error
          ? cause.message
          : 'No se pudo registrar el cobro; reintenta sin cambiar los datos.',
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <details>
      <summary>Cobrar · saldo {formatMoney(order.balanceCents)}</summary>
      <div className="form-row">
        <label>
          Medio
          <select
            value={method}
            onChange={(event) => {
              const selected = event.target.value as typeof method;
              setMethod(selected);
              if (splitMethod === selected) setSplitMethod('none');
            }}
          >
            <option value="cash">Efectivo</option>
            <option value="card">Tarjeta</option>
            <option value="transfer">Transferencia</option>
          </select>
        </label>
        <label>
          Recibido (MXN)
          <input
            type="number"
            min="0.01"
            step="0.01"
            value={received}
            onChange={(event) => setReceived(event.target.value)}
          />
        </label>
      </div>
      {order.fulfillment === 'counter' && order.status === 'ready' && (
        <div className="form-row">
          <label>
            Dividir en
            <select
              value={splitMethod}
              onChange={(event) => setSplitMethod(event.target.value as typeof splitMethod)}
            >
              <option value="none">Un medio</option>
              {(['cash', 'card', 'transfer'] as const)
                .filter((value) => value !== method)
                .map((value) => (
                  <option key={value} value={value}>
                    + {{ cash: 'Efectivo', card: 'Tarjeta', transfer: 'Transferencia' }[value]}
                  </option>
                ))}
            </select>
          </label>
          {splitMethod !== 'none' && (
            <label>
              Importe del segundo medio
              <input
                type="number"
                min="0.01"
                step="0.01"
                value={splitAmount}
                onChange={(event) => setSplitAmount(event.target.value)}
              />
            </label>
          )}
        </div>
      )}
      {method === 'cash' &&
        received &&
        Number(received) * 100 >
          order.balanceCents - (splitMethod === 'none' ? 0 : Number(splitAmount) * 100) && (
          <p>
            Cambio:{' '}
            {formatMoney(
              Math.max(
                0,
                Math.round(Number(received) * 100) -
                  (order.balanceCents -
                    (splitMethod === 'none' ? 0 : Math.round(Number(splitAmount) * 100))),
              ),
            )}
          </p>
        )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button className="secondary" disabled={busy} onClick={() => void collect()}>
        {busy
          ? 'Registrando…'
          : order.fulfillment === 'counter' && order.status === 'ready'
            ? 'Cobrar y entregar'
            : 'Registrar cobro'}
      </button>
    </details>
  );
}

function StatusAction({ order, csrf, onSaved }: { order: Order; csrf: string; onSaved(): void }) {
  const next: Partial<Record<Order['status'], Order['status']>> = {
    new: 'preparing',
    preparing: 'ready',
    ready: 'out_for_delivery',
    out_for_delivery: 'delivered',
  };
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const operationScope = `status:${order.id}`;
  const status = next[order.status];
  async function advance(target: Order['status']) {
    const fingerprint = JSON.stringify({ orderId: order.id, status: target });
    const pending = beginAdminOperation(operationScope, fingerprint);
    if (!pending) {
      setError('Hay un cambio de estado pendiente. Reinténtalo antes de realizar otro.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await request(`/api/v1/admin/orders/${order.id}/status`, {
        method: 'PUT',
        headers: { 'x-csrf-token': csrf },
        body: JSON.stringify({
          status: target,
          note: 'Actualización desde administración',
          idempotencyKey: pending.key,
        }),
      });
      finishAdminOperation(operationScope);
      onSaved();
    } catch (cause) {
      releaseRejectedAdminOperation(operationScope, cause);
      setError(cause instanceof Error ? cause.message : 'No se pudo cambiar el estado.');
    } finally {
      setBusy(false);
    }
  }
  if (!status && order.status !== 'new' && order.status !== 'preparing' && order.status !== 'ready')
    return null;
  return (
    <div>
      {status && (
        <button className="secondary" disabled={busy} onClick={() => void advance(status)}>
          {
            (
              {
                preparing: 'Iniciar',
                ready: 'Lista',
                out_for_delivery: 'En reparto',
                delivered: 'Entregar',
              } as Record<string, string>
            )[status]
          }
        </button>
      )}
      {['new', 'preparing', 'ready'].includes(order.status) && (
        <button className="secondary" disabled={busy} onClick={() => void advance('cancelled')}>
          Cancelar
        </button>
      )}
      {error && <p className="error">{error}</p>}
    </div>
  );
}

function OrdersView({
  orders,
  csrf,
  capabilities,
  onSaved,
}: {
  orders: Order[] | null;
  csrf: string;
  capabilities: Record<string, boolean>;
  onSaved(): void;
}) {
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');
  const ticketKeys = useRef<Record<string, string>>({});
  async function printTicket(orderId: string) {
    const popup = window.open('', '_blank');
    if (!popup) {
      setError('Permite ventanas emergentes para generar el ticket.');
      return;
    }
    popup.document.write('<p style="font:16px Arial;padding:24px">Preparando ticket…</p>');
    setBusyId(orderId);
    setError('');
    try {
      const idempotencyKey =
        ticketKeys.current[orderId] ?? (ticketKeys.current[orderId] = crypto.randomUUID());
      const result = await request<{ ticket: OrderTicket }>(
        `/api/v1/admin/orders/${orderId}/ticket`,
        {
          method: 'POST',
          headers: { 'x-csrf-token': csrf },
          body: JSON.stringify({ idempotencyKey }),
        },
      );
      popup.document.open();
      popup.document.write(ticketHtml(result.ticket));
      popup.document.close();
      popup.focus();
      popup.print();
      delete ticketKeys.current[orderId];
    } catch (cause) {
      popup.close();
      setError(cause instanceof Error ? cause.message : 'No se pudo emitir el ticket.');
    } finally {
      setBusyId('');
    }
  }
  if (!orders) return <p>Cargando comandas…</p>;
  return (
    <section className="admin-card">
      <p className="eyebrow">Venta y preparación en un solo registro</p>
      <h2>Comandas recientes</h2>
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Cliente</th>
              <th>Modalidad</th>
              <th>Estado</th>
              <th>Preparación / entrega</th>
              <th>Total</th>
              <th>Cobrado / saldo</th>
              <th>Cobro</th>
              <th>Partidas</th>
              <th>Devolución</th>
              <th>Ticket</th>
            </tr>
          </thead>
          <tbody>
            {orders.length ? (
              orders.map((order) => (
                <tr key={order.id}>
                  <td>{formatDate(order.createdAt)}</td>
                  <td>{order.customerName || 'Mostrador'}</td>
                  <td>
                    {order.fulfillment === 'counter'
                      ? 'Mostrador'
                      : order.fulfillment === 'pickup'
                        ? 'Recoger'
                        : 'Domicilio'}
                  </td>
                  <td>{order.status}</td>
                  <td>
                    {capabilities.unified_orders && (
                      <StatusAction order={order} csrf={csrf} onSaved={onSaved} />
                    )}
                  </td>
                  <td>{formatMoney(order.totalCents)}</td>
                  <td>
                    {formatMoney(order.paidCents - order.refundedCents)} /{' '}
                    {formatMoney(order.balanceCents)}
                  </td>
                  <td>
                    {capabilities.payments_refunds && (
                      <PaymentAction order={order} csrf={csrf} onSaved={onSaved} />
                    )}
                  </td>
                  <td>
                    {order.items.map((item) => item.quantity + '× ' + item.productName).join(', ')}
                  </td>
                  <td>
                    {capabilities.payments_refunds && (
                      <RefundAction order={order} csrf={csrf} onSaved={onSaved} />
                    )}
                  </td>
                  <td>
                    {capabilities.pos_tickets && order.status === 'delivered' ? (
                      <button
                        className="secondary"
                        disabled={busyId === order.id}
                        onClick={() => void printTicket(order.id)}
                      >
                        {busyId === order.id ? 'Preparando…' : 'PDF / imprimir'}
                      </button>
                    ) : (
                      'Disponible al entregar'
                    )}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={11}>Aún no hay comandas.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function AdminPos({
  csrf,
  enabled,
  onCreated,
}: {
  csrf: string;
  enabled: boolean;
  onCreated(): void;
}) {
  const operationScope = 'new-order';
  const savedOrder = readAdminOperationPayload<{
    fulfillment: string;
    customerName: string;
    neighborhood: string;
    streetAndNumber: string;
    items: Array<{
      productId: string;
      quantity: number;
      removedIngredients: string[];
      modifierIds: string[];
      combo: boolean;
      note: string;
      drinkProductId?: string;
    }>;
    manualDiscountCents: number;
    manualDiscountReason: string;
    quotedTotalCents: number;
  }>(operationScope);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [productId, setProductId] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [removedIngredients, setRemovedIngredients] = useState<string[]>([]);
  const [modifierIds, setModifierIds] = useState<string[]>([]);
  const [combo, setCombo] = useState(false);
  const [drinkProductId, setDrinkProductId] = useState('');
  const [items, setItems] = useState<
    Array<{
      productId: string;
      quantity: number;
      removedIngredients: string[];
      modifierIds: string[];
      combo: boolean;
      note: string;
      drinkProductId?: string;
    }>
  >(savedOrder?.items ?? []);
  const [fulfillment, setFulfillment] = useState(savedOrder?.fulfillment ?? 'counter');
  const [customerName, setCustomerName] = useState(savedOrder?.customerName ?? '');
  const [neighborhood, setNeighborhood] = useState(savedOrder?.neighborhood ?? '');
  const [streetAndNumber, setStreetAndNumber] = useState(savedOrder?.streetAndNumber ?? '');
  const [manualDiscount, setManualDiscount] = useState(
    savedOrder ? (savedOrder.manualDiscountCents / 100).toFixed(2) : '',
  );
  const [manualDiscountReason, setManualDiscountReason] = useState(
    savedOrder?.manualDiscountReason ?? '',
  );
  const [quote, setQuote] = useState<{
    totalCents: number;
    promotion: Record<string, unknown> | null;
  } | null>(savedOrder ? { totalCents: savedOrder.quotedTotalCents, promotion: null } : null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    request<{ catalog: Catalog }>('/api/v1/admin/pos/catalog')
      .then(({ catalog: value }) => {
        setCatalog(value);
        setProductId(value.products.find((item) => item.available)?.id ?? '');
      })
      .catch((cause) =>
        setError(cause instanceof Error ? cause.message : 'Activa el POS para vender.'),
      );
  }, [enabled]);
  function changed() {
    setQuote(null);
  }
  function addItem() {
    const qty = Number(quantity);
    if (!productId || !Number.isInteger(qty) || qty < 1 || qty > 40) return;
    if (combo && !drinkProductId) {
      setError('Elige la bebida del combo.');
      return;
    }
    setItems((current) => [
      ...current,
      {
        productId,
        quantity: qty,
        removedIngredients,
        modifierIds,
        combo,
        note: '',
        ...(combo ? { drinkProductId } : {}),
      },
    ]);
    changed();
  }
  async function requestQuote() {
    if (!items.length) return;
    setBusy(true);
    setError('');
    try {
      const result = await request<{
        totalCents: number;
        promotion: Record<string, unknown> | null;
      }>('/api/v1/admin/unified-orders/quote', {
        method: 'POST',
        headers: { 'x-csrf-token': csrf },
        body: JSON.stringify({
          fulfillment,
          customerName,
          neighborhood,
          streetAndNumber,
          manualDiscountCents: Math.round(Number(manualDiscount || 0) * 100),
          manualDiscountReason: manualDiscountReason.trim(),
          items,
        }),
      });
      setQuote(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo cotizar.');
    } finally {
      setBusy(false);
    }
  }
  async function confirm() {
    if (!quote) return;
    const payload = {
      fulfillment,
      customerName,
      neighborhood,
      streetAndNumber,
      manualDiscountCents: Math.round(Number(manualDiscount || 0) * 100),
      manualDiscountReason: manualDiscountReason.trim(),
      items,
      quotedTotalCents: quote.totalCents,
    };
    const fingerprint = JSON.stringify(payload);
    const pending = beginAdminOperation(operationScope, fingerprint);
    if (!pending) {
      setError(
        'Hay una comanda pendiente de confirmar. Reintenta esa misma solicitud antes de cambiarla.',
      );
      return;
    }
    setBusy(true);
    setError('');
    try {
      await request('/api/v1/admin/unified-orders', {
        method: 'POST',
        headers: { 'x-csrf-token': csrf },
        body: JSON.stringify({ ...payload, idempotencyKey: pending.key }),
      });
      finishAdminOperation(operationScope);
      setItems([]);
      setQuote(null);
      onCreated();
    } catch (cause) {
      releaseRejectedAdminOperation(operationScope, cause);
      setError(
        cause instanceof Error
          ? cause.message
          : 'No se pudo confirmar. Reintenta con la misma operación.',
      );
    } finally {
      setBusy(false);
    }
  }
  if (!enabled)
    return (
      <section className="admin-card">
        <p className="eyebrow">Venta · precio y existencia confirmados por la API</p>
        <h2>Nueva venta</h2>
        <p className="notice" role="alert">
          El circuito de venta aún no está habilitado en el servidor.
        </p>
      </section>
    );
  return (
    <section className="admin-card">
      <p className="eyebrow">Venta · precio y existencia confirmados por la API</p>
      <h2>Nueva venta</h2>
      <div className="form-row">
        <label>
          Producto
          <select
            value={productId}
            onChange={(event) => {
              setProductId(event.target.value);
              setRemovedIngredients([]);
              setModifierIds([]);
              setCombo(false);
              setDrinkProductId('');
              changed();
            }}
          >
            {catalog?.products
              .filter((product) => product.available)
              .map((product) => (
                <option key={product.id} value={product.id}>
                  {product.name} · {formatMoney(product.priceCents)}
                </option>
              ))}
          </select>
        </label>
        <label>
          Cantidad
          <input
            type="number"
            min="1"
            max="40"
            step="1"
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
          />
        </label>
        <button className="secondary" onClick={addItem}>
          Agregar
        </button>
      </div>
      {(() => {
        const selectedProduct = catalog?.products.find((product) => product.id === productId);
        return selectedProduct ? (
          <div className="settings-grid">
            {selectedProduct.removableIngredients.length > 0 && (
              <fieldset>
                <legend>Quitar ingredientes</legend>
                {selectedProduct.removableIngredients.map((ingredient) => (
                  <label className="check-row" key={ingredient}>
                    <input
                      type="checkbox"
                      checked={removedIngredients.includes(ingredient)}
                      onChange={(event) =>
                        setRemovedIngredients((current) =>
                          event.target.checked
                            ? [...current, ingredient]
                            : current.filter((entry) => entry !== ingredient),
                        )
                      }
                    />
                    {ingredient}
                  </label>
                ))}
              </fieldset>
            )}
            {catalog?.modifiers.some((modifier) => modifier.available) && (
              <fieldset>
                <legend>Extras</legend>
                {catalog.modifiers
                  .filter((modifier) => modifier.available)
                  .map((modifier) => (
                    <label className="check-row" key={modifier.id}>
                      <input
                        type="checkbox"
                        checked={modifierIds.includes(modifier.id)}
                        onChange={(event) =>
                          setModifierIds((current) =>
                            event.target.checked
                              ? [...current, modifier.id]
                              : current.filter((entry) => entry !== modifier.id),
                          )
                        }
                      />
                      {modifier.name} · {formatMoney(modifier.priceCents)}
                    </label>
                  ))}
              </fieldset>
            )}
            {selectedProduct.comboEligible && (
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={combo}
                  onChange={(event) => setCombo(event.target.checked)}
                />
                Convertir en combo
              </label>
            )}
            {combo && (
              <label>
                Bebida
                <select
                  value={drinkProductId}
                  onChange={(event) => setDrinkProductId(event.target.value)}
                >
                  <option value="">Selecciona…</option>
                  {catalog?.products
                    .filter((product) => product.available && product.id !== productId)
                    .map((product) => (
                      <option value={product.id} key={product.id}>
                        {product.name}
                      </option>
                    ))}
                </select>
              </label>
            )}
          </div>
        ) : null;
      })()}
      <div className="row-list">
        {items.map((item, index) => (
          <p key={`${index}-${item.productId}`}>
            {item.quantity} ×{' '}
            {catalog?.products.find((product) => product.id === item.productId)?.name}{' '}
            <button
              className="secondary"
              onClick={() => {
                setItems((current) => current.filter((_, row) => row !== index));
                changed();
              }}
            >
              Quitar
            </button>
          </p>
        ))}
      </div>
      <div className="form-row">
        <label>
          Modalidad
          <select
            value={fulfillment}
            onChange={(event) => {
              setFulfillment(event.target.value);
              changed();
            }}
          >
            <option value="counter">Mostrador</option>
            <option value="pickup">Recoger</option>
            <option value="delivery">Domicilio</option>
          </select>
        </label>
        <label>
          Cliente
          <input
            value={customerName}
            onChange={(event) => {
              setCustomerName(event.target.value);
              changed();
            }}
          />
        </label>
      </div>
      {fulfillment === 'delivery' && (
        <div className="form-row">
          <label>
            Colonia
            <input
              value={neighborhood}
              onChange={(event) => {
                setNeighborhood(event.target.value);
                changed();
              }}
            />
          </label>
          <label>
            Dirección
            <input
              value={streetAndNumber}
              onChange={(event) => {
                setStreetAndNumber(event.target.value);
                changed();
              }}
            />
          </label>
        </div>
      )}
      <div className="form-row">
        <label>
          Descuento manual (MXN)
          <input
            type="number"
            min="0"
            step="0.01"
            value={manualDiscount}
            onChange={(event) => {
              setManualDiscount(event.target.value);
              changed();
            }}
          />
        </label>
        <label>
          Motivo del descuento
          <input
            value={manualDiscountReason}
            maxLength={300}
            onChange={(event) => {
              setManualDiscountReason(event.target.value);
              changed();
            }}
          />
        </label>
      </div>
      {quote && (
        <p className="notice">
          Total cotizado por el servidor: <strong>{formatMoney(quote.totalCents)}</strong>
          {quote.promotion ? ' · promoción aplicada' : ''}
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="form-row">
        <button
          className="secondary"
          disabled={busy || !items.length}
          onClick={() => void requestQuote()}
        >
          Cotizar
        </button>
        <button disabled={busy || !quote} onClick={() => void confirm()}>
          {busy ? 'Procesando…' : 'Confirmar comanda'}
        </button>
      </div>
    </section>
  );
}

type ExpenseRow = {
  id: string;
  category: string;
  description: string;
  amount_cents: number;
  payment_method: string;
  funds_origin: string;
  linked_payment_id: string | null;
  incurred_at: string;
  admin_email: string | null;
  device_name: string | null;
};

function ExpensesView({
  csrf,
  enabled,
  onSaved,
}: {
  csrf: string;
  enabled: boolean;
  onSaved(): void;
}) {
  const operationScope = 'expense-create';
  const savedExpense = readAdminOperationPayload<{
    category: string;
    description: string;
    amountCents: number;
    paymentMethod: string;
    fundsOrigin: string;
    occurredAt: string;
    paymentId?: string;
  }>(operationScope);
  const [expenses, setExpenses] = useState<ExpenseRow[]>([]);
  const [category, setCategory] = useState(savedExpense?.category ?? 'other');
  const [description, setDescription] = useState(savedExpense?.description ?? '');
  const [amount, setAmount] = useState(
    savedExpense ? (savedExpense.amountCents / 100).toFixed(2) : '',
  );
  const [paymentMethod, setPaymentMethod] = useState(savedExpense?.paymentMethod ?? 'cash');
  const [fundsOrigin, setFundsOrigin] = useState(savedExpense?.fundsOrigin ?? 'cash_session');
  const [paymentId, setPaymentId] = useState(savedExpense?.paymentId ?? '');
  const [occurredAt, setOccurredAt] = useState(
    savedExpense?.occurredAt ?? new Date().toISOString(),
  );
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function load() {
    const result = await request<{ expenses: ExpenseRow[] }>('/api/v1/admin/expenses');
    setExpenses(result.expenses);
  }
  useEffect(() => {
    void load().catch((cause) =>
      setError(cause instanceof Error ? cause.message : 'No se pudieron cargar los gastos.'),
    );
  }, []);
  async function save() {
    const amountCents = Math.round(Number(amount) * 100);
    if (!Number.isSafeInteger(amountCents) || amountCents <= 0 || description.trim().length < 3) {
      setError('Escribe un importe válido y una descripción de al menos 3 caracteres.');
      return;
    }
    const payload = {
      category,
      description: description.trim(),
      amountCents,
      paymentMethod,
      fundsOrigin,
      occurredAt,
      paymentId: category === 'commission' ? paymentId.trim() : undefined,
    };
    const fingerprint = JSON.stringify(payload);
    const pending = beginAdminOperation(operationScope, fingerprint);
    if (!pending) {
      setError(
        'Hay un gasto pendiente de guardar. Reinténtalo con los mismos datos antes de cambiarlo.',
      );
      return;
    }
    setBusy(true);
    setError('');
    try {
      await request('/api/v1/admin/expenses', {
        method: 'POST',
        headers: { 'x-csrf-token': csrf },
        body: JSON.stringify({
          ...payload,
          idempotencyKey: pending.key,
        }),
      });
      finishAdminOperation(operationScope);
      setDescription('');
      setAmount('');
      setPaymentId('');
      setOccurredAt(new Date().toISOString());
      await load();
      onSaved();
    } catch (cause) {
      releaseRejectedAdminOperation(operationScope, cause);
      setError(
        cause instanceof Error
          ? cause.message
          : 'No se pudo guardar el gasto. Reintenta la misma operación.',
      );
    } finally {
      setBusy(false);
    }
  }
  if (!enabled)
    return (
      <section className="admin-card">
        <h2>Gastos</h2>
        <p role="alert">
          El registro de gastos está deshabilitado hasta activar la capacidad en el servidor.
        </p>
      </section>
    );
  return (
    <div className="settings-grid">
      <section className="admin-card">
        <p className="eyebrow">Registro auditable</p>
        <h2>Nuevo gasto</h2>
        <label>
          Categoría
          <select value={category} onChange={(event) => setCategory(event.target.value)}>
            {[
              ['rent', 'Renta'],
              ['utilities', 'Servicios'],
              ['supplies', 'Insumos operativos'],
              ['maintenance', 'Mantenimiento'],
              ['commission', 'Comisión de pago'],
              ['other', 'Otro'],
            ].map(([value, label]) => (
              <option value={value} key={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Descripción
          <input value={description} onChange={(event) => setDescription(event.target.value)} />
        </label>
        <label>
          Importe (MXN)
          <input
            type="number"
            min="0.01"
            step="0.01"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
          />
        </label>
        <label>
          Medio
          <select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)}>
            <option value="cash">Efectivo</option>
            <option value="card">Tarjeta</option>
            <option value="transfer">Transferencia</option>
          </select>
        </label>
        <label>
          Origen
          <select value={fundsOrigin} onChange={(event) => setFundsOrigin(event.target.value)}>
            <option value="cash_session">Caja del turno</option>
            <option value="external">Fondos externos</option>
          </select>
        </label>
        {category === 'commission' ? (
          <label>
            ID del pago original
            <input
              value={paymentId}
              onChange={(event) => setPaymentId(event.target.value)}
              placeholder="UUID de la línea de pago"
            />
          </label>
        ) : null}
        {error ? (
          <p className="error" role="alert">
            {error}
          </p>
        ) : null}
        <button className="primary" disabled={busy} onClick={() => void save()}>
          {busy ? 'Guardando…' : 'Registrar gasto'}
        </button>
      </section>
      <section className="admin-card">
        <h2>Movimientos recientes</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Rubro</th>
                <th>Descripción</th>
                <th>Medio / origen</th>
                <th>Importe</th>
                <th>Registro</th>
              </tr>
            </thead>
            <tbody>
              {expenses.map((expense) => (
                <tr key={expense.id}>
                  <td>{formatDate(expense.incurred_at)}</td>
                  <td>{capabilityLabels[expense.category] ?? expense.category}</td>
                  <td>{expense.description}</td>
                  <td>
                    {expense.payment_method} ·{' '}
                    {expense.funds_origin === 'cash_session' ? 'turno' : 'externo'}
                  </td>
                  <td>{formatMoney(expense.amount_cents)}</td>
                  <td>{expense.admin_email ?? expense.device_name ?? '—'}</td>
                </tr>
              ))}
              {!expenses.length ? (
                <tr>
                  <td colSpan={6}>Aún no hay gastos registrados.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

type CashState = {
  session: { id: string; openingFundCents: number; expectedCents: number; openedAt: string } | null;
  movements: Array<{
    id: string;
    kind: string;
    amountCents: number;
    reason: string;
    createdAt: string;
  }>;
};
function CashView({ csrf, enabled }: { csrf: string; enabled: boolean }) {
  const operationScope = 'cash-operation';
  const savedCashOperation = readAdminOperationPayload<{
    path: string;
    payload: Record<string, unknown>;
  }>(operationScope);
  const savedCashPayload = savedCashOperation?.payload;
  const [data, setData] = useState<CashState | null>(null);
  const [amount, setAmount] = useState(
    typeof savedCashPayload?.amountCents === 'number'
      ? (savedCashPayload.amountCents / 100).toFixed(2)
      : typeof savedCashPayload?.openingFundCents === 'number'
        ? (savedCashPayload.openingFundCents / 100).toFixed(2)
        : '',
  );
  const [counted, setCounted] = useState(
    typeof savedCashPayload?.countedCents === 'number'
      ? (savedCashPayload.countedCents / 100).toFixed(2)
      : '',
  );
  const [kind, setKind] = useState(
    typeof savedCashPayload?.kind === 'string' ? savedCashPayload.kind : 'income',
  );
  const [reason, setReason] = useState(
    typeof savedCashPayload?.reason === 'string' ? savedCashPayload.reason : '',
  );
  const [note, setNote] = useState(
    typeof savedCashPayload?.note === 'string' ? savedCashPayload.note : '',
  );
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function load() {
    setData(await request<CashState>('/api/v1/admin/cash-session'));
  }
  useEffect(() => {
    void load().catch((cause) =>
      setError(cause instanceof Error ? cause.message : 'No se pudo cargar caja.'),
    );
  }, []);
  async function submit(path: string, payload: Record<string, unknown>) {
    const fingerprint = JSON.stringify({ path, payload });
    const pending = beginAdminOperation(operationScope, fingerprint);
    if (!pending) {
      setError(
        'Hay un movimiento de caja pendiente. Reinténtalo con los mismos datos antes de cambiarlo.',
      );
      return;
    }
    setBusy(true);
    setError('');
    try {
      await request(path, {
        method: 'POST',
        headers: { 'x-csrf-token': csrf },
        body: JSON.stringify({ ...payload, idempotencyKey: pending.key }),
      });
      finishAdminOperation(operationScope);
      await load();
      setAmount('');
      setReason('');
      setNote('');
    } catch (cause) {
      releaseRejectedAdminOperation(operationScope, cause);
      setError(
        cause instanceof Error
          ? cause.message
          : 'No se pudo confirmar. Reintenta la misma operación.',
      );
    } finally {
      setBusy(false);
    }
  }
  const cents = (value: string) => Math.round(Number(value) * 100);
  if (!enabled)
    return (
      <section className="admin-card">
        <h2>Caja {data?.session ? 'abierta' : 'cerrada'}</h2>
        <p role="alert">
          Los movimientos de caja están deshabilitados hasta activar la capacidad en el servidor.
        </p>
        {data?.session && (
          <p>
            Fondo inicial {formatMoney(data.session.openingFundCents)} · efectivo esperado{' '}
            {formatMoney(data.session.expectedCents)}
          </p>
        )}
      </section>
    );
  return (
    <div className="settings-grid">
      <section className="admin-card">
        <p className="eyebrow">Turno compartido</p>
        <h2>{data?.session ? 'Caja abierta' : 'Caja cerrada'}</h2>
        {data?.session ? (
          <>
            <p>
              Fondo inicial: {formatMoney(data.session.openingFundCents)} · Efectivo esperado:{' '}
              <strong>{formatMoney(data.session.expectedCents)}</strong>
            </p>
            <div className="form-row">
              <label>
                Tipo
                <select value={kind} onChange={(event) => setKind(event.target.value)}>
                  <option value="income">Entrada</option>
                  <option value="expense">Salida</option>
                  <option value="withdrawal">Retiro</option>
                </select>
              </label>
              <label>
                Importe (MXN)
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                />
              </label>
              <label>
                Motivo
                <input value={reason} onChange={(event) => setReason(event.target.value)} />
              </label>
              <button
                disabled={busy || cents(amount) <= 0 || reason.trim().length < 3}
                onClick={() =>
                  void submit('/api/v1/admin/cash-session/movements', {
                    kind,
                    amountCents: cents(amount),
                    reason: reason.trim(),
                  })
                }
              >
                Registrar movimiento
              </button>
            </div>
            <div className="form-row">
              <label>
                Efectivo contado (MXN)
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={counted}
                  onChange={(event) => setCounted(event.target.value)}
                />
              </label>
              <label>
                Nota de cierre
                <input value={note} onChange={(event) => setNote(event.target.value)} />
              </label>
              <button
                className="secondary"
                disabled={busy || counted === '' || !Number.isSafeInteger(cents(counted))}
                onClick={() =>
                  void submit('/api/v1/admin/cash-session/close', {
                    countedCents: cents(counted),
                    note,
                  })
                }
              >
                Cerrar y conciliar
              </button>
            </div>
          </>
        ) : (
          <div className="form-row">
            <label>
              Fondo inicial (MXN)
              <input
                type="number"
                min="0"
                step="0.01"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
              />
            </label>
            <button
              disabled={busy || !Number.isSafeInteger(cents(amount)) || cents(amount) < 0}
              onClick={() =>
                void submit('/api/v1/admin/cash-session/open', { openingFundCents: cents(amount) })
              }
            >
              Abrir turno
            </button>
          </div>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </section>
      <section className="admin-card">
        <h2>Movimientos del turno</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Tipo</th>
                <th>Motivo</th>
                <th>Importe</th>
              </tr>
            </thead>
            <tbody>
              {data?.movements.map((movement) => (
                <tr key={movement.id}>
                  <td>{formatDate(movement.createdAt)}</td>
                  <td>{movement.kind}</td>
                  <td>{movement.reason}</td>
                  <td>{formatMoney(movement.amountCents)}</td>
                </tr>
              ))}
              {!data?.movements.length && (
                <tr>
                  <td colSpan={4}>Sin movimientos en el turno abierto.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function localDate(daysAgo = 0) {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

type Profitability = {
  from: string;
  to: string;
  page: number;
  pageSize: number;
  totalRows: number;
  summary: Record<string, number>;
  byFulfillment: Array<{ key: string; orders: number; amountCents: number }>;
  byPayment: Array<{ key: string; amountCents: number }>;
  byProduct: Array<{ key: string; quantity: number; amountCents: number }>;
  rows: Array<{
    occurredAt: string;
    kind: string;
    id: string;
    description: string;
    amountCents: number;
    costCents: number;
    method: string;
  }>;
};
const reportLabels: Record<string, string> = {
  deliveredOrders: 'Pedidos entregados',
  grossSalesCents: 'Ventas entregadas',
  refundsCents: 'Devoluciones',
  netSalesCents: 'Ventas netas',
  costOfGoodsSoldCents: 'Costo vendido',
  grossProfitCents: 'Utilidad bruta',
  commissionsCents: 'Comisiones',
  operatingExpensesCents: 'Gastos operativos',
  wasteCents: 'Mermas',
  operatingResultCents: 'Resultado operativo',
  cashCollectedCents: 'Efectivo cobrado',
  cashRefundedCents: 'Efectivo devuelto',
  cashFlowInCents: 'Entradas de caja',
  cashFlowOutCents: 'Salidas de caja',
  pendingCostCents: 'Costo pendiente de clasificar',
  unvaluedDeliveredOrders: 'Pedidos sin costo histórico',
};
function ProfitabilityView({ enabled }: { enabled: boolean }) {
  const [from, setFrom] = useState(localDate(6));
  const [to, setTo] = useState(localDate());
  const [page, setPage] = useState(1);
  const [report, setReport] = useState<Profitability | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  async function load(nextPage = 1) {
    setLoading(true);
    setError('');
    try {
      const result = await request<Profitability>(
        `/api/v1/admin/reports/profitability?${new URLSearchParams({ from, to, page: String(nextPage), pageSize: '50' })}`,
      );
      setReport(result);
      setPage(nextPage);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo cargar el reporte.');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    if (enabled) void load();
  }, [enabled]);
  const csvUrl = `/api/v1/admin/reports/profitability.csv?${new URLSearchParams({ from, to })}`;
  return (
    <div className="settings-grid">
      <section className="admin-card">
        <p className="eyebrow">Rentabilidad · America/Mexico_City</p>
        <h2>Periodo del reporte</h2>
        <div className="form-row">
          <label>
            Desde
            <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
          </label>
          <label>
            Hasta
            <input type="date" value={to} onChange={(event) => setTo(event.target.value)} />
          </label>
          <button onClick={() => void load()}>Consultar</button>
          {report && (
            <a className="button secondary" href={csvUrl}>
              Descargar CSV completo
            </a>
          )}
        </div>
        {!enabled && (
          <p role="alert">
            Los reportes de rentabilidad están deshabilitados hasta activar la capacidad en el
            servidor.
          </p>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {loading && <p>Cargando corte consistente…</p>}
      </section>
      {report && (
        <>
          <section className="stats">
            {Object.entries(report.summary).map(([key, value]) => (
              <article key={key}>
                <span>{reportLabels[key] ?? key}</span>
                <strong>{key === 'deliveredOrders' ? value : formatMoney(value)}</strong>
              </article>
            ))}
          </section>
          <section className="admin-card">
            <h2>Detalle del periodo</h2>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Tipo</th>
                    <th>Descripción</th>
                    <th>Medio</th>
                    <th>Importe</th>
                    <th>Costo</th>
                  </tr>
                </thead>
                <tbody>
                  {report.rows.map((row) => (
                    <tr key={`${row.kind}-${row.id}`}>
                      <td>{formatDate(row.occurredAt)}</td>
                      <td>{row.kind}</td>
                      <td>
                        {row.description}
                        <br />
                        <small>{row.id}</small>
                      </td>
                      <td>{row.method || '—'}</td>
                      <td>{formatMoney(row.amountCents)}</td>
                      <td>{formatMoney(row.costCents)}</td>
                    </tr>
                  ))}
                  {!report.rows.length && (
                    <tr>
                      <td colSpan={6}>No hay movimientos en este periodo.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="form-row">
              <span>{report.totalRows} movimientos en el corte</span>
              <button
                className="secondary"
                disabled={page <= 1}
                onClick={() => void load(page - 1)}
              >
                Anterior
              </button>
              <span>Página {page}</span>
              <button
                className="secondary"
                disabled={page * report.pageSize >= report.totalRows}
                onClick={() => void load(page + 1)}
              >
                Siguiente
              </button>
            </div>
          </section>
          <section className="admin-card">
            <h2>Por modalidad y pago</h2>
            <div className="row-list">
              {report.byFulfillment.map((row) => (
                <p key={row.key}>
                  {row.key}: {row.orders} pedidos · {formatMoney(row.amountCents)}
                </p>
              ))}
              {report.byPayment.map((row) => (
                <p key={row.key}>
                  {row.key}: {formatMoney(row.amountCents)}
                </p>
              ))}
            </div>
          </section>
          <section className="admin-card">
            <h2>Por producto</h2>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Producto</th>
                    <th>Unidades</th>
                    <th>Importe de partidas</th>
                  </tr>
                </thead>
                <tbody>
                  {report.byProduct.map((row) => (
                    <tr key={row.key}>
                      <td>{row.key}</td>
                      <td>{row.quantity}</td>
                      <td>{formatMoney(row.amountCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

const capabilityLabels: Record<string, string> = {
  stock_ledger: 'Libro de inventario',
  purchasing: 'Compras y proveedores',
  recipe_versions: 'Recetas versionadas',
  production: 'Producción por lotes',
  unified_orders: 'Comandas unificadas',
  cash_sessions: 'Caja y turnos',
  payments_refunds: 'Pagos y devoluciones',
  pos_tickets: 'Tickets',
  expenses: 'Gastos',
  profitability_reports: 'Reportes de rentabilidad',
  pos_cutover: 'Corte irreversible del POS anterior',
};

function PosActivationView({
  csrf,
  onChanged,
}: {
  csrf: string;
  onChanged(key: string, enabled: boolean): void;
}) {
  const [data, setData] = useState<{
    capabilities: Array<{ key: string; enabled: boolean; updatedAt: string }>;
    legacyPendingOrders: number;
  }>();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  async function load() {
    setData(await request('/api/v1/admin/pos/capabilities'));
  }
  useEffect(() => {
    void load().catch((cause) =>
      setError(cause instanceof Error ? cause.message : 'No se pudo consultar el estado.'),
    );
  }, []);
  async function setEnabled(key: string, enabled: boolean) {
    if (note.trim().length < 8) {
      setError('Escribe una nota de al menos 8 caracteres.');
      return;
    }
    setBusy(key);
    setError('');
    try {
      await request(`/api/v1/admin/pos/capabilities/${key}`, {
        method: 'PUT',
        headers: { 'x-csrf-token': csrf },
        body: JSON.stringify({
          idempotencyKey: crypto.randomUUID(),
          enabled,
          activationNote: note.trim(),
        }),
      });
      await load();
      onChanged(key, enabled);
      setNote('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo cambiar la activación.');
    } finally {
      setBusy('');
    }
  }
  return (
    <div className="row-list">
      <section className="admin-card">
        <p className="eyebrow">Control de despliegue</p>
        <h2>Activación por etapas</h2>
        <p>
          Código integrado, función habilitada y versión desplegada son pasos distintos. Cada cambio
          queda ligado a tu sesión y a una nota de operación.
        </p>
        <p>
          Comandas antiguas pendientes: <strong>{data?.legacyPendingOrders ?? '—'}</strong>
        </p>
        <label>
          Nota del cambio
          <input
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Conciliación, fecha y responsable"
          />
        </label>
        {error ? (
          <p className="error" role="alert">
            {error}
          </p>
        ) : null}
      </section>
      {data?.capabilities.map((capability) => (
        <section className="admin-card section-heading" key={capability.key}>
          <div>
            <p className="eyebrow">{capability.enabled ? 'Habilitada' : 'Deshabilitada'}</p>
            <h2>{capabilityLabels[capability.key] ?? capability.key}</h2>
            <small>{formatDate(capability.updatedAt)}</small>
          </div>
          <button
            className={capability.enabled ? 'secondary' : 'primary'}
            disabled={
              busy === capability.key || (capability.key === 'pos_cutover' && capability.enabled)
            }
            onClick={() => void setEnabled(capability.key, !capability.enabled)}
          >
            {busy === capability.key
              ? 'Guardando…'
              : capability.enabled
                ? 'Deshabilitar'
                : 'Habilitar'}
          </button>
        </section>
      ))}
    </div>
  );
}

function Login({ onAuthenticated }: { onAuthenticated: (token: string) => void }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    const data = new FormData(event.currentTarget);
    try {
      const result = await request<{ csrfToken: string }>('/api/v1/admin/session', {
        method: 'POST',
        body: JSON.stringify({ email: data.get('email'), password: data.get('password') }),
      });
      onAuthenticated(result.csrfToken);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No fue posible iniciar sesión.');
      setBusy(false);
    }
  }
  return (
    <main className="login-shell">
      <section className="login-card">
        <div className="mini-logo">
          <span>♛</span>
          <strong>B&J</strong>
          <small>BURGERS</small>
        </div>
        <p className="eyebrow">Panel privado</p>
        <h1>Control del negocio</h1>
        <p>Actualiza el menú y la operación sin editar archivos.</p>
        <form onSubmit={login}>
          <label>
            Correo
            <input name="email" type="email" autoComplete="username" required />
          </label>
          <label>
            Contraseña
            <input name="password" type="password" autoComplete="current-password" required />
          </label>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button className="primary" disabled={busy}>
            {busy ? <LoaderCircle className="spin" /> : null}
            {busy ? 'Entrando…' : 'Entrar'}
          </button>
        </form>
      </section>
    </main>
  );
}

function EditableProduct({
  product,
  csrf,
  onSaved,
}: {
  product: ProductRow;
  csrf: string;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState(product);
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    await request(`/api/v1/admin/products/${draft.id}`, {
      method: 'PUT',
      headers: { 'x-csrf-token': csrf },
      body: JSON.stringify({
        id: draft.id,
        slug: draft.slug,
        categoryId: draft.category_id,
        name: draft.name,
        description: draft.description,
        priceCents: draft.price_cents,
        ingredients: draft.ingredients,
        removableIngredients: draft.removable_ingredients,
        comboEligible: draft.combo_eligible,
        featured: draft.featured,
        available: draft.available,
        order: draft.sort_order,
      }),
    });
    setBusy(false);
    onSaved();
  }
  return (
    <article className={`row-card ${draft.available ? '' : 'muted'}`}>
      <div className="row-main">
        <div>
          <strong>{draft.name}</strong>
          <small>{draft.description}</small>
        </div>
        <label className="money-input">
          <span>$</span>
          <input
            aria-label={`Precio de ${draft.name}`}
            type="number"
            min="0"
            step="1"
            value={draft.price_cents / 100}
            onChange={(event) =>
              setDraft({ ...draft, price_cents: Math.round(Number(event.target.value) * 100) })
            }
          />
        </label>
      </div>
      <div className="row-actions">
        <label className="switch">
          <input
            type="checkbox"
            checked={draft.available}
            onChange={(event) => setDraft({ ...draft, available: event.target.checked })}
          />
          <span />
          Disponible
        </label>
        <label className="switch">
          <input
            type="checkbox"
            checked={draft.featured}
            onChange={(event) => setDraft({ ...draft, featured: event.target.checked })}
          />
          <span />
          Destacado
        </label>
        <button
          className="icon-save"
          onClick={save}
          disabled={busy}
          aria-label={`Guardar ${draft.name}`}
        >
          <Save size={17} /> Guardar
        </button>
      </div>
      <details className="edit-details">
        <summary>Editar ficha completa</summary>
        <div className="edit-grid">
          <label>
            Nombre
            <input
              value={draft.name}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            />
          </label>
          <label className="full">
            Descripción
            <textarea
              value={draft.description}
              onChange={(event) => setDraft({ ...draft, description: event.target.value })}
            />
          </label>
          <label className="full">
            Ingredientes, separados por coma
            <textarea
              value={draft.ingredients.join(', ')}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  ingredients: event.target.value
                    .split(',')
                    .map((value) => value.trim())
                    .filter(Boolean),
                })
              }
            />
          </label>
          <label className="full">
            Ingredientes removibles, separados por coma
            <textarea
              value={draft.removable_ingredients.join(', ')}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  removable_ingredients: event.target.value
                    .split(',')
                    .map((value) => value.trim())
                    .filter(Boolean),
                })
              }
            />
          </label>
          <label className="switch">
            <input
              type="checkbox"
              checked={draft.combo_eligible}
              onChange={(event) => setDraft({ ...draft, combo_eligible: event.target.checked })}
            />
            <span /> Puede hacerse combo
          </label>
        </div>
      </details>
    </article>
  );
}

function CategoryEditor({
  category,
  csrf,
  onSaved,
}: {
  category: CategoryRow;
  csrf: string;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState(category);
  async function save() {
    await request(`/api/v1/admin/categories/${draft.id}`, {
      method: 'PUT',
      headers: { 'x-csrf-token': csrf },
      body: JSON.stringify({
        id: draft.id,
        slug: draft.slug,
        name: draft.name,
        description: draft.description,
        order: draft.sort_order,
        active: draft.active,
      }),
    });
    onSaved();
  }
  return (
    <details className="category-settings">
      <summary>Configurar categoría</summary>
      <div className="edit-grid">
        <label>
          Nombre
          <input
            value={draft.name}
            onChange={(event) => setDraft({ ...draft, name: event.target.value })}
          />
        </label>
        <label className="full">
          Descripción
          <input
            value={draft.description}
            onChange={(event) => setDraft({ ...draft, description: event.target.value })}
          />
        </label>
        <label className="switch">
          <input
            type="checkbox"
            checked={draft.active}
            onChange={(event) => setDraft({ ...draft, active: event.target.checked })}
          />
          <span /> Visible
        </label>
        <button className="icon-save" onClick={save}>
          <Save size={16} /> Guardar categoría
        </button>
      </div>
    </details>
  );
}

function EditableModifier({
  modifier,
  csrf,
  onSaved,
}: {
  modifier: ModifierRow;
  csrf: string;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState(modifier);
  async function save() {
    await request(`/api/v1/admin/modifiers/${draft.id}`, {
      method: 'PUT',
      headers: { 'x-csrf-token': csrf },
      body: JSON.stringify({
        id: draft.id,
        name: draft.name,
        priceCents: draft.price_cents,
        available: draft.available,
      }),
    });
    onSaved();
  }
  return (
    <article className="compact-row">
      <strong>{draft.name}</strong>
      <label className="money-input">
        <span>$</span>
        <input
          aria-label={`Precio de ${draft.name}`}
          type="number"
          min="0"
          value={draft.price_cents / 100}
          onChange={(event) =>
            setDraft({ ...draft, price_cents: Math.round(Number(event.target.value) * 100) })
          }
        />
      </label>
      <label className="switch">
        <input
          type="checkbox"
          checked={draft.available}
          onChange={(event) => setDraft({ ...draft, available: event.target.checked })}
        />
        <span />
        Activo
      </label>
      <button className="icon-save" onClick={save}>
        <Save size={16} /> Guardar
      </button>
    </article>
  );
}

function Promotions({
  rows,
  csrf,
  onSaved,
}: {
  rows: PromotionRow[];
  csrf: string;
  onSaved: () => void;
}) {
  const [drafts, setDrafts] = useState(rows);
  function update(index: number, patch: Partial<PromotionRow>) {
    setDrafts(drafts.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  }
  function updateRule(index: number, patch: Partial<PromotionRule>) {
    setDrafts(
      drafts.map((item, i) => (i === index ? { ...item, rule: { ...item.rule, ...patch } } : item)),
    );
  }
  async function save(promo: PromotionRow) {
    await request(`/api/v1/admin/promotions/${promo.id}`, {
      method: 'PUT',
      headers: { 'x-csrf-token': csrf },
      body: JSON.stringify({
        id: promo.id,
        name: promo.name,
        shortDescription: promo.short_description,
        daysOfWeek: promo.days_of_week,
        startsAt: promo.starts_at,
        endsAt: promo.ends_at,
        priority: promo.priority,
        active: promo.active,
        rule: promo.rule,
      }),
    });
    onSaved();
  }
  return (
    <div className="card-grid">
      {drafts.map((promo, index) => (
        <article className={`promo-admin ${promo.active ? '' : 'muted'}`} key={promo.id}>
          <div className="card-head">
            <span className="day-badge">
              {['DOM', 'LUN', 'MAR', 'MIÉ', 'JUE', 'VIE', 'SÁB'][promo.days_of_week[0] ?? 0]}
            </span>
            <label className="switch">
              <input
                type="checkbox"
                checked={promo.active}
                onChange={(event) =>
                  setDrafts(
                    drafts.map((item, i) =>
                      i === index ? { ...item, active: event.target.checked } : item,
                    ),
                  )
                }
              />
              <span />
              Activa
            </label>
          </div>
          <input
            className="title-input"
            value={promo.name}
            onChange={(event) =>
              setDrafts(
                drafts.map((item, i) =>
                  i === index ? { ...item, name: event.target.value } : item,
                ),
              )
            }
          />
          <textarea
            value={promo.short_description}
            onChange={(event) =>
              setDrafts(
                drafts.map((item, i) =>
                  i === index ? { ...item, short_description: event.target.value } : item,
                ),
              )
            }
          />
          <div className="rule-summary">
            Regla: {promo.rule.kind.replace('_', ' ')} · mínimo {promo.rule.requiredQuantity}
          </div>
          <details className="edit-details" open>
            <summary>Regla administrable</summary>
            <div className="rule-grid">
              <label>
                Día
                <select
                  value={promo.days_of_week[0]}
                  onChange={(event) =>
                    update(index, { days_of_week: [Number(event.target.value)] })
                  }
                >
                  {['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'].map(
                    (day, dayIndex) => (
                      <option key={day} value={dayIndex}>
                        {day}
                      </option>
                    ),
                  )}
                </select>
              </label>
              <label>
                Prioridad
                <input
                  type="number"
                  value={promo.priority}
                  onChange={(event) => update(index, { priority: Number(event.target.value) })}
                />
              </label>
              <label>
                Cantidad mínima
                <input
                  type="number"
                  min="1"
                  value={promo.rule.requiredQuantity}
                  onChange={(event) =>
                    updateRule(index, { requiredQuantity: Number(event.target.value) })
                  }
                />
              </label>
              {promo.rule.fixedPriceCents !== undefined && (
                <label>
                  Precio fijo ($)
                  <input
                    type="number"
                    min="0"
                    value={promo.rule.fixedPriceCents / 100}
                    onChange={(event) =>
                      updateRule(index, {
                        fixedPriceCents: Math.round(Number(event.target.value) * 100),
                      })
                    }
                  />
                </label>
              )}
              {promo.rule.unitPriceCents !== undefined && (
                <label>
                  Precio unitario ($)
                  <input
                    type="number"
                    min="0"
                    value={promo.rule.unitPriceCents / 100}
                    onChange={(event) =>
                      updateRule(index, {
                        unitPriceCents: Math.round(Number(event.target.value) * 100),
                      })
                    }
                  />
                </label>
              )}
              {promo.rule.freeQuantity !== undefined && (
                <label>
                  Productos gratis
                  <input
                    type="number"
                    min="0"
                    value={promo.rule.freeQuantity}
                    onChange={(event) =>
                      updateRule(index, { freeQuantity: Number(event.target.value) })
                    }
                  />
                </label>
              )}
            </div>
          </details>
          <button className="icon-save" onClick={() => save(promo)}>
            <Save size={17} /> Guardar promoción
          </button>
        </article>
      ))}
    </div>
  );
}

function BusinessEditor({
  value,
  csrf,
  onSaved,
}: {
  value: BusinessSettings;
  csrf: string;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState(value);
  const days = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
  async function save() {
    await request('/api/v1/admin/business', {
      method: 'PUT',
      headers: { 'x-csrf-token': csrf },
      body: JSON.stringify({ ...draft, updatedAt: new Date().toISOString() }),
    });
    onSaved();
  }
  return (
    <div className="settings-grid">
      <section className="admin-card">
        <h2>Estado del servicio</h2>
        <label className="switch prominent">
          <input
            type="checkbox"
            checked={draft.temporarilyClosed}
            onChange={(event) => setDraft({ ...draft, temporarilyClosed: event.target.checked })}
          />
          <span />
          Cierre extraordinario
        </label>
        <label>
          Mensaje visible
          <textarea
            value={draft.closureMessage}
            onChange={(event) => setDraft({ ...draft, closureMessage: event.target.value })}
          />
        </label>
        <label>
          Zona con entrega gratis
          <input
            value={draft.freeDeliveryArea}
            onChange={(event) => setDraft({ ...draft, freeDeliveryArea: event.target.value })}
          />
        </label>
        <label>
          Aviso de cobertura
          <textarea
            value={draft.deliveryNotice}
            onChange={(event) => setDraft({ ...draft, deliveryNotice: event.target.value })}
          />
        </label>
      </section>
      <section className="admin-card">
        <h2>Horario semanal</h2>
        <div className="schedule-list">
          {draft.schedule.map((slot, index) => (
            <div className="schedule-row" key={slot.dayOfWeek}>
              <strong>{days[slot.dayOfWeek]}</strong>
              <input
                type="time"
                value={slot.opens}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    schedule: draft.schedule.map((item, i) =>
                      i === index ? { ...item, opens: event.target.value } : item,
                    ),
                  })
                }
              />
              <span>a</span>
              <input
                type="time"
                value={slot.closes}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    schedule: draft.schedule.map((item, i) =>
                      i === index ? { ...item, closes: event.target.value } : item,
                    ),
                  })
                }
              />
            </div>
          ))}
        </div>
      </section>
      <button className="primary wide" onClick={save}>
        <Save size={18} /> Guardar operación
      </button>
    </div>
  );
}

function Roulette({
  prizes,
  redemptions,
  csrf,
  onSaved,
}: {
  prizes: PrizeRow[];
  redemptions: RedemptionRow[];
  csrf: string;
  onSaved: () => void;
}) {
  const [drafts, setDrafts] = useState(prizes);
  async function save(prize: PrizeRow) {
    await request(`/api/v1/admin/prizes/${prize.id}`, {
      method: 'PUT',
      headers: { 'x-csrf-token': csrf },
      body: JSON.stringify({
        label: prize.label,
        emoji: prize.emoji,
        weight: prize.weight,
        active: prize.active,
        inventory: prize.inventory,
        targetSegments: prize.target_segments,
      }),
    });
    onSaved();
  }
  return (
    <div className="roulette-admin">
      <section>
        <div className="section-heading">
          <div>
            <p className="eyebrow">Configuración protegida</p>
            <h2>Premios y probabilidades</h2>
          </div>
          <p>El peso y el inventario nunca se envían a la web pública.</p>
        </div>
        <div className="prize-list">
          {drafts.map((prize, index) => (
            <article className="prize-row" key={prize.id}>
              <span className="emoji">{prize.emoji}</span>
              <input
                aria-label="Nombre del premio"
                value={prize.label}
                onChange={(event) =>
                  setDrafts(
                    drafts.map((item, i) =>
                      i === index ? { ...item, label: event.target.value } : item,
                    ),
                  )
                }
              />
              <label>
                Peso
                <input
                  type="number"
                  min="0"
                  value={prize.weight}
                  onChange={(event) =>
                    setDrafts(
                      drafts.map((item, i) =>
                        i === index ? { ...item, weight: Number(event.target.value) } : item,
                      ),
                    )
                  }
                />
              </label>
              <label>
                Inventario
                <input
                  type="number"
                  min="0"
                  placeholder="∞"
                  value={prize.inventory ?? ''}
                  onChange={(event) =>
                    setDrafts(
                      drafts.map((item, i) =>
                        i === index
                          ? {
                              ...item,
                              inventory:
                                event.target.value === '' ? null : Number(event.target.value),
                            }
                          : item,
                      ),
                    )
                  }
                />
              </label>
              <label className="switch">
                <input
                  type="checkbox"
                  checked={prize.active}
                  onChange={(event) =>
                    setDrafts(
                      drafts.map((item, i) =>
                        i === index ? { ...item, active: event.target.checked } : item,
                      ),
                    )
                  }
                />
                <span />
                Activo
              </label>
              <button className="icon-save" onClick={() => save(prize)}>
                <Save size={16} />
              </button>
            </article>
          ))}
        </div>
      </section>
      <section className="admin-card">
        <h2>Canjes recientes</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Código</th>
                <th>Premio</th>
                <th>Saldo</th>
              </tr>
            </thead>
            <tbody>
              {redemptions.length ? (
                redemptions.map((row) => (
                  <tr key={row.id}>
                    <td>{formatDate(row.created_at)}</td>
                    <td>••••{row.code_hint}</td>
                    <td>
                      {row.emoji} {row.prize_label}
                    </td>
                    <td>{row.remaining_spins}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={4}>Todavía no hay canjes.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Devices({
  devices,
  csrf,
  onSaved,
}: {
  devices: DeviceRow[];
  csrf: string;
  onSaved: () => void;
}) {
  const [name, setName] = useState('Android operación');
  const [pairing, setPairing] = useState<{ id: string; code: string; expiresAt: string } | null>(
    null,
  );
  const [error, setError] = useState('');
  async function create() {
    setError('');
    try {
      const result = await request<{
        device: { id: string; pairingExpiresAt: string };
        pairingCode: string;
      }>('/api/v1/admin/devices', {
        method: 'POST',
        headers: { 'x-csrf-token': csrf },
        body: JSON.stringify({ name }),
      });
      setPairing({
        id: result.device.id,
        code: result.pairingCode,
        expiresAt: result.device.pairingExpiresAt,
      });
      onSaved();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No fue posible crear el dispositivo.');
    }
  }
  async function revoke(id: string) {
    if (!window.confirm('¿Revocar este dispositivo? La app dejará de poder operar inmediatamente.'))
      return;
    setError('');
    try {
      await request(`/api/v1/admin/devices/${id}`, {
        method: 'DELETE',
        headers: { 'x-csrf-token': csrf },
      });
      onSaved();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No fue posible revocar el dispositivo.');
    }
  }
  return (
    <div className="devices-admin">
      <section className="admin-card">
        <p className="eyebrow">Vinculación segura</p>
        <h2>Nuevo Android operativo</h2>
        <p>
          La aplicación abre directamente, pero este código de un solo uso autoriza el equipo ante
          la API.
        </p>
        <div className="inline-form">
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            aria-label="Nombre del dispositivo"
          />
          <button className="primary" onClick={create}>
            Crear código
          </button>
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {pairing && (
          <div className="pairing-code" role="status">
            <strong>Código de vinculación</strong>
            <code>{pairing.code}</code>
            <small>
              Dispositivo: {pairing.id}
              <br />
              Vence: {formatDate(pairing.expiresAt)}. Se muestra una sola vez.
            </small>
          </div>
        )}
      </section>
      <section className="admin-card">
        <h2>Equipos vinculados</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Equipo</th>
                <th>Estado</th>
                <th>Última actividad</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {devices.length ? (
                devices.map((device) => (
                  <tr key={device.id}>
                    <td>
                      {device.name}
                      <br />
                      <small>{device.id}</small>
                    </td>
                    <td>
                      {device.active
                        ? device.pairing_used_at
                          ? 'Vinculado'
                          : 'Pendiente'
                        : 'Revocado'}
                    </td>
                    <td>{device.last_seen_at ? formatDate(device.last_seen_at) : '—'}</td>
                    <td>
                      {device.active && (
                        <button className="secondary" onClick={() => revoke(device.id)}>
                          Revocar
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={4}>Todavía no hay dispositivos operativos.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

export default function App() {
  const [csrf, setCsrf] = useState('');
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [inventoryLedger, setInventoryLedger] = useState<StockLedgerState | null>(null);
  const [purchasing, setPurchasing] = useState<Purchasing | null>(null);
  const [recipeVersions, setRecipeVersions] = useState<RecipeVersions | null>(null);
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [featureCaps, setFeatureCaps] = useState<Record<string, boolean>>({});
  const [tab, setTab] = useState<Tab>('overview');
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState('');
  async function load(showNotice = false) {
    const [data, ledger, purchasingData, recipeVersionsData, ordersData, capabilityData] =
      await Promise.all([
        request<Dashboard>('/api/v1/admin/dashboard'),
        request<StockLedgerState>('/api/v1/admin/inventory/ledger'),
        request<Purchasing>('/api/v1/admin/purchasing'),
        request<RecipeVersions>('/api/v1/admin/recipes/versions'),
        request<{ orders: Order[] }>('/api/v1/admin/orders'),
        request<{ capabilities: Array<{ key: string; enabled: boolean }> }>(
          '/api/v1/admin/pos/capabilities',
        ),
      ]);
    setDashboard(data);
    setInventoryLedger(ledger);
    setPurchasing(purchasingData);
    setRecipeVersions(recipeVersionsData);
    setOrders(ordersData.orders);
    setFeatureCaps(
      Object.fromEntries(capabilityData.capabilities.map((item) => [item.key, item.enabled])),
    );
    if (showNotice) {
      setNotice('Cambios guardados. La web pública se actualizará automáticamente.');
      window.setTimeout(() => setNotice(''), 4000);
    }
  }
  useEffect(() => {
    request<{ csrfToken: string }>('/api/v1/admin/session')
      .then((session) => {
        setCsrf(session.csrfToken);
        return load();
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    if (!csrf) return;
    const stream = new EventSource('/api/v1/admin/orders/stream', { withCredentials: true });
    const refreshOrders = () => {
      void request<{ orders: Order[] }>('/api/v1/admin/orders')
        .then((result) => setOrders(result.orders))
        .catch(() => {});
    };
    stream.addEventListener('order', refreshOrders);
    return () => stream.close();
  }, [csrf]);
  async function logout() {
    await request('/api/v1/admin/session', { method: 'DELETE' });
    setCsrf('');
    setDashboard(null);
  }
  if (loading)
    return (
      <main className="loading">
        <LoaderCircle className="spin" />
        <span>Cargando panel…</span>
      </main>
    );
  if (!csrf || !dashboard)
    return (
      <Login
        onAuthenticated={(token) => {
          setCsrf(token);
          setLoading(true);
          load().finally(() => setLoading(false));
        }}
      />
    );
  const unavailable = dashboard.products.filter((item) => !item.available).length;
  return (
    <div className="app-shell">
      <aside>
        <div className="brand">
          <div className="brand-mark">B&J</div>
          <div>
            <strong>B&J Burgers</strong>
            <small>Administración</small>
          </div>
        </div>
        <nav aria-label="Panel">
          {tabItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                className={tab === item.id ? 'active' : ''}
                onClick={() => setTab(item.id)}
                key={item.id}
              >
                <Icon size={19} />
                {item.label}
              </button>
            );
          })}
        </nav>
        <button className="logout" onClick={logout}>
          <LogOut size={18} />
          Cerrar sesión
        </button>
      </aside>
      <main className="dashboard">
        <header>
          <div>
            <p className="eyebrow">Operación en tiempo real</p>
            <h1>{tabItems.find((item) => item.id === tab)?.label}</h1>
          </div>
          <a href="/" target="_blank" rel="noreferrer">
            Ver sitio ↗
          </a>
        </header>
        {notice && (
          <div className="notice" role="status">
            {notice}
          </div>
        )}
        {tab === 'overview' && (
          <>
            <div className="stats">
              <article>
                <ShoppingBag />
                <span>Productos</span>
                <strong>{dashboard.products.length}</strong>
                <small>{unavailable} no disponibles</small>
              </article>
              <article>
                <Tags />
                <span>Promociones activas</span>
                <strong>{dashboard.promotions.filter((item) => item.active).length}</strong>
                <small>de {dashboard.promotions.length} configuradas</small>
              </article>
              <article>
                <Gift />
                <span>Canjes registrados</span>
                <strong>{dashboard.redemptions.length}</strong>
                <small>últimos 100 movimientos</small>
              </article>
              <article>
                <BadgeDollarSign />
                <span>Ticket de referencia</span>
                <strong>{formatMoney(11500)}</strong>
                <small>combo Clásica</small>
              </article>
            </div>
            <section className="admin-card welcome">
              <div>
                <p className="eyebrow">Estado actual</p>
                <h2>
                  {dashboard.business.data.temporarilyClosed
                    ? dashboard.business.data.closureMessage
                    : 'El negocio está operando con su horario normal'}
                </h2>
                <p>Última actualización: {formatDate(dashboard.business.updated_at)}</p>
              </div>
              <button className="secondary" onClick={() => setTab('business')}>
                Cambiar estado
              </button>
            </section>
          </>
        )}
        {tab === 'menu' && (
          <div>
            {dashboard.categories.map((category) => (
              <section className="menu-section" key={category.id}>
                <div className="section-heading">
                  <div>
                    <p className="eyebrow">Categoría</p>
                    <h2>{category.name}</h2>
                  </div>
                  <p>{category.description}</p>
                </div>
                <CategoryEditor category={category} csrf={csrf} onSaved={() => load(true)} />
                <div className="row-list">
                  {dashboard.products
                    .filter((product) => product.category_id === category.id)
                    .map((product) => (
                      <EditableProduct
                        key={product.id}
                        product={product}
                        csrf={csrf}
                        onSaved={() => load(true)}
                      />
                    ))}
                </div>
              </section>
            ))}
            <section className="menu-section">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">Personalización</p>
                  <h2>Extras</h2>
                </div>
                <p>Disponibilidad y precio individual.</p>
              </div>
              <div className="row-list">
                {dashboard.modifiers.map((modifier) => (
                  <EditableModifier
                    key={modifier.id}
                    modifier={modifier}
                    csrf={csrf}
                    onSaved={() => load(true)}
                  />
                ))}
              </div>
            </section>
          </div>
        )}
        {tab === 'promotions' && (
          <Promotions rows={dashboard.promotions} csrf={csrf} onSaved={() => load(true)} />
        )}
        {tab === 'business' && (
          <BusinessEditor value={dashboard.business.data} csrf={csrf} onSaved={() => load(true)} />
        )}
        {tab === 'inventory' && <InventoryLedger data={inventoryLedger} />}
        {tab === 'recipes' && (
          <RecipeVersionsView
            data={recipeVersions}
            products={dashboard.products}
            ingredients={inventoryLedger?.ingredients ?? []}
            modifiers={dashboard.modifiers}
            csrf={csrf}
            onSaved={() => load(true)}
          />
        )}
        {tab === 'purchasing' && <PurchasingView data={purchasing} />}
        {tab === 'orders' && (
          <OrdersView
            orders={orders}
            csrf={csrf}
            capabilities={featureCaps}
            onSaved={() => void load()}
          />
        )}
        {tab === 'pos' && (
          <AdminPos
            csrf={csrf}
            enabled={featureCaps.unified_orders === true}
            onCreated={() => void load()}
          />
        )}
        {tab === 'expenses' && (
          <ExpensesView
            csrf={csrf}
            enabled={featureCaps.expenses === true}
            onSaved={() => void load()}
          />
        )}
        {tab === 'cash' && <CashView csrf={csrf} enabled={featureCaps.cash_sessions === true} />}
        {tab === 'activation' && (
          <PosActivationView
            csrf={csrf}
            onChanged={(key, enabled) =>
              setFeatureCaps((current) => ({ ...current, [key]: enabled }))
            }
          />
        )}
        {tab === 'reports' && (
          <ProfitabilityView enabled={featureCaps.profitability_reports === true} />
        )}
        {tab === 'roulette' && (
          <Roulette
            prizes={dashboard.prizes}
            redemptions={dashboard.redemptions}
            csrf={csrf}
            onSaved={() => load(true)}
          />
        )}
        {tab === 'devices' && (
          <Devices devices={dashboard.devices} csrf={csrf} onSaved={() => load(true)} />
        )}
      </main>
    </div>
  );
}

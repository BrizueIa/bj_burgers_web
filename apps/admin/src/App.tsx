import { useEffect, useState, type FormEvent } from 'react';
import {
  BadgeDollarSign,
  Clock3,
  Gift,
  LayoutDashboard,
  LoaderCircle,
  LogOut,
  Save,
  ShoppingBag,
  Smartphone,
  Tags,
} from 'lucide-react';
import type { BusinessSettings, PromotionRule } from '@bj/contracts';

type Tab = 'overview' | 'menu' | 'promotions' | 'business' | 'roulette' | 'devices';
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
    throw new Error(
      typeof body.message === 'string' ? body.message : 'No fue posible completar la operación.',
    );
  return body as T;
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
  const [tab, setTab] = useState<Tab>('overview');
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState('');
  async function load(showNotice = false) {
    const data = await request<Dashboard>('/api/v1/admin/dashboard');
    setDashboard(data);
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

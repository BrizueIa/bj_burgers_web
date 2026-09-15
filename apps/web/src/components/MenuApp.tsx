import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronRight, Minus, Plus, ShoppingBag, X } from 'lucide-react';
import {
  buildWhatsAppMessage,
  calculateCart,
  catalogSchema,
  formatMoney,
  type CartItem,
  type Catalog,
  type DeliveryDetails,
  type Product,
} from '@bj/contracts';

interface Props {
  initialCatalog: Catalog;
  apiBaseUrl: string;
}

const emptyDelivery: DeliveryDetails = {
  customerName: '',
  neighborhood: '',
  streetAndNumber: '',
  references: '',
  deliveryNotes: '',
};

export default function MenuApp({ initialCatalog, apiBaseUrl }: Props) {
  const [catalog, setCatalog] = useState(initialCatalog);
  const [items, setItems] = useState<CartItem[]>([]);
  const [selected, setSelected] = useState<Product | null>(null);
  const [cartOpen, setCartOpen] = useState(false);
  const [delivery, setDelivery] = useState(emptyDelivery);
  const [catalogVerified, setCatalogVerified] = useState(false);
  const [cartReady, setCartReady] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cartCloseRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${apiBaseUrl}/catalog`, { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error('catalog'))))
      .then((data) => {
        setCatalog(catalogSchema.parse(data));
        setCatalogVerified(true);
      })
      .catch(() => setCatalogVerified(false));
    return () => controller.abort();
  }, [apiBaseUrl]);

  useEffect(() => {
    if (selected) dialogRef.current?.showModal();
    else dialogRef.current?.close();
  }, [selected]);

  useEffect(() => {
    try {
      const saved = window.sessionStorage.getItem('bj-cart');
      if (saved) setItems(JSON.parse(saved) as CartItem[]);
    } catch {
      /* Una sesión dañada no debe impedir ordenar. */
    }
    setCartReady(true);
  }, []);

  useEffect(() => {
    if (cartReady) window.sessionStorage.setItem('bj-cart', JSON.stringify(items));
  }, [cartReady, items]);

  useEffect(() => {
    if (!cartOpen) return;
    cartCloseRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setCartOpen(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [cartOpen]);

  const totals = useMemo(() => calculateCart(catalog, items), [catalog, items]);
  const count = items.reduce((sum, item) => sum + item.quantity, 0);
  const drinks = catalog.products.filter(
    (product) => product.categoryId === 'drinks' && product.available,
  );

  function addItem(item: Omit<CartItem, 'id'>) {
    setItems((current) => [...current, { ...item, id: crypto.randomUUID() }]);
    setSelected(null);
    setCartOpen(true);
  }

  function updateQuantity(id: string, delta: number) {
    setItems((current) =>
      current.flatMap((item) => {
        if (item.id !== id) return [item];
        const quantity = item.quantity + delta;
        return quantity > 0 ? [{ ...item, quantity }] : [];
      }),
    );
  }

  function sendOrder(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!items.length) return;
    const message = buildWhatsAppMessage(catalog, items, delivery);
    window.open(
      `https://wa.me/${catalog.business.whatsappNumber}?text=${encodeURIComponent(message)}`,
      '_blank',
      'noopener,noreferrer',
    );
  }

  return (
    <div className="menu-app" id="ordenar">
      {catalog.business.temporarilyClosed && (
        <div className="closure-banner" role="alert">
          <strong>Servicio pausado</strong>
          <span>{catalog.business.closureMessage}</span>
        </div>
      )}
      <div className="catalog-status" role="status">
        <span className={catalogVerified ? 'status-dot online' : 'status-dot'} />
        {catalogVerified ? 'Menú actualizado' : 'Mostrando la última versión disponible'}
      </div>

      <nav className="category-nav" aria-label="Categorías del menú">
        {catalog.categories
          .filter((category) => category.active)
          .map((category) => (
            <a key={category.id} href={`#categoria-${category.slug}`}>
              {category.name}
            </a>
          ))}
      </nav>

      {catalog.categories
        .filter((category) => category.active)
        .map((category) => {
          const products = catalog.products.filter((product) => product.categoryId === category.id);
          return (
            <section
              className="catalog-section"
              id={`categoria-${category.slug}`}
              key={category.id}
            >
              <header>
                <p className="eyebrow">{String(category.order).padStart(2, '0')}</p>
                <h2>{category.name}</h2>
                <p>{category.description}</p>
              </header>
              <div className="product-grid">
                {products.map((product) => (
                  <article
                    className={`product-card ${product.featured ? 'featured' : ''} ${!product.available ? 'unavailable' : ''}`}
                    id={product.id}
                    key={product.id}
                  >
                    <div className="product-top">
                      <span>{product.featured ? 'Favorito B&J' : category.name}</span>
                      <strong>{formatMoney(product.priceCents)}</strong>
                    </div>
                    <h3>{product.name}</h3>
                    <p>{product.description}</p>
                    <button
                      type="button"
                      disabled={!product.available}
                      onClick={() => setSelected(product)}
                    >
                      {product.available ? 'Personalizar' : 'No disponible'}{' '}
                      <ChevronRight aria-hidden="true" size={18} />
                    </button>
                  </article>
                ))}
              </div>
            </section>
          );
        })}

      <section className="extras-board">
        <header>
          <p className="eyebrow">Extras</p>
          <h2>Hazla a tu manera</h2>
        </header>
        <div>
          {catalog.modifiers
            .filter((modifier) => modifier.available)
            .map((modifier) => (
              <p key={modifier.id}>
                <span>{modifier.name}</span>
                <strong>{formatMoney(modifier.priceCents)}</strong>
              </p>
            ))}
        </div>
      </section>

      <button
        className="floating-cart"
        type="button"
        onClick={() => setCartOpen(true)}
        aria-label={`Abrir pedido, ${count} productos`}
      >
        <ShoppingBag aria-hidden="true" />{' '}
        <span>{count ? `${count} · ${formatMoney(totals.totalCents)}` : 'Tu pedido'}</span>
      </button>

      {selected && (
        <ProductDialog
          ref={dialogRef}
          product={selected}
          catalog={catalog}
          drinks={drinks}
          onClose={() => setSelected(null)}
          onAdd={addItem}
        />
      )}

      {cartOpen && (
        <div
          className="drawer-backdrop"
          role="presentation"
          onMouseDown={(event) => event.target === event.currentTarget && setCartOpen(false)}
        >
          <aside
            className="cart-drawer"
            role="dialog"
            aria-modal="true"
            aria-labelledby="cart-title"
          >
            <header>
              <div>
                <p className="eyebrow">Entrega a domicilio</p>
                <h2 id="cart-title">Tu pedido</h2>
              </div>
              <button
                ref={cartCloseRef}
                className="icon-button"
                type="button"
                onClick={() => setCartOpen(false)}
                aria-label="Cerrar pedido"
              >
                <X />
              </button>
            </header>
            {!items.length ? (
              <div className="empty-cart">
                <ShoppingBag aria-hidden="true" />
                <h3>Tu bolsa está vacía</h3>
                <p>Agrega algo bueno del menú para comenzar.</p>
                <button type="button" onClick={() => setCartOpen(false)}>
                  Volver al menú
                </button>
              </div>
            ) : (
              <form onSubmit={sendOrder}>
                <div className="cart-lines">
                  {items.map((item) => {
                    const product = catalog.products.find((entry) => entry.id === item.productId);
                    if (!product) return null;
                    return (
                      <article className="cart-line" key={item.id}>
                        <div>
                          <h3>{product.name}</h3>
                          <p>
                            {item.combo ? 'Combo · ' : ''}
                            {item.modifierIds.length
                              ? `${item.modifierIds.length} extra(s)`
                              : 'Sin extras'}
                          </p>
                        </div>
                        <div className="quantity">
                          <button
                            type="button"
                            onClick={() => updateQuantity(item.id, -1)}
                            aria-label={`Quitar una unidad de ${product.name}`}
                          >
                            <Minus size={15} />
                          </button>
                          <span>{item.quantity}</span>
                          <button
                            type="button"
                            onClick={() => updateQuantity(item.id, 1)}
                            aria-label={`Agregar una unidad de ${product.name}`}
                          >
                            <Plus size={15} />
                          </button>
                        </div>
                      </article>
                    );
                  })}
                </div>

                {totals.promotion && (
                  <div className="applied-promo">
                    <Check aria-hidden="true" />
                    <div>
                      <strong>{totals.promotion.name}</strong>
                      {totals.promotion.freeItems.map((free) => (
                        <span key={free}>{free}</span>
                      ))}
                      {totals.discountCents > 0 && (
                        <span>Ahorras {formatMoney(totals.discountCents)}</span>
                      )}
                    </div>
                  </div>
                )}
                <div className="cart-total">
                  <span>Subtotal</span>
                  <strong>{formatMoney(totals.totalCents)}</strong>
                  <small>Entrega gratis en Canarios. Otras zonas por confirmar.</small>
                </div>

                <fieldset className="delivery-fields">
                  <legend>Datos de entrega</legend>
                  <label>
                    Nombre
                    <input
                      required
                      value={delivery.customerName}
                      onChange={(event) =>
                        setDelivery({ ...delivery, customerName: event.target.value })
                      }
                      autoComplete="name"
                    />
                  </label>
                  <label>
                    Colonia
                    <input
                      required
                      value={delivery.neighborhood}
                      onChange={(event) =>
                        setDelivery({ ...delivery, neighborhood: event.target.value })
                      }
                    />
                  </label>
                  <label>
                    Calle y número
                    <input
                      required
                      value={delivery.streetAndNumber}
                      onChange={(event) =>
                        setDelivery({ ...delivery, streetAndNumber: event.target.value })
                      }
                      autoComplete="street-address"
                    />
                  </label>
                  <label>
                    Referencias
                    <input
                      value={delivery.references}
                      onChange={(event) =>
                        setDelivery({ ...delivery, references: event.target.value })
                      }
                    />
                  </label>
                  <label>
                    Indicaciones
                    <textarea
                      value={delivery.deliveryNotes}
                      onChange={(event) =>
                        setDelivery({ ...delivery, deliveryNotes: event.target.value })
                      }
                      rows={2}
                    />
                  </label>
                </fieldset>
                {!catalogVerified && (
                  <p className="verification-note">
                    Confirmaremos disponibilidad y precios al recibir tu mensaje.
                  </p>
                )}
                <button
                  className="checkout-button"
                  type="submit"
                  disabled={catalog.business.temporarilyClosed}
                >
                  {catalog.business.temporarilyClosed
                    ? 'Servicio no disponible'
                    : 'Enviar pedido por WhatsApp'}
                </button>
              </form>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}

interface ProductDialogProps {
  product: Product;
  catalog: Catalog;
  drinks: Product[];
  onClose: () => void;
  onAdd: (item: Omit<CartItem, 'id'>) => void;
}

import { forwardRef } from 'react';

const ProductDialog = forwardRef<HTMLDialogElement, ProductDialogProps>(function ProductDialog(
  { product, catalog, drinks, onClose, onAdd },
  ref,
) {
  const [removed, setRemoved] = useState<string[]>([]);
  const [extras, setExtras] = useState<string[]>([]);
  const [combo, setCombo] = useState(false);
  const [drink, setDrink] = useState(drinks[0]?.id ?? '');
  const [note, setNote] = useState('');

  function toggle(value: string, current: string[], set: (next: string[]) => void) {
    set(current.includes(value) ? current.filter((entry) => entry !== value) : [...current, value]);
  }

  return (
    <dialog
      className="product-dialog"
      ref={ref}
      onClose={onClose}
      onCancel={onClose}
      aria-labelledby="product-dialog-title"
    >
      <form method="dialog" className="dialog-close-form">
        <button className="icon-button" aria-label="Cerrar">
          <X />
        </button>
      </form>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onAdd({
            productId: product.id,
            quantity: 1,
            removedIngredients: removed,
            modifierIds: extras,
            combo,
            ...(combo && drink ? { drinkProductId: drink } : {}),
            note,
          });
        }}
      >
        <p className="eyebrow">Personaliza tu orden</p>
        <h2 id="product-dialog-title">{product.name}</h2>
        <p>{product.description}</p>
        {product.removableIngredients.length > 0 && (
          <fieldset>
            <legend>¿Algo que quieras quitar?</legend>
            <div className="choice-grid">
              {product.removableIngredients.map((ingredient) => (
                <label key={ingredient}>
                  <input
                    type="checkbox"
                    checked={removed.includes(ingredient)}
                    onChange={() => toggle(ingredient, removed, setRemoved)}
                  />
                  <span>Sin {ingredient}</span>
                </label>
              ))}
            </div>
          </fieldset>
        )}
        {(product.categoryId === 'burgers' || product.categoryId === 'dogs') && (
          <fieldset>
            <legend>Agrega extras</legend>
            <div className="choice-grid">
              {catalog.modifiers
                .filter((modifier) => modifier.available)
                .map((modifier) => (
                  <label key={modifier.id}>
                    <input
                      type="checkbox"
                      checked={extras.includes(modifier.id)}
                      onChange={() => toggle(modifier.id, extras, setExtras)}
                    />
                    <span>
                      {modifier.name} <small>+{formatMoney(modifier.priceCents)}</small>
                    </span>
                  </label>
                ))}
            </div>
          </fieldset>
        )}
        {product.comboEligible && (
          <fieldset>
            <legend>Hazlo combo</legend>
            <label className="combo-choice">
              <input
                type="checkbox"
                checked={combo}
                onChange={(event) => setCombo(event.target.checked)}
              />
              <span>
                <strong>Combo +$46</strong>
                <small>Papas 100 g + refresco</small>
              </span>
            </label>
            {combo && (
              <label className="select-label">
                Elige tu refresco
                <select required value={drink} onChange={(event) => setDrink(event.target.value)}>
                  {drinks.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </fieldset>
        )}
        <label className="note-label">
          Nota para este producto
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            maxLength={180}
            rows={2}
            placeholder="Ej. bien doradita"
          />
        </label>
        <button className="checkout-button" type="submit">
          Agregar ·{' '}
          {formatMoney(
            product.priceCents +
              extras.reduce(
                (sum, id) =>
                  sum + (catalog.modifiers.find((modifier) => modifier.id === id)?.priceCents ?? 0),
                0,
              ) +
              (combo ? 4600 : 0),
          )}
        </button>
      </form>
    </dialog>
  );
});

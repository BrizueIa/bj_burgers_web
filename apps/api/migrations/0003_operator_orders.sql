CREATE TABLE IF NOT EXISTS mobile_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  token_digest text UNIQUE,
  pairing_digest text UNIQUE,
  pairing_expires_at timestamptz,
  pairing_used_at timestamptz,
  active boolean NOT NULL DEFAULT true,
  created_by_user_id uuid REFERENCES admin_users(id),
  last_seen_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL DEFAULT 'manual_whatsapp' CHECK (source IN ('manual_whatsapp', 'whatsapp_ai')),
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'preparing', 'ready', 'out_for_delivery', 'delivered', 'cancelled')),
  customer_name text NOT NULL,
  neighborhood text NOT NULL DEFAULT '',
  street_and_number text NOT NULL DEFAULT '',
  delivery_references text NOT NULL DEFAULT '',
  delivery_notes text NOT NULL DEFAULT '',
  raw_message text NOT NULL DEFAULT '',
  promotion_snapshot jsonb,
  subtotal_cents integer NOT NULL CHECK (subtotal_cents >= 0),
  delivery_cents integer NOT NULL DEFAULT 0 CHECK (delivery_cents >= 0),
  total_cents integer NOT NULL CHECK (total_cents >= 0),
  idempotency_key uuid NOT NULL UNIQUE,
  created_by_device_id uuid REFERENCES mobile_devices(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id text NOT NULL REFERENCES products(id),
  product_name text NOT NULL,
  unit_price_cents integer NOT NULL CHECK (unit_price_cents >= 0),
  quantity integer NOT NULL CHECK (quantity > 0),
  removed_ingredients jsonb NOT NULL DEFAULT '[]',
  modifiers jsonb NOT NULL DEFAULT '[]',
  combo jsonb,
  note text NOT NULL DEFAULT '',
  line_total_cents integer NOT NULL CHECK (line_total_cents >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS order_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  status text,
  note text NOT NULL DEFAULT '',
  device_id uuid REFERENCES mobile_devices(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE spin_codes ADD COLUMN IF NOT EXISTS order_id uuid REFERENCES orders(id);
ALTER TABLE spin_codes ADD COLUMN IF NOT EXISTS issued_by_device_id uuid REFERENCES mobile_devices(id);
ALTER TABLE spin_codes ADD COLUMN IF NOT EXISTS issue_idempotency_key uuid;
ALTER TABLE spin_codes ADD COLUMN IF NOT EXISTS issued_code_ciphertext text;

CREATE UNIQUE INDEX IF NOT EXISTS spin_codes_order_unique ON spin_codes(order_id) WHERE order_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS spin_codes_issue_idempotency_unique ON spin_codes(issue_idempotency_key) WHERE issue_idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS orders_status_created_idx ON orders(status, created_at DESC);
CREATE INDEX IF NOT EXISTS order_items_order_idx ON order_items(order_id);
CREATE INDEX IF NOT EXISTS order_events_order_idx ON order_events(order_id, created_at ASC);
CREATE INDEX IF NOT EXISTS mobile_devices_active_idx ON mobile_devices(active) WHERE active = true;

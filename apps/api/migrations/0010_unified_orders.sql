-- One order is the durable sale record. Existing WhatsApp orders remain readable.
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_source_check;
ALTER TABLE orders ADD CONSTRAINT orders_source_check CHECK (source IN ('manual_whatsapp','whatsapp_ai','pos'));
ALTER TABLE orders ADD COLUMN IF NOT EXISTS fulfillment text NOT NULL DEFAULT 'delivery' CHECK (fulfillment IN ('counter','pickup','delivery'));
ALTER TABLE orders ADD COLUMN IF NOT EXISTS quoted_at timestamptz;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS composition_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS preparing_at timestamptz;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivered_at timestamptz;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;
CREATE TABLE IF NOT EXISTS order_stock_reservations (
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  reservation_id uuid NOT NULL REFERENCES stock_reservations(id),
  component_kind text NOT NULL CHECK(component_kind IN ('ingredient','prepared')),
  PRIMARY KEY(order_id,reservation_id)
);
CREATE INDEX IF NOT EXISTS order_stock_reservations_order_idx ON order_stock_reservations(order_id);

CREATE TABLE IF NOT EXISTS order_cost_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  reservation_id uuid NOT NULL REFERENCES stock_reservations(id),
  ingredient_id uuid NOT NULL REFERENCES stock_ingredients(id),
  cost_cents numeric(20,6) NOT NULL CHECK(cost_cents >= 0),
  classification text NOT NULL DEFAULT 'pending' CHECK(classification IN ('pending','sold','waste')),
  created_at timestamptz NOT NULL DEFAULT now(),
  classified_at timestamptz,
  UNIQUE(order_id,reservation_id)
);
CREATE INDEX IF NOT EXISTS order_cost_allocations_order_idx ON order_cost_allocations(order_id, classification);

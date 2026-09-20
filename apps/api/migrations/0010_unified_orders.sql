-- One order is the durable sale record. Existing WhatsApp orders remain readable.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS fulfillment text NOT NULL DEFAULT 'delivery' CHECK (fulfillment IN ('counter','pickup','delivery'));
ALTER TABLE orders ADD COLUMN IF NOT EXISTS quoted_at timestamptz;
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

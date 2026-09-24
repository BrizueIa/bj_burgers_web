ALTER TABLE order_refunds
  ADD COLUMN IF NOT EXISTS order_item_id uuid REFERENCES order_items(id);

CREATE INDEX IF NOT EXISTS order_refunds_item_idx
  ON order_refunds(order_item_id)
  WHERE order_item_id IS NOT NULL;

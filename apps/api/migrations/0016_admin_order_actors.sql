ALTER TABLE orders ADD COLUMN IF NOT EXISTS created_by_user_id uuid REFERENCES admin_users(id);
ALTER TABLE order_events ADD COLUMN IF NOT EXISTS created_by_user_id uuid REFERENCES admin_users(id);
ALTER TABLE order_payments ADD COLUMN IF NOT EXISTS created_by_user_id uuid REFERENCES admin_users(id);
ALTER TABLE order_refunds ADD COLUMN IF NOT EXISTS created_by_user_id uuid REFERENCES admin_users(id);
CREATE INDEX IF NOT EXISTS orders_created_by_user_idx ON orders(created_by_user_id) WHERE created_by_user_id IS NOT NULL;

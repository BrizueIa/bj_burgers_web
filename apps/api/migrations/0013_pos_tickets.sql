CREATE TABLE IF NOT EXISTS order_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL UNIQUE REFERENCES orders(id),
  idempotency_key uuid NOT NULL UNIQUE,
  order_snapshot jsonb NOT NULL,
  payment_snapshot jsonb NOT NULL,
  issued_by_device_id uuid REFERENCES mobile_devices(id),
  issued_by_user_id uuid REFERENCES admin_users(id),
  issued_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS order_tickets_issued_at_idx ON order_tickets(issued_at DESC, id);

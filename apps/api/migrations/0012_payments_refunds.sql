CREATE TABLE IF NOT EXISTS order_payments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid NOT NULL REFERENCES orders(id), cash_session_id uuid REFERENCES cash_sessions(id), idempotency_key uuid NOT NULL UNIQUE,
 method text NOT NULL CHECK(method IN ('cash','card','transfer')), received_cents integer NOT NULL CHECK(received_cents > 0), applied_cents integer NOT NULL CHECK(applied_cents > 0 AND applied_cents <= received_cents), change_cents integer NOT NULL CHECK(change_cents >= 0), created_by_device_id uuid REFERENCES mobile_devices(id), created_at timestamptz NOT NULL DEFAULT now(),
 CHECK((method='cash') OR (received_cents=applied_cents AND change_cents=0)), CHECK((method<>'cash') OR cash_session_id IS NOT NULL)
);
CREATE TABLE IF NOT EXISTS order_refunds (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid NOT NULL REFERENCES orders(id), payment_id uuid NOT NULL REFERENCES order_payments(id), cash_session_id uuid REFERENCES cash_sessions(id), idempotency_key uuid NOT NULL UNIQUE, method text NOT NULL CHECK(method IN ('cash','card','transfer')), amount_cents integer NOT NULL CHECK(amount_cents>0), reason text NOT NULL, created_by_device_id uuid REFERENCES mobile_devices(id), created_at timestamptz NOT NULL DEFAULT now(), CHECK((method<>'cash') OR cash_session_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS order_payments_order_idx ON order_payments(order_id,created_at); CREATE INDEX IF NOT EXISTS order_refunds_order_idx ON order_refunds(order_id,created_at);

ALTER TABLE purchase_documents
  ADD COLUMN IF NOT EXISTS cash_session_id uuid REFERENCES cash_sessions(id);

CREATE TABLE IF NOT EXISTS operating_expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key uuid NOT NULL UNIQUE,
  category text NOT NULL CHECK(category IN ('rent','utilities','supplies','maintenance','commission','other')),
  description text NOT NULL CHECK(length(description) BETWEEN 3 AND 300),
  amount_cents integer NOT NULL CHECK(amount_cents > 0),
  payment_method text NOT NULL CHECK(payment_method IN ('cash','card','transfer')),
  funds_origin text NOT NULL CHECK(funds_origin IN ('cash_session','external')),
  cash_session_id uuid REFERENCES cash_sessions(id),
  linked_payment_id uuid REFERENCES order_payments(id),
  incurred_at timestamptz NOT NULL,
  created_by_device_id uuid REFERENCES mobile_devices(id),
  created_by_user_id uuid REFERENCES admin_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((funds_origin='cash_session' AND cash_session_id IS NOT NULL) OR (funds_origin='external' AND cash_session_id IS NULL)),
  CHECK ((category='commission' AND linked_payment_id IS NOT NULL AND funds_origin='external') OR (category<>'commission' AND linked_payment_id IS NULL)),
  CHECK ((created_by_device_id IS NOT NULL AND created_by_user_id IS NULL) OR (created_by_device_id IS NULL AND created_by_user_id IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS operating_expenses_payment_unique ON operating_expenses(linked_payment_id) WHERE linked_payment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS operating_expenses_incurred_idx ON operating_expenses(incurred_at DESC,id);
CREATE INDEX IF NOT EXISTS operating_expenses_category_idx ON operating_expenses(category,incurred_at DESC);

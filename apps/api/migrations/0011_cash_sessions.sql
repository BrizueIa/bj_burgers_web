CREATE TABLE IF NOT EXISTS cash_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), status text NOT NULL CHECK(status IN ('open','closed')),
  opening_fund_cents integer NOT NULL CHECK(opening_fund_cents >= 0), expected_cents integer NOT NULL CHECK(expected_cents >= 0),
  counted_cents integer, difference_cents integer, opened_by_device_id uuid REFERENCES mobile_devices(id), opened_by_user_id uuid REFERENCES admin_users(id),
  opened_at timestamptz NOT NULL DEFAULT now(), closed_at timestamptz,
  CHECK((opened_by_device_id IS NOT NULL AND opened_by_user_id IS NULL) OR (opened_by_device_id IS NULL AND opened_by_user_id IS NOT NULL)),
  CHECK((status='open' AND closed_at IS NULL AND counted_cents IS NULL AND difference_cents IS NULL) OR (status='closed' AND closed_at IS NOT NULL AND counted_cents IS NOT NULL AND difference_cents IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS cash_sessions_one_open ON cash_sessions((status)) WHERE status='open';
CREATE TABLE IF NOT EXISTS cash_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), cash_session_id uuid NOT NULL REFERENCES cash_sessions(id),
  idempotency_key uuid NOT NULL UNIQUE, kind text NOT NULL CHECK(kind IN ('income','expense','withdrawal','adjustment')),
  amount_cents integer NOT NULL CHECK(amount_cents <> 0), reason text NOT NULL, created_by_device_id uuid REFERENCES mobile_devices(id), created_by_user_id uuid REFERENCES admin_users(id), created_at timestamptz NOT NULL DEFAULT now(),
  CHECK((created_by_device_id IS NOT NULL AND created_by_user_id IS NULL) OR (created_by_device_id IS NULL AND created_by_user_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS cash_movements_session_created_idx ON cash_movements(cash_session_id,created_at);

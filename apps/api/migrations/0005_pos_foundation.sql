-- Foundation for progressively enabled POS workflows. Existing tables remain
-- immutable; all new writes use these records for actor/audit/idempotency data.
CREATE TABLE IF NOT EXISTS pos_capabilities (
  capability text PRIMARY KEY CHECK (capability IN (
    'stock_ledger', 'purchasing', 'recipe_versions', 'production', 'unified_orders',
    'cash_sessions', 'payments_refunds', 'pos_tickets', 'expenses', 'profitability_reports'
  )),
  enabled boolean NOT NULL DEFAULT false,
  updated_by_user_id uuid REFERENCES admin_users(id),
  activation_note text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO pos_capabilities (capability, enabled) VALUES
  ('stock_ledger', false), ('purchasing', false), ('recipe_versions', false),
  ('production', false), ('unified_orders', false), ('cash_sessions', false),
  ('payments_refunds', false), ('pos_tickets', false), ('expenses', false),
  ('profitability_reports', false)
ON CONFLICT (capability) DO NOTHING;

CREATE TABLE IF NOT EXISTS idempotency_operations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key uuid NOT NULL UNIQUE,
  operation text NOT NULL CHECK (length(operation) BETWEEN 1 AND 100),
  request_fingerprint text NOT NULL CHECK (length(request_fingerprint) = 64),
  response_status integer NOT NULL CHECK (response_status BETWEEN 200 AND 299),
  response_body jsonb NOT NULL,
  actor_kind text NOT NULL CHECK (actor_kind IN ('admin', 'device')),
  admin_user_id uuid REFERENCES admin_users(id),
  device_id uuid REFERENCES mobile_devices(id),
  origin text NOT NULL CHECK (origin IN ('admin_web', 'android')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (actor_kind = 'admin' AND admin_user_id IS NOT NULL AND device_id IS NULL AND origin = 'admin_web') OR
    (actor_kind = 'device' AND device_id IS NOT NULL AND admin_user_id IS NULL AND origin = 'android')
  )
);

CREATE TABLE IF NOT EXISTS operation_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_kind text NOT NULL CHECK (actor_kind IN ('admin', 'device')),
  admin_user_id uuid REFERENCES admin_users(id),
  device_id uuid REFERENCES mobile_devices(id),
  origin text NOT NULL CHECK (origin IN ('admin_web', 'android')),
  action text NOT NULL,
  entity text NOT NULL,
  entity_id text,
  reason text NOT NULL DEFAULT '',
  idempotency_key uuid,
  details jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (actor_kind = 'admin' AND admin_user_id IS NOT NULL AND device_id IS NULL AND origin = 'admin_web') OR
    (actor_kind = 'device' AND device_id IS NOT NULL AND admin_user_id IS NULL AND origin = 'android')
  )
);

CREATE INDEX IF NOT EXISTS operation_audit_logs_entity_idx
  ON operation_audit_logs(entity, entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS operation_audit_logs_actor_idx
  ON operation_audit_logs(admin_user_id, device_id, created_at DESC);
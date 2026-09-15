CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS categories (
  id text PRIMARY KEY, slug text NOT NULL UNIQUE, name text NOT NULL, description text NOT NULL DEFAULT '', sort_order integer NOT NULL DEFAULT 0, active boolean NOT NULL DEFAULT true, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS products (
  id text PRIMARY KEY, slug text NOT NULL UNIQUE, category_id text NOT NULL REFERENCES categories(id), name text NOT NULL, description text NOT NULL, price_cents integer NOT NULL CHECK (price_cents >= 0), ingredients jsonb NOT NULL DEFAULT '[]', removable_ingredients jsonb NOT NULL DEFAULT '[]', combo_eligible boolean NOT NULL DEFAULT false, featured boolean NOT NULL DEFAULT false, available boolean NOT NULL DEFAULT true, sort_order integer NOT NULL DEFAULT 0, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS modifier_groups (
  id text PRIMARY KEY, name text NOT NULL, minimum_selections integer NOT NULL DEFAULT 0, maximum_selections integer, active boolean NOT NULL DEFAULT true, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS modifiers (
  id text PRIMARY KEY, group_id text REFERENCES modifier_groups(id), name text NOT NULL, price_cents integer NOT NULL CHECK (price_cents >= 0), available boolean NOT NULL DEFAULT true, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS promotions (
  id text PRIMARY KEY, name text NOT NULL, short_description text NOT NULL, days_of_week jsonb NOT NULL, starts_at timestamptz, ends_at timestamptz, priority integer NOT NULL DEFAULT 0, active boolean NOT NULL DEFAULT true, rule jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS business_settings (
  id text PRIMARY KEY DEFAULT 'primary', data jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS prizes (
  id text PRIMARY KEY, label text NOT NULL, emoji text NOT NULL, weight integer NOT NULL CHECK (weight >= 0), active boolean NOT NULL DEFAULT true, inventory integer CHECK (inventory IS NULL OR inventory >= 0), target_segments jsonb NOT NULL DEFAULT '[]', updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS spin_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code_digest text NOT NULL UNIQUE, code_hint text NOT NULL, remaining_spins integer NOT NULL DEFAULT 1 CHECK (remaining_spins >= 0), active boolean NOT NULL DEFAULT true, expires_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS spin_redemptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), idempotency_key uuid NOT NULL UNIQUE, code_id uuid NOT NULL REFERENCES spin_codes(id), prize_id text NOT NULL REFERENCES prizes(id), prize_label text NOT NULL, target_segment integer NOT NULL, remaining_spins integer NOT NULL CHECK (remaining_spins >= 0), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS admin_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text NOT NULL UNIQUE, password_hash text NOT NULL, active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS admin_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), token_digest text NOT NULL UNIQUE, user_id uuid NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE, csrf_token text NOT NULL, expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid REFERENCES admin_users(id), action text NOT NULL, entity text NOT NULL, entity_id text, details jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS spin_codes_lookup_idx ON spin_codes(code_digest) WHERE active = true;
CREATE INDEX IF NOT EXISTS spin_redemptions_code_idx ON spin_redemptions(code_id, created_at DESC);
CREATE INDEX IF NOT EXISTS admin_sessions_expiry_idx ON admin_sessions(expires_at);

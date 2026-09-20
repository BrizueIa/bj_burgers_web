CREATE TABLE IF NOT EXISTS suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  contact_name text NOT NULL DEFAULT '', contact_phone text NOT NULL DEFAULT '',
  active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS ingredient_presentations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ingredient_id uuid NOT NULL REFERENCES stock_ingredients(id), supplier_id uuid REFERENCES suppliers(id),
  name text NOT NULL, base_quantity numeric(16,3) NOT NULL CHECK (base_quantity > 0),
  active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(ingredient_id, name)
);
CREATE TABLE IF NOT EXISTS purchase_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), supplier_id uuid NOT NULL REFERENCES suppliers(id),
  idempotency_key uuid NOT NULL UNIQUE, reference text NOT NULL DEFAULT '', status text NOT NULL CHECK(status IN ('confirmed','reversed')),
  subtotal_cents integer NOT NULL CHECK(subtotal_cents >= 0), discount_cents integer NOT NULL CHECK(discount_cents >= 0),
  acquisition_cents integer NOT NULL CHECK(acquisition_cents >= 0), total_cents integer NOT NULL CHECK(total_cents >= 0),
  payment_method text NOT NULL CHECK(payment_method IN ('cash','card','transfer')),
  funds_origin text NOT NULL CHECK(funds_origin IN ('cash_session','external')),
  reversed_by_id uuid, created_by_device_id uuid REFERENCES mobile_devices(id), created_by_user_id uuid REFERENCES admin_users(id),
  created_at timestamptz NOT NULL DEFAULT now(), reversed_at timestamptz,
  CHECK ((created_by_device_id IS NOT NULL AND created_by_user_id IS NULL) OR (created_by_device_id IS NULL AND created_by_user_id IS NOT NULL)),
  CHECK(total_cents = subtotal_cents - discount_cents + acquisition_cents), CHECK(discount_cents <= subtotal_cents)
);
CREATE TABLE IF NOT EXISTS purchase_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), purchase_id uuid NOT NULL REFERENCES purchase_documents(id),
  ingredient_id uuid NOT NULL REFERENCES stock_ingredients(id), presentation_id uuid NOT NULL REFERENCES ingredient_presentations(id),
  presentation_quantity numeric(16,3) NOT NULL CHECK(presentation_quantity > 0), applied_base_quantity numeric(16,3) NOT NULL CHECK(applied_base_quantity > 0),
  gross_cents integer NOT NULL CHECK(gross_cents > 0), allocated_discount_cents integer NOT NULL CHECK(allocated_discount_cents >= 0),
  allocated_acquisition_cents integer NOT NULL CHECK(allocated_acquisition_cents >= 0), inventory_value_cents integer NOT NULL CHECK(inventory_value_cents > 0),
  UNIQUE(purchase_id, ingredient_id)
);
CREATE TABLE IF NOT EXISTS purchase_reversals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), purchase_id uuid NOT NULL UNIQUE REFERENCES purchase_documents(id),
  idempotency_key uuid NOT NULL UNIQUE, reason text NOT NULL, created_by_device_id uuid REFERENCES mobile_devices(id),
  created_by_user_id uuid REFERENCES admin_users(id), created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((created_by_device_id IS NOT NULL AND created_by_user_id IS NULL) OR (created_by_device_id IS NULL AND created_by_user_id IS NOT NULL))
);
ALTER TABLE purchase_documents ADD CONSTRAINT purchase_documents_reversed_by_fk FOREIGN KEY(reversed_by_id) REFERENCES purchase_documents(id);
CREATE INDEX IF NOT EXISTS purchase_documents_supplier_date_idx ON purchase_documents(supplier_id, created_at DESC);

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS manual_discount_cents integer NOT NULL DEFAULT 0
    CHECK (manual_discount_cents >= 0),
  ADD COLUMN IF NOT EXISTS manual_discount_reason text NOT NULL DEFAULT '';

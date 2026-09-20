-- Prepared batches become stock rows so their ingredients are never consumed a second time.
ALTER TABLE stock_ingredients ADD COLUMN IF NOT EXISTS preparation_product_id text REFERENCES products(id);
CREATE UNIQUE INDEX IF NOT EXISTS stock_ingredients_preparation_product_idx
  ON stock_ingredients(preparation_product_id) WHERE preparation_product_id IS NOT NULL;
ALTER TABLE stock_ledger_movements DROP CONSTRAINT IF EXISTS stock_ledger_movements_movement_type_check;
ALTER TABLE stock_ledger_movements ADD CONSTRAINT stock_ledger_movements_movement_type_check
  CHECK (movement_type IN ('initial','purchase','sale','waste','adjustment','count','production_consume','production_output'));
CREATE TABLE IF NOT EXISTS production_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), product_id text NOT NULL REFERENCES products(id),
  recipe_version_id uuid NOT NULL REFERENCES recipe_versions(id), output_ingredient_id uuid NOT NULL REFERENCES stock_ingredients(id),
  idempotency_key uuid NOT NULL UNIQUE, output_quantity numeric(16,3) NOT NULL CHECK(output_quantity > 0),
  output_unit text NOT NULL CHECK(output_unit IN ('g','ml','pz')), consumed_cost_cents numeric(20,6) NOT NULL CHECK(consumed_cost_cents >= 0),
  created_by_device_id uuid REFERENCES mobile_devices(id), created_by_user_id uuid REFERENCES admin_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((created_by_device_id IS NOT NULL AND created_by_user_id IS NULL) OR (created_by_device_id IS NULL AND created_by_user_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS production_batches_product_created_idx ON production_batches(product_id,created_at DESC);

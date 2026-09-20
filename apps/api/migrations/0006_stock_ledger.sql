-- Immutable inventory ledger.  The existing stock_ingredients balances remain
-- the fast operational projection; this migration seeds the first ledger row
-- exactly once so existing installations do not receive their stock twice.
ALTER TABLE stock_ingredients
  ADD COLUMN IF NOT EXISTS reserved numeric(16,3) NOT NULL DEFAULT 0
    CHECK (reserved >= 0);
DO $$ BEGIN
  ALTER TABLE stock_ingredients
    ADD CONSTRAINT stock_ingredients_reserved_not_over_stock CHECK (reserved <= stock);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS stock_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ingredient_id uuid NOT NULL REFERENCES stock_ingredients(id),
  quantity numeric(16,3) NOT NULL CHECK (quantity > 0),
  status text NOT NULL CHECK (status IN ('active', 'released', 'consumed')),
  reference_type text NOT NULL DEFAULT '',
  reference_id text NOT NULL DEFAULT '',
  reason text NOT NULL DEFAULT '',
  created_by_device_id uuid REFERENCES mobile_devices(id),
  created_by_user_id uuid REFERENCES admin_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  CHECK (
    (created_by_device_id IS NOT NULL AND created_by_user_id IS NULL) OR
    (created_by_device_id IS NULL AND created_by_user_id IS NOT NULL)
  ),
  CHECK (
    (status = 'active' AND resolved_at IS NULL) OR
    (status IN ('released', 'consumed') AND resolved_at IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS stock_reservations_active_ingredient_idx
  ON stock_reservations(ingredient_id, created_at) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS stock_ledger_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ingredient_id uuid NOT NULL REFERENCES stock_ingredients(id),
  business_entry_id uuid REFERENCES business_entries(id),
  reservation_id uuid REFERENCES stock_reservations(id),
  movement_type text NOT NULL CHECK (movement_type IN (
    'initial', 'purchase', 'sale', 'waste', 'adjustment', 'count'
  )),
  quantity_delta numeric(16,3) NOT NULL CHECK (quantity_delta <> 0),
  value_delta_cents numeric(20,6) NOT NULL,
  stock_after numeric(16,3) NOT NULL CHECK (stock_after >= 0),
  value_after_cents numeric(20,6) NOT NULL CHECK (value_after_cents >= 0),
  reason text NOT NULL DEFAULT '',
  created_by_device_id uuid REFERENCES mobile_devices(id),
  created_by_user_id uuid REFERENCES admin_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (movement_type = 'initial' AND created_by_device_id IS NULL AND created_by_user_id IS NULL) OR
    (movement_type <> 'initial' AND (
      (created_by_device_id IS NOT NULL AND created_by_user_id IS NULL) OR
      (created_by_device_id IS NULL AND created_by_user_id IS NOT NULL)
    ))
  )
);
CREATE INDEX IF NOT EXISTS stock_ledger_movements_ingredient_idx
  ON stock_ledger_movements(ingredient_id, created_at, id);
CREATE INDEX IF NOT EXISTS stock_ledger_movements_entry_idx
  ON stock_ledger_movements(business_entry_id) WHERE business_entry_id IS NOT NULL;

-- A baseline is ledger history, not a second stock posting.  It documents the
-- balance that existed before this feature without mutating that balance.
INSERT INTO stock_ledger_movements
  (ingredient_id, movement_type, quantity_delta, value_delta_cents, stock_after, value_after_cents,
   reason, created_by_user_id)
SELECT i.id, 'initial', i.stock, i.value_cents, i.stock, i.value_cents,
       'Saldo inicial migrado al libro mayor', NULL
FROM stock_ingredients i
WHERE i.stock > 0
  AND NOT EXISTS (SELECT 1 FROM stock_ledger_movements l WHERE l.ingredient_id = i.id);

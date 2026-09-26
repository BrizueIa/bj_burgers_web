-- Start the inventory workspace with the canonical menu ingredient list.
-- These rows are a setup catalogue only: recipes, quantities, costs and stock
-- are intentionally left for the business to enter. Existing balances win.
INSERT INTO stock_ingredients (name, unit)
VALUES
  ('Aros de cebolla', 'g'),
  ('Aderezo B&J', 'ml'),
  ('Aderezo B&J Smash', 'ml'),
  ('Coca-Cola', 'pz'),
  ('Coca-Cola Zero', 'pz'),
  ('Carne Angus', 'g'),
  ('Catsup', 'ml'),
  ('Cebolla', 'g'),
  ('Cebolla caramelizada', 'g'),
  ('Delaware', 'pz'),
  ('Escuis', 'pz'),
  ('Fanta', 'pz'),
  ('Jamón', 'g'),
  ('Jalapeño', 'pz'),
  ('Lechuga', 'g'),
  ('Mayonesa', 'ml'),
  ('Mostaza', 'ml'),
  ('Pan de hamburguesa', 'pz'),
  ('Pan de hot dog', 'pz'),
  ('Papas', 'g'),
  ('Piña asada', 'g'),
  ('Queso americano', 'g'),
  ('Queso asadero', 'g'),
  ('Queso Philadelphia', 'g'),
  ('Salchicha premium', 'pz'),
  ('Salchichón', 'g'),
  ('Salsa BBQ', 'ml'),
  ('Tocino', 'g'),
  ('Tomate', 'g')
ON CONFLICT (name) DO NOTHING;

-- Earlier trial builds may have created some ingredients with generic units.
-- Correct those units only when no opening balance or movement depends on them.
UPDATE stock_ingredients AS ingredient
SET unit = canonical.unit
FROM (VALUES
  ('Aderezo B&J', 'ml'), ('Aderezo B&J Smash', 'ml'), ('Catsup', 'ml'),
  ('Mayonesa', 'ml'), ('Mostaza', 'ml'), ('Salsa BBQ', 'ml'),
  ('Jalapeño', 'pz'), ('Salchicha premium', 'pz'),
  ('Coca-Cola', 'pz'), ('Coca-Cola Zero', 'pz'), ('Delaware', 'pz'),
  ('Escuis', 'pz'), ('Fanta', 'pz'), ('Pan de hamburguesa', 'pz'), ('Pan de hot dog', 'pz')
) AS canonical(name, unit)
WHERE ingredient.name = canonical.name
  AND ingredient.stock = 0
  AND ingredient.value_cents = 0
  AND NOT EXISTS (
    SELECT 1 FROM stock_ledger_movements movement
    WHERE movement.ingredient_id = ingredient.id
  )
  AND ingredient.unit IS DISTINCT FROM canonical.unit;

-- Sales and waste can take stock below zero while opening balances are being
-- reconciled. Reservations still require real, unreserved positive stock.
ALTER TABLE business_entries
  ADD COLUMN IF NOT EXISTS cost_pending boolean NOT NULL DEFAULT false;

ALTER TABLE stock_ingredients DROP CONSTRAINT IF EXISTS stock_ingredients_stock_check;
ALTER TABLE stock_ingredients DROP CONSTRAINT IF EXISTS stock_ingredients_reserved_not_over_stock;
ALTER TABLE stock_ingredients DROP CONSTRAINT IF EXISTS stock_ingredients_reserved_not_over_available_stock;
ALTER TABLE stock_ingredients
  ADD CONSTRAINT stock_ingredients_reserved_not_over_available_stock
  CHECK (reserved <= greatest(stock, 0));

ALTER TABLE stock_ledger_movements
  DROP CONSTRAINT IF EXISTS stock_ledger_movements_stock_after_check;

-- Basic counts are needed to enter the real opening balance for this catalogue.
UPDATE pos_capabilities
SET enabled = true,
    activation_note = 'Inventario inicial y conteos habilitados para capturar existencias reales.',
    updated_at = now()
WHERE capability = 'stock_ledger' AND enabled = false;

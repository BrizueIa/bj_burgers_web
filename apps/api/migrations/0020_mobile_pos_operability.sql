-- Allow the POS to record sold or wasted quantities below physical stock.
-- Monetary inventory value remains non-negative and reaches zero at the stockout;
-- the last known purchase cost is retained to cost the negative quantity.
ALTER TABLE stock_ingredients
  DROP CONSTRAINT IF EXISTS stock_ingredients_stock_check;
ALTER TABLE stock_ingredients
  DROP CONSTRAINT IF EXISTS stock_ingredients_reserved_not_over_stock;
ALTER TABLE stock_ledger_movements
  DROP CONSTRAINT IF EXISTS stock_ledger_movements_stock_after_check;
ALTER TABLE purchase_lines
  ADD COLUMN IF NOT EXISTS previous_last_cost numeric(20,6);
ALTER TABLE purchase_lines
  ADD COLUMN IF NOT EXISTS last_cost_snapshot boolean NOT NULL DEFAULT false;

-- Cash was explicitly requested for the current mobile trial. Do not activate
-- the irreversible POS cutover; legacy and unified order history can coexist.
UPDATE pos_capabilities
SET enabled = true,
    activation_note = 'Habilitado para operación y pruebas móviles; no implica POS cutover.',
    updated_at = now()
WHERE capability = ANY(ARRAY[
  'stock_ledger', 'purchasing', 'recipe_versions', 'production', 'unified_orders',
  'cash_sessions', 'payments_refunds', 'pos_tickets', 'expenses', 'profitability_reports'
]);

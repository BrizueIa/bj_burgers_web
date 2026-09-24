ALTER TABLE pos_capabilities DROP CONSTRAINT IF EXISTS pos_capabilities_capability_check;
ALTER TABLE pos_capabilities ADD CONSTRAINT pos_capabilities_capability_check CHECK (capability IN (
  'stock_ledger','purchasing','recipe_versions','production','unified_orders',
  'cash_sessions','payments_refunds','pos_tickets','expenses','profitability_reports','pos_cutover'
));
INSERT INTO pos_capabilities(capability,enabled,activation_note)
VALUES('pos_cutover',false,'') ON CONFLICT(capability) DO NOTHING;

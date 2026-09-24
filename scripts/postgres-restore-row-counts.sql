SELECT format(
  'SELECT %L || count(*)::text FROM %I.%I;',
  schemaname || '.' || tablename || '=',
  schemaname,
  tablename
)
FROM pg_catalog.pg_tables
WHERE schemaname = 'public'
ORDER BY tablename
\gexec

SELECT 'stock=' || COALESCE(sum(stock), 0)::text ||
  '|reserved=' || COALESCE(sum(reserved), 0)::text ||
  '|value_cents=' || COALESCE(sum(value_cents), 0)::text
FROM stock_ingredients;

SELECT 'orders=' || count(*)::text ||
  '|subtotal_cents=' || COALESCE(sum(subtotal_cents), 0)::text ||
  '|total_cents=' || COALESCE(sum(total_cents), 0)::text
FROM orders;

SELECT 'payments=' || count(*)::text ||
  '|applied_cents=' || COALESCE(sum(applied_cents), 0)::text
FROM order_payments;

SELECT 'refunds=' || count(*)::text ||
  '|amount_cents=' || COALESCE(sum(amount_cents), 0)::text
FROM order_refunds;

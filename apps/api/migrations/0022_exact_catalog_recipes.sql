-- Correct the Smash dressing and make packaged drinks count as stock pieces.
-- Existing order snapshots remain untouched.
UPDATE products
SET ingredients = jsonb_build_array(
      'Mayonesa', 'Mostaza', 'Catsup', 'Lechuga', 'Tomate', 'Cebolla',
      'Doble carne Angus estilo smash', 'Queso americano', 'Tocino',
      'Cebolla caramelizada', 'Aderezo B&J Smash'
    ),
    updated_at = now()
WHERE id = 'bj-smash'
  AND ingredients IS DISTINCT FROM jsonb_build_array(
      'Mayonesa', 'Mostaza', 'Catsup', 'Lechuga', 'Tomate', 'Cebolla',
      'Doble carne Angus estilo smash', 'Queso americano', 'Tocino',
      'Cebolla caramelizada', 'Aderezo B&J Smash'
  );

UPDATE products
SET ingredients = jsonb_build_array(name), updated_at = now()
WHERE id IN ('coca-cola', 'coca-cola-zero', 'delaware', 'escuis', 'fanta')
  AND ingredients IS DISTINCT FROM jsonb_build_array(name);

-- Seed active recipes only where the business has never saved a recipe. These
-- portions are explicitly stated by the menu or are one packaged drink unit.
-- Hamburgers and hot dogs still require their real gram/ml recipe quantities.
WITH portions(product_id, ingredient_name, quantity) AS (
  VALUES
    ('papas-250', 'Papas', 250.000::numeric),
    ('aros-200', 'Aros de cebolla', 200.000::numeric),
    ('aros-100', 'Aros de cebolla', 100.000::numeric),
    ('coca-cola', 'Coca-Cola', 1.000::numeric),
    ('coca-cola-zero', 'Coca-Cola Zero', 1.000::numeric),
    ('delaware', 'Delaware', 1.000::numeric),
    ('escuis', 'Escuis', 1.000::numeric),
    ('fanta', 'Fanta', 1.000::numeric)
), new_recipes AS (
  INSERT INTO product_recipes(product_id, target_margin, overhead_cents)
  SELECT DISTINCT portion.product_id, 65, 0
  FROM portions AS portion
  JOIN products AS product ON product.id = portion.product_id
  WHERE NOT EXISTS (
    SELECT 1 FROM product_recipes AS existing WHERE existing.product_id = portion.product_id
  )
  ON CONFLICT (product_id) DO NOTHING
  RETURNING product_id
), new_lines AS (
  INSERT INTO recipe_lines(product_id, ingredient_id, quantity)
  SELECT recipe.product_id, ingredient.id, portion.quantity
  FROM portions AS portion
  JOIN new_recipes AS recipe ON recipe.product_id = portion.product_id
  JOIN stock_ingredients AS ingredient ON ingredient.name = portion.ingredient_name
  RETURNING product_id, ingredient_id, quantity
), new_versions AS (
  INSERT INTO recipe_versions(
    product_id, version_number, target_margin, overhead_cents, status, activated_at
  )
  SELECT line.product_id,
         COALESCE((SELECT max(version.version_number) FROM recipe_versions AS version
                   WHERE version.product_id = line.product_id), 0) + 1,
         65, 0, 'active', now()
  FROM (SELECT DISTINCT product_id FROM new_lines) AS line
  WHERE NOT EXISTS (
    SELECT 1 FROM recipe_versions AS active
    WHERE active.product_id = line.product_id AND active.status = 'active'
  )
  RETURNING id, product_id
)
INSERT INTO recipe_version_components(recipe_version_id, component_kind, ingredient_id, quantity)
SELECT version.id, 'ingredient', line.ingredient_id, line.quantity
FROM new_versions AS version
JOIN new_lines AS line ON line.product_id = version.product_id;

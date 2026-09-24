-- Bring the persisted menu in line with the owner-confirmed product composition and prices.
-- Order rows keep their own snapshots, so historical sales are not rewritten.
WITH corrected_products(id, description, ingredients) AS (
  VALUES
    (
      'bj-smash',
      'Doble carne Angus estilo smash, queso americano, tocino, cebolla caramelizada y aderezo especial B&J Smash.',
      '["Mayonesa","Mostaza","Catsup","Lechuga","Tomate","Cebolla","Doble carne Angus estilo smash","Queso americano","Tocino","Cebolla caramelizada","Aderezo B&J"]'::jsonb
    ),
    (
      'hawaiana',
      'Carne Angus con queso americano, piña asada, queso asadero y jamón.',
      '["Mayonesa","Mostaza","Catsup","Lechuga","Tomate","Cebolla","Carne Angus","Queso americano","Piña asada","Queso asadero","Jamón"]'::jsonb
    ),
    (
      'salchiburger',
      'Carne Angus con queso americano, salchichón y queso asadero.',
      '["Mayonesa","Mostaza","Catsup","Lechuga","Tomate","Cebolla","Carne Angus","Queso americano","Salchichón","Queso asadero"]'::jsonb
    ),
    (
      'bbq',
      'Carne Angus, queso americano, aros de cebolla, tocino y salsa BBQ especial.',
      '["Mayonesa","Mostaza","Catsup","Lechuga","Tomate","Cebolla","Carne Angus","Queso americano","Aros de cebolla","Tocino","Salsa BBQ"]'::jsonb
    ),
    (
      'monstruosa',
      'Doble carne Angus, doble queso americano, salchichón, queso asadero, aros de cebolla y doble tocino.',
      '["Mayonesa","Mostaza","Catsup","Lechuga","Tomate","Cebolla","Doble carne Angus","Doble queso americano","Salchichón","Queso asadero","Aros de cebolla","Doble tocino"]'::jsonb
    ),
    (
      'crispy-dog',
      'Salchicha premium, tocino, aros de cebolla y salsa BBQ de la casa.',
      '["Mayonesa","Mostaza","Catsup","Lechuga","Tomate","Cebolla","Salchicha premium","Tocino","Aros de cebolla","Salsa BBQ"]'::jsonb
    ),
    (
      'bj-dog',
      'Salchicha premium, tocino, queso asadero, cebolla caramelizada y salsa BBQ.',
      '["Mayonesa","Mostaza","Catsup","Lechuga","Tomate","Cebolla","Salchicha premium","Tocino","Queso asadero","Cebolla caramelizada","Salsa BBQ"]'::jsonb
    ),
    (
      'mix-dog',
      'Media salchicha premium, medio salchichón, queso asadero, tocino, aderezos y vegetales.',
      '["Mayonesa","Mostaza","Catsup","Lechuga","Tomate","Cebolla","Media salchicha premium","Medio salchichón","Queso asadero","Tocino"]'::jsonb
    ),
    (
      'papas-250',
      'Papas crujientes, orden de 250 g. Porción para combo de 100 g.',
      '["Papas"]'::jsonb
    ),
    (
      'aros-200',
      'Aros de cebolla crujientes, orden de 200 g. Porción de 100 g disponible.',
      '["Aros de cebolla"]'::jsonb
    ),
    (
      'jalapeno-cremoso',
      'Jalapeño relleno de queso Philadelphia.',
      '["Jalapeño","Queso Philadelphia"]'::jsonb
    )
)
UPDATE products AS product
SET description = corrected.description,
    ingredients = corrected.ingredients,
    updated_at = now()
FROM corrected_products AS corrected
WHERE product.id = corrected.id
  AND (product.description, product.ingredients) IS DISTINCT FROM
      (corrected.description, corrected.ingredients);

UPDATE products
SET sort_order = CASE id WHEN 'aros-200' THEN 3 WHEN 'jalapeno-cremoso' THEN 4 END,
    updated_at = now()
WHERE id IN ('aros-200', 'jalapeno-cremoso')
  AND sort_order IS DISTINCT FROM CASE id WHEN 'aros-200' THEN 3 WHEN 'jalapeno-cremoso' THEN 4 END;

INSERT INTO products (
  id, slug, category_id, name, description, price_cents, ingredients,
  removable_ingredients, combo_eligible, featured, available, sort_order
)
SELECT
  'aros-100', 'aros-100', category.id, 'Porción de aros de cebolla',
  'Porción de aros de cebolla crujientes de 100 g.', 2600, '["Aros de cebolla"]'::jsonb,
  '[]'::jsonb, false, false, true, 2
FROM categories AS category
WHERE category.id = 'sides'
ON CONFLICT (id) DO UPDATE
SET slug = EXCLUDED.slug,
    category_id = EXCLUDED.category_id,
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    price_cents = EXCLUDED.price_cents,
    ingredients = EXCLUDED.ingredients,
    removable_ingredients = EXCLUDED.removable_ingredients,
    combo_eligible = EXCLUDED.combo_eligible,
    featured = EXCLUDED.featured,
    available = EXCLUDED.available,
    sort_order = EXCLUDED.sort_order,
    updated_at = now()
WHERE (products.slug, products.category_id, products.name, products.description, products.price_cents,
       products.ingredients, products.removable_ingredients, products.combo_eligible, products.featured,
       products.available, products.sort_order)
  IS DISTINCT FROM
      (EXCLUDED.slug, EXCLUDED.category_id, EXCLUDED.name, EXCLUDED.description, EXCLUDED.price_cents,
       EXCLUDED.ingredients, EXCLUDED.removable_ingredients, EXCLUDED.combo_eligible, EXCLUDED.featured,
       EXCLUDED.available, EXCLUDED.sort_order);

UPDATE products
SET price_cents = CASE id
      WHEN 'coca-cola' THEN 3900
      ELSE 3600
    END,
    updated_at = now()
WHERE id IN ('coca-cola', 'coca-cola-zero', 'delaware', 'escuis', 'fanta')
  AND price_cents IS DISTINCT FROM CASE id
        WHEN 'coca-cola' THEN 3900
        ELSE 3600
      END;

UPDATE products
SET ingredients = '[]'::jsonb,
    updated_at = now()
WHERE id IN ('coca-cola', 'coca-cola-zero', 'delaware', 'escuis', 'fanta')
  AND ingredients IS DISTINCT FROM '[]'::jsonb;

UPDATE modifiers
SET name = 'Papas 100 g', updated_at = now()
WHERE id = 'extra-papas-150' AND name IS DISTINCT FROM 'Papas 100 g';

INSERT INTO modifier_groups (id, name, minimum_selections, maximum_selections, active)
VALUES ('extras', 'Extras', 0, NULL, true)
ON CONFLICT (id) DO NOTHING;

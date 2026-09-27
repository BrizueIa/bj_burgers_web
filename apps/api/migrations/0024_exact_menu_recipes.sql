-- Install the portions confirmed by the business owner. Count-based servings
-- remain pieces; weights and sauces use the explicitly supplied grams.
UPDATE modifiers SET name='Papas 150 g', updated_at=now()
WHERE id='extra-papas-150' AND name IS DISTINCT FROM 'Papas 150 g';

INSERT INTO stock_ingredients(name,unit)
VALUES ('Pan brioche','pz')
ON CONFLICT (name) DO NOTHING;

INSERT INTO modifier_groups(id,name,minimum_selections,maximum_selections,active)
VALUES ('extras','Extras',0,NULL,true)
ON CONFLICT (id) DO NOTHING;
INSERT INTO modifiers(id,group_id,name,price_cents,available) VALUES
  ('extra-papas-150','extras','Papas 150 g',1600,true),
  ('extra-tocino','extras','Tocino',1600,true),
  ('extra-queso','extras','Queso asadero',1600,true),
  ('extra-pina','extras','Piña asada',1600,true),
  ('extra-salchichon','extras','Salchichón',2100,true),
  ('extra-carne','extras','Carne extra',2600,true)
ON CONFLICT (id) DO NOTHING;

-- Correct units only before the ingredient has stock value or movements. If an
-- ingredient already has operational history, leave it untouched and withhold
-- recipes that would otherwise mix units.
UPDATE stock_ingredients AS ingredient
SET unit=canonical.unit
FROM (VALUES
  ('Aderezo B&J','g'), ('Aderezo B&J Smash','g'), ('Catsup','g'),
  ('Mayonesa','g'), ('Mostaza','g'), ('Salsa BBQ','g'),
  ('Carne Angus','g'), ('Papas','g'), ('Aros de cebolla','pz'),
  ('Queso Philadelphia','g'),
  ('Jamón','pz'), ('Lechuga','pz'), ('Tomate','pz'), ('Cebolla','pz'),
  ('Cebolla caramelizada','pz'), ('Piña asada','pz'), ('Queso americano','pz'),
  ('Queso asadero','pz'), ('Salchichón','pz'), ('Tocino','pz'),
  ('Jalapeño','pz'), ('Salchicha premium','pz'),
  ('Pan de hamburguesa','pz'), ('Pan de hot dog','pz')
) AS canonical(name,unit)
WHERE ingredient.name=canonical.name
  AND ingredient.unit IS DISTINCT FROM canonical.unit
  AND ingredient.stock=0 AND ingredient.value_cents=0 AND ingredient.minimum=0
  AND NOT EXISTS (
    SELECT 1 FROM stock_ledger_movements movement
    WHERE movement.ingredient_id=ingredient.id
  )
  AND NOT EXISTS (
    SELECT 1 FROM stock_movements movement
    WHERE movement.ingredient_id=ingredient.id
  );

-- Switch the former gram-based side to a single piece at the owner's confirmed
-- price. Retire, but preserve, its earlier recipe versions as history.
UPDATE products SET name='Aro de cebolla',description='Aro de cebolla crujiente, vendido por pieza.',
  price_cents=5900,available=true,updated_at=now()
WHERE id='aros-200' AND EXISTS (
  SELECT 1 FROM stock_ingredients WHERE name='Aros de cebolla' AND unit='pz'
);
UPDATE products SET name='Porción de aros de cebolla (descontinuada)',
  description='Presentación anterior de 100 g, ya no disponible.',available=false,updated_at=now()
WHERE id='aros-100' AND EXISTS (
  SELECT 1 FROM stock_ingredients WHERE name='Aros de cebolla' AND unit='pz'
);
UPDATE recipe_versions version SET status='retired'
WHERE version.product_id='aros-200' AND version.status='active'
  AND EXISTS (
    SELECT 1 FROM recipe_version_components component
    JOIN stock_ingredients ingredient ON ingredient.id=component.ingredient_id
    WHERE component.recipe_version_id=version.id AND ingredient.name='Aros de cebolla'
      AND ingredient.unit='pz' AND component.quantity<>1
  );
UPDATE recipe_versions SET status='retired'
WHERE product_id='aros-100' AND status='active'
  AND EXISTS (SELECT 1 FROM stock_ingredients WHERE name='Aros de cebolla' AND unit='pz');
UPDATE recipe_lines SET quantity=1
WHERE product_id='aros-200' AND EXISTS (
  SELECT 1 FROM stock_ingredients WHERE name='Aros de cebolla' AND unit='pz'
);
DELETE FROM recipe_lines
WHERE product_id='aros-100' AND EXISTS (
  SELECT 1 FROM stock_ingredients WHERE name='Aros de cebolla' AND unit='pz'
);
CREATE TEMP TABLE confirmed_menu_recipe_lines (
  product_id text NOT NULL,
  ingredient_name text NOT NULL,
  quantity numeric(16,3) NOT NULL,
  unit text NOT NULL,
  removable boolean NOT NULL DEFAULT false
) ON COMMIT DROP;

INSERT INTO confirmed_menu_recipe_lines(product_id,ingredient_name,quantity,unit,removable) VALUES
  ('clasica','Mayonesa',15,'g',true),('clasica','Catsup',10,'g',true),('clasica','Mostaza',5,'g',true),
  ('clasica','Lechuga',1,'pz',true),('clasica','Tomate',1,'pz',true),('clasica','Cebolla',1,'pz',true),
  ('clasica','Carne Angus',150,'g',false),('clasica','Pan de hamburguesa',1,'pz',false),
  ('clasica','Queso americano',1,'pz',false),('clasica','Jamón',1,'pz',false),
  ('hawaiana','Mayonesa',15,'g',true),('hawaiana','Catsup',10,'g',true),('hawaiana','Mostaza',5,'g',true),
  ('hawaiana','Lechuga',1,'pz',true),('hawaiana','Tomate',1,'pz',true),('hawaiana','Cebolla',1,'pz',true),
  ('hawaiana','Carne Angus',150,'g',false),('hawaiana','Pan de hamburguesa',1,'pz',false),
  ('hawaiana','Queso americano',1,'pz',false),('hawaiana','Jamón',1,'pz',false),
  ('hawaiana','Queso asadero',1,'pz',false),('hawaiana','Piña asada',1,'pz',false),
  ('bj-smash','Mayonesa',15,'g',true),('bj-smash','Catsup',10,'g',true),('bj-smash','Mostaza',5,'g',true),
  ('bj-smash','Lechuga',1,'pz',true),('bj-smash','Tomate',1,'pz',true),('bj-smash','Cebolla',1,'pz',true),
  ('bj-smash','Carne Angus',180,'g',false),('bj-smash','Pan brioche',1,'pz',false),
  ('bj-smash','Queso americano',2,'pz',false),('bj-smash','Tocino',1,'pz',false),
  ('bj-smash','Cebolla caramelizada',1,'pz',false),('bj-smash','Aderezo B&J Smash',30,'g',false),
  ('salchiburger','Mayonesa',15,'g',true),('salchiburger','Catsup',10,'g',true),('salchiburger','Mostaza',5,'g',true),
  ('salchiburger','Lechuga',1,'pz',true),('salchiburger','Tomate',1,'pz',true),('salchiburger','Cebolla',1,'pz',true),
  ('salchiburger','Carne Angus',150,'g',false),('salchiburger','Pan de hamburguesa',1,'pz',false),
  ('salchiburger','Queso americano',1,'pz',false),('salchiburger','Salchichón',1,'pz',false),
  ('salchiburger','Queso asadero',1,'pz',false),
  ('bbq','Mayonesa',15,'g',true),('bbq','Catsup',10,'g',true),('bbq','Mostaza',5,'g',true),
  ('bbq','Lechuga',1,'pz',true),('bbq','Tomate',1,'pz',true),('bbq','Cebolla',1,'pz',true),
  ('bbq','Carne Angus',150,'g',false),('bbq','Pan de hamburguesa',1,'pz',false),
  ('bbq','Queso americano',1,'pz',false),('bbq','Tocino',1,'pz',false),
  ('bbq','Aros de cebolla',2,'pz',false),('bbq','Salsa BBQ',15,'g',false),
  ('monstruosa','Mayonesa',15,'g',true),('monstruosa','Catsup',10,'g',true),('monstruosa','Mostaza',5,'g',true),
  ('monstruosa','Lechuga',1,'pz',true),('monstruosa','Tomate',1,'pz',true),('monstruosa','Cebolla',1,'pz',true),
  ('monstruosa','Carne Angus',300,'g',false),('monstruosa','Pan de hamburguesa',1,'pz',false),
  ('monstruosa','Queso americano',2,'pz',false),('monstruosa','Salchichón',1,'pz',false),
  ('monstruosa','Queso asadero',1,'pz',false),('monstruosa','Aros de cebolla',2,'pz',false),
  ('monstruosa','Tocino',2,'pz',false),
  ('dog-clasico','Mayonesa',15,'g',true),('dog-clasico','Catsup',10,'g',true),('dog-clasico','Mostaza',5,'g',true),
  ('dog-clasico','Lechuga',1,'pz',true),('dog-clasico','Tomate',1,'pz',true),('dog-clasico','Cebolla',1,'pz',true),
  ('dog-clasico','Pan de hot dog',1,'pz',false),('dog-clasico','Salchicha premium',1,'pz',false),
  ('bacon-dog','Mayonesa',15,'g',true),('bacon-dog','Catsup',10,'g',true),('bacon-dog','Mostaza',5,'g',true),
  ('bacon-dog','Lechuga',1,'pz',true),('bacon-dog','Tomate',1,'pz',true),('bacon-dog','Cebolla',1,'pz',true),
  ('bacon-dog','Pan de hot dog',1,'pz',false),('bacon-dog','Salchicha premium',1,'pz',false),('bacon-dog','Tocino',1,'pz',false),
  ('salchi-dog','Mayonesa',15,'g',true),('salchi-dog','Catsup',10,'g',true),('salchi-dog','Mostaza',5,'g',true),
  ('salchi-dog','Lechuga',1,'pz',true),('salchi-dog','Tomate',1,'pz',true),('salchi-dog','Cebolla',1,'pz',true),
  ('salchi-dog','Pan de hot dog',1,'pz',false),('salchi-dog','Salchichón',1,'pz',false),('salchi-dog','Queso asadero',1,'pz',false),
  ('crispy-dog','Pan de hot dog',1,'pz',false),('crispy-dog','Salchicha premium',1,'pz',false),
  ('crispy-dog','Tocino',1,'pz',false),('crispy-dog','Aros de cebolla',2,'pz',false),('crispy-dog','Salsa BBQ',15,'g',false),
  ('bj-dog','Pan de hot dog',1,'pz',false),('bj-dog','Salchicha premium',1,'pz',false),('bj-dog','Tocino',1,'pz',false),
  ('bj-dog','Queso asadero',1,'pz',false),('bj-dog','Cebolla caramelizada',1,'pz',false),('bj-dog','Salsa BBQ',15,'g',false),
  ('mix-dog','Mayonesa',15,'g',true),('mix-dog','Catsup',10,'g',true),('mix-dog','Mostaza',5,'g',true),
  ('mix-dog','Lechuga',1,'pz',true),('mix-dog','Tomate',1,'pz',true),('mix-dog','Cebolla',1,'pz',true),
  ('mix-dog','Pan de hot dog',1,'pz',false),('mix-dog','Salchicha premium',0.5,'pz',false),
  ('mix-dog','Salchichón',0.5,'pz',false),('mix-dog','Queso asadero',1,'pz',false),('mix-dog','Tocino',1,'pz',false),
  ('jalapeno-cremoso','Jalapeño',1,'pz',false),('jalapeno-cremoso','Queso Philadelphia',25,'g',false),
  ('aros-200','Aros de cebolla',1,'pz',false);

CREATE TEMP TABLE eligible_confirmed_menu_recipes ON COMMIT DROP AS
SELECT line.product_id
FROM confirmed_menu_recipe_lines line
JOIN products product ON product.id=line.product_id
GROUP BY line.product_id
HAVING bool_and(EXISTS (
  SELECT 1 FROM stock_ingredients ingredient
  WHERE ingredient.name=line.ingredient_name AND ingredient.unit=line.unit
))
AND (line.product_id='aros-200' OR NOT EXISTS (
  SELECT 1 FROM product_recipes existing WHERE existing.product_id=line.product_id
))
AND NOT EXISTS (
  SELECT 1 FROM recipe_versions existing
  WHERE existing.product_id=line.product_id AND existing.status='active'
);

INSERT INTO product_recipes(product_id,target_margin,overhead_cents)
SELECT product_id,65,0 FROM eligible_confirmed_menu_recipes
ON CONFLICT(product_id) DO NOTHING;

WITH inserted_versions AS (
  INSERT INTO recipe_versions(product_id,version_number,target_margin,overhead_cents,status,activated_at)
  SELECT eligible.product_id,
    COALESCE((SELECT max(version_number) FROM recipe_versions WHERE product_id=eligible.product_id),0)+1,
    recipe.target_margin,recipe.overhead_cents,'active',now()
  FROM eligible_confirmed_menu_recipes eligible
  JOIN product_recipes recipe ON recipe.product_id=eligible.product_id
  WHERE NOT EXISTS (
    SELECT 1 FROM recipe_versions existing
    WHERE existing.product_id=eligible.product_id AND existing.status='active'
  )
  RETURNING id,product_id
)
INSERT INTO recipe_version_components(recipe_version_id,component_kind,ingredient_id,quantity,removable)
SELECT version.id,'ingredient',ingredient.id,line.quantity,line.removable
FROM inserted_versions version
JOIN confirmed_menu_recipe_lines line ON line.product_id=version.product_id
JOIN stock_ingredients ingredient ON ingredient.name=line.ingredient_name AND ingredient.unit=line.unit;

-- Every regular burger and hot dog offers these six extras. Their physical
-- consumption uses the owner-provided portion units, separate from base cost.
WITH extras(modifier_id,ingredient_name,quantity,unit) AS (VALUES
  ('extra-papas-150','Papas',150::numeric,'g'),
  ('extra-tocino','Tocino',1::numeric,'pz'),
  ('extra-queso','Queso asadero',1::numeric,'pz'),
  ('extra-pina','Piña asada',1::numeric,'pz'),
  ('extra-salchichon','Salchichón',1::numeric,'pz'),
  ('extra-carne','Carne Angus',150::numeric,'g')
)
INSERT INTO recipe_version_components(recipe_version_id,component_kind,ingredient_id,modifier_id,quantity,extra)
SELECT version.id,'modifier',ingredient.id,modifier.id,extra.quantity,true
FROM recipe_versions version
JOIN eligible_confirmed_menu_recipes eligible ON eligible.product_id=version.product_id
CROSS JOIN extras extra
JOIN modifiers modifier ON modifier.id=extra.modifier_id
JOIN stock_ingredients ingredient ON ingredient.name=extra.ingredient_name AND ingredient.unit=extra.unit
JOIN products product ON product.id=version.product_id
WHERE version.status='active' AND product.category_id IN ('burgers','dogs');

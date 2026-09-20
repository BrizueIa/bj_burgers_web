-- Immutable recipe snapshots. Legacy product_recipes remains readable during transition.
CREATE TABLE IF NOT EXISTS recipe_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id text NOT NULL REFERENCES products(id),
  version_number integer NOT NULL CHECK(version_number > 0),
  target_margin integer NOT NULL CHECK(target_margin BETWEEN 1 AND 95),
  overhead_cents integer NOT NULL DEFAULT 0 CHECK(overhead_cents >= 0),
  status text NOT NULL CHECK(status IN ('draft','active','retired')),
  -- Historical recipes migrated from the legacy tables predate the actor ledger.
  created_by_device_id uuid REFERENCES mobile_devices(id),
  created_by_user_id uuid REFERENCES admin_users(id),
  created_at timestamptz NOT NULL DEFAULT now(), activated_at timestamptz,
  UNIQUE(product_id, version_number),
  CHECK(
    (created_by_device_id IS NOT NULL AND created_by_user_id IS NULL)
    OR (created_by_device_id IS NULL AND created_by_user_id IS NOT NULL)
    OR (created_by_device_id IS NULL AND created_by_user_id IS NULL)
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS recipe_versions_one_active ON recipe_versions(product_id) WHERE status='active';
CREATE TABLE IF NOT EXISTS recipe_version_components (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipe_version_id uuid NOT NULL REFERENCES recipe_versions(id) ON DELETE CASCADE,
  component_kind text NOT NULL CHECK(component_kind IN ('ingredient','product','packaging','modifier')),
  ingredient_id uuid REFERENCES stock_ingredients(id), component_product_id text REFERENCES products(id),
  modifier_id text REFERENCES modifiers(id), quantity numeric(16,3) NOT NULL CHECK(quantity > 0),
  removable boolean NOT NULL DEFAULT false, extra boolean NOT NULL DEFAULT false,
  CHECK(
    (component_kind IN ('ingredient','packaging') AND ingredient_id IS NOT NULL AND component_product_id IS NULL AND modifier_id IS NULL)
    OR (component_kind = 'product' AND ingredient_id IS NULL AND component_product_id IS NOT NULL AND modifier_id IS NULL)
    OR (component_kind = 'modifier' AND ingredient_id IS NULL AND component_product_id IS NULL AND modifier_id IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS recipe_version_components_version_idx ON recipe_version_components(recipe_version_id);

-- Preserve the legacy composition exactly once as version 1. The actor is null
-- only for these pre-ledger records; all new versions require an authenticated actor.
INSERT INTO recipe_versions(product_id,version_number,target_margin,overhead_cents,status,activated_at)
SELECT r.product_id,1,r.target_margin,r.overhead_cents,'active',now()
FROM product_recipes r
ON CONFLICT(product_id,version_number) DO NOTHING;
INSERT INTO recipe_version_components(recipe_version_id,component_kind,ingredient_id,quantity)
SELECT v.id,'ingredient',l.ingredient_id,l.quantity
FROM recipe_versions v
JOIN recipe_lines l ON l.product_id=v.product_id
WHERE v.version_number=1
  AND NOT EXISTS (
    SELECT 1 FROM recipe_version_components c
    WHERE c.recipe_version_id=v.id AND c.component_kind='ingredient' AND c.ingredient_id=l.ingredient_id
  );

-- A selected POS modifier must map to a physical stock ingredient so its cost
-- and inventory consumption are included in the order snapshot.
ALTER TABLE recipe_version_components
  DROP CONSTRAINT IF EXISTS recipe_version_components_check;

ALTER TABLE recipe_version_components
  ADD CONSTRAINT recipe_version_components_valid_refs CHECK (
    (component_kind IN ('ingredient', 'packaging')
      AND ingredient_id IS NOT NULL
      AND component_product_id IS NULL
      AND modifier_id IS NULL)
    OR (component_kind = 'product'
      AND ingredient_id IS NULL
      AND component_product_id IS NOT NULL
      AND modifier_id IS NULL)
    OR (component_kind = 'modifier'
      AND ingredient_id IS NOT NULL
      AND component_product_id IS NULL
      AND modifier_id IS NOT NULL
      AND extra = true)
  );

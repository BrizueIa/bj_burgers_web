import type { AuthenticatedActor, RecipeVersionCreate } from '@bj/contracts';
import type { Sql } from 'postgres';
import { auditOperation, PosFoundationError, runIdempotent } from './pos-foundation-service.js';

const actorIds = (actor: AuthenticatedActor) =>
  actor.kind === 'device'
    ? { device: actor.deviceId, user: null }
    : { device: null, user: actor.userId };

function idempotentRequest(input: RecipeVersionCreate) {
  return {
    idempotencyKey: input.idempotencyKey,
    productId: input.productId,
    targetMargin: input.targetMargin,
    overheadCents: input.overheadCents,
    ...(input.priceCents === undefined ? {} : { priceCents: input.priceCents }),
    components: input.components.map((component) => ({
      kind: component.kind,
      quantity: component.quantity,
      removable: component.removable,
      extra: component.extra,
      ...(component.ingredientId ? { ingredientId: component.ingredientId } : {}),
      ...(component.productId ? { productId: component.productId } : {}),
      ...(component.modifierId ? { modifierId: component.modifierId } : {}),
    })),
  };
}

export async function createRecipeVersion(
  sql: Sql,
  input: RecipeVersionCreate,
  actor: AuthenticatedActor,
) {
  return runIdempotent(
    sql,
    {
      idempotencyKey: input.idempotencyKey,
      operation: 'recipe.version.create',
      request: idempotentRequest(input),
      actor,
    },
    async (transaction) => {
      const ids = actorIds(actor);
      const products =
        await transaction`select id from products where id=${input.productId} for update`;
      if (!products[0]) throw new PosFoundationError(404, 'El producto no existe.');
      // Recipe dependency updates share one stable lock. Without it two writers
      // could each validate half of a new A → B → A cycle concurrently.
      await transaction`select pg_advisory_xact_lock(hashtextextended('recipe_versions', 0))`;

      const dependencies = await transaction<
        { product_id: string; component_product_id: string }[]
      >`select v.product_id,c.component_product_id
        from recipe_versions v
        join recipe_version_components c on c.recipe_version_id=v.id
        where v.status='active' and c.component_product_id is not null`;
      const graph = new Map<string, string[]>();
      for (const dependency of dependencies)
        graph.set(dependency.product_id, [
          ...(graph.get(dependency.product_id) ?? []),
          dependency.component_product_id,
        ]);
      graph.set(
        input.productId,
        input.components
          .filter((component) => component.kind === 'product')
          .map((component) => component.productId!),
      );
      const reachesProduct = (node: string, path = new Set<string>()): boolean => {
        if (node === input.productId && path.size > 0) return true;
        if (path.has(node)) return false;
        return (graph.get(node) ?? []).some((next) =>
          reachesProduct(next, new Set([...path, node])),
        );
      };
      if (reachesProduct(input.productId))
        throw new PosFoundationError(400, 'La receta contiene un ciclo.');

      const [nextVersion] = await transaction<{ next: number }[]>`
        select (coalesce(max(version_number),0)::int + 1)::int as next
        from recipe_versions where product_id=${input.productId}`;
      if (!nextVersion) throw new PosFoundationError(500, 'No fue posible numerar la receta.');
      await transaction`update recipe_versions set status='retired'
        where product_id=${input.productId} and status='active'`;
      const [recipeVersion] = await transaction<
        { id: string; version_number: number }[]
      >`insert into recipe_versions
          (product_id,version_number,target_margin,overhead_cents,status,created_by_device_id,created_by_user_id,activated_at)
        values
          (${input.productId},${nextVersion.next},${input.targetMargin},${input.overheadCents},'active',${ids.device},${ids.user},now())
        returning id,version_number`;
      if (!recipeVersion) throw new PosFoundationError(500, 'No fue posible guardar la receta.');
      for (const component of input.components)
        await transaction`insert into recipe_version_components
          (recipe_version_id,component_kind,ingredient_id,component_product_id,modifier_id,quantity,removable,extra)
          values
          (${recipeVersion.id},${component.kind},${component.ingredientId ?? null},${component.productId ?? null},${component.modifierId ?? null},${component.quantity},${component.removable},${component.extra})`;
      await transaction`insert into product_recipes(product_id,target_margin,overhead_cents)
        values(${input.productId},${input.targetMargin},${input.overheadCents})
        on conflict(product_id) do update set target_margin=excluded.target_margin,overhead_cents=excluded.overhead_cents`;
      if (
        input.components.every(
          (component) => component.kind === 'ingredient' || component.kind === 'packaging',
        )
      ) {
        await transaction`delete from recipe_lines where product_id=${input.productId}`;
        for (const component of input.components)
          await transaction`insert into recipe_lines(product_id,ingredient_id,quantity)
            values(${input.productId},${component.ingredientId!},${component.quantity})`;
      }
      if (input.priceCents !== undefined)
        await transaction`update products set price_cents=${input.priceCents},updated_at=now() where id=${input.productId}`;
      await auditOperation(transaction, actor, {
        action: 'create',
        entity: 'recipe_version',
        entityId: recipeVersion.id,
        idempotencyKey: input.idempotencyKey,
      });
      return { recipeVersionId: recipeVersion.id, versionNumber: recipeVersion.version_number };
    },
  );
}

export async function recipeVersionState(sql: Sql, productId?: string) {
  const versions = await sql<
    Array<{
      id: string;
      product_id: string;
      product_name: string;
      version_number: number;
      target_margin: number;
      overhead_cents: number;
      status: string;
      created_at: Date | string;
      activated_at: Date | string | null;
    }>
  >`select v.*,p.name as product_name from recipe_versions v join products p on p.id=v.product_id
    where (${productId ?? null}::text is null or v.product_id=${productId ?? null})
    order by p.name, v.version_number desc`;
  const components = await sql<
    Array<{
      recipe_version_id: string;
      component_kind: string;
      ingredient_id: string | null;
      component_product_id: string | null;
      modifier_id: string | null;
      component_name: string;
      quantity: string;
      removable: boolean;
      extra: boolean;
    }>
  >`select c.recipe_version_id,c.component_kind,c.ingredient_id,c.component_product_id,c.modifier_id,
      coalesce(i.name,p.name,m.name) as component_name,c.quantity,c.removable,c.extra
    from recipe_version_components c
    join recipe_versions v on v.id=c.recipe_version_id
    left join stock_ingredients i on i.id=c.ingredient_id
    left join products p on p.id=c.component_product_id
    left join modifiers m on m.id=c.modifier_id
    where (${productId ?? null}::text is null or v.product_id=${productId ?? null})
    order by c.recipe_version_id,c.id`;
  return { versions, components };
}

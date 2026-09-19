-- Base quantities are grams, millilitres or pieces; money is in MXN cents.
create table if not exists stock_ingredients (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  unit text not null check (unit in ('g','ml','pz')),
  stock numeric(16,3) not null default 0 check(stock >= 0),
  value_cents numeric(20,6) not null default 0 check(value_cents >= 0),
  last_cost numeric(20,6),
  minimum numeric(16,3) not null default 0 check(minimum >= 0)
);
create table if not exists product_recipes (
  product_id text primary key references products(id),
  target_margin integer not null default 65 check(target_margin between 1 and 95),
  overhead_cents integer not null default 0 check(overhead_cents >= 0)
);
create table if not exists recipe_lines (
  product_id text not null references product_recipes(product_id),
  ingredient_id uuid not null references stock_ingredients(id),
  quantity numeric(16,3) not null check(quantity > 0),
  primary key(product_id, ingredient_id)
);
create table if not exists business_entries (
  id uuid primary key default gen_random_uuid(),
  idempotency_key uuid not null unique,
  request_payload jsonb not null,
  kind text not null check(kind in ('purchase','sale','waste','expense')),
  description text not null,
  payment text not null default '' check(payment in ('','cash','card','transfer')),
  total_cents integer not null check(total_cents >= 0),
  cost_cents integer not null default 0 check(cost_cents >= 0),
  lines jsonb not null,
  device_id uuid not null references mobile_devices(id),
  created_at timestamptz not null default now()
);
create index if not exists business_entries_date on business_entries(created_at);
create table if not exists stock_movements (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references business_entries(id),
  ingredient_id uuid not null references stock_ingredients(id),
  quantity numeric(16,3) not null,
  value_cents numeric(20,6) not null,
  created_at timestamptz not null default now()
);

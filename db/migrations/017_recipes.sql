-- Recipes: instructions you save once and run by name, using your MCP connections.
create table recipes (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  name          text not null,
  instructions  text not null,
  connections   text[] not null default '{}',  -- connection names it may use; empty means all of them
  last_run_at   timestamptz
);
create unique index recipes_name on recipes (lower(name));

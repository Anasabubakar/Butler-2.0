-- MCP connections: other services' tools that Ask Butler can use.
create table mcp_connections (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  name        text not null unique,
  host        text not null,                 -- shown on the website; the full link may hold a key
  secret      text not null,                 -- the link and any key, locked by the vault
  tools       jsonb not null default '[]',   -- what the server offered when last checked
  rules       jsonb not null default '{}',   -- per tool: "auto" (just do it), "ask" (ask first) or "off"
  checked_at  timestamptz,
  error       text
);

-- Every tool Butler called, or was refused, so you can see what it did.
create table mcp_calls (
  id             bigserial primary key,
  at             timestamptz not null default now(),
  connection_id  uuid references mcp_connections (id) on delete set null,
  connection     text not null,
  tool           text not null,
  args           jsonb not null default '{}',
  asked          boolean not null default false,  -- you said yes to it first
  status         text not null check (status in ('done', 'failed')),
  result         text
);
create index mcp_calls_at on mcp_calls (at desc);

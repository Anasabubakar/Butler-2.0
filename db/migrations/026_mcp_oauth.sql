-- MCP connections you sign in to in the browser (OAuth), next to the ones that use a key.
alter table mcp_connections
  add column auth text not null default 'key' check (auth in ('key', 'oauth')),
  add column signin_needed boolean not null default false;  -- the sign-in ran out; press Reconnect

-- Sign-ins you started but haven't finished: Butler waits up to 10 minutes for you.
create table mcp_oauth_pending (
  state_hash     text primary key,             -- sha-256 of the state sent to the service
  connection_id  uuid not null references mcp_connections (id) on delete cascade,
  verifier       text not null,                -- the PKCE code verifier, locked by the vault
  created_at     timestamptz not null default now()
);

-- The logo of each MCP connection, found on the service's website and kept here so the
-- website can show it without calling out. Looked up again every week.
alter table mcp_connections
  add column logo bytea,
  add column logo_type text,
  add column logo_at timestamptz;

-- Your Google account, connected once from the library website.
-- Only one row: Butler has one owner.

create table google_account (
  id            int primary key default 1 check (id = 1),
  email         text,
  refresh_token text not null,
  connected_at  timestamptz not null default now()
);

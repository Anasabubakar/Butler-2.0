-- What a device shows with a note: a preview of its link (title, site, picture) and, for a
-- login code, the code to copy with one tap. Deleted with the note.
alter table messages add column card jsonb;

-- Short links for heads-ups ("butler.example.com/go/k3Jd9Qx2"), so a phone notification
-- isn't a wall of tracking URL. Never for secret links (password resets, sign-in links),
-- which are shown once and not kept. They stop working after 30 days.
create table short_links (
  token       text primary key check (token ~ '^[A-Za-z0-9]{8,16}$'),
  url         text not null check (length(url) <= 2000),
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '30 days'
);
create index short_links_expires_idx on short_links (expires_at);

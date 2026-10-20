-- Butler: everything you save, from any device.

create table items (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  device        text not null,                       -- e.g. "android-pixel", "linux-laptop"
  kind          text not null check (kind in ('link', 'image', 'video', 'text', 'file')),
  url           text,
  body          text,                                -- shared text, or page description
  note          text,                                -- what you typed or said when saving
  file_path     text,                                -- path under FILES_DIR, "<id>/<name>"
  mime          text,
  thumbnail     text,                                -- preview image URL for links
  platform      text,                                -- tiktok, instagram, youtube, web, ...
  title         text,
  summary       text,
  tags          text[] not null default '{}',
  category      text,
  status        text not null default 'pending'
                  check (status in ('pending', 'organized', 'failed')),
  error         text,
  search        tsvector generated always as (
                  setweight(to_tsvector('simple', coalesce(title, '')), 'A') ||
                  setweight(to_tsvector('simple', coalesce(note, '')), 'A') ||
                  setweight(to_tsvector('simple', coalesce(summary, '')), 'B') ||
                  setweight(to_tsvector('simple', coalesce(body, '')), 'C') ||
                  setweight(to_tsvector('simple', coalesce(url, '')), 'D')
                ) stored
);

create index items_created_at_idx on items (created_at desc);
create index items_search_idx     on items using gin (search);
create index items_tags_idx       on items using gin (tags);
create index items_category_idx   on items (category);

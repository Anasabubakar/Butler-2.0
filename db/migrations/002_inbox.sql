-- Devices and what's waiting for them: reminders, notes, copied text and links
-- sent from another device.

create table devices (
  name          text primary key,                    -- e.g. "laptop", "android-pixel-8"
  kind          text not null check (kind in ('laptop', 'phone')),
  last_seen     timestamptz not null default now()
);

create table messages (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  from_device   text not null,
  to_device     text not null references devices (name) on delete cascade,
  kind          text not null check (kind in ('reminder', 'note', 'clip', 'link', 'file')),
  body          text,
  url           text,
  item_id       uuid references items (id) on delete cascade,  -- for kind 'file'
  due_at        timestamptz not null default now(),
  delivered_at  timestamptz
);

create index messages_waiting_idx on messages (to_device, due_at) where delivered_at is null;

-- Butler's memory. chat_turns is what you and Butler said: the main conversation (item_id
-- null) or a chat about one save. A 'break' turn is "new chat": history before it is left out.
create table chat_turns (
  id          bigserial primary key,
  created_at  timestamptz not null default now(),
  item_id     uuid references items (id) on delete cascade,
  role        text not null check (role in ('owner', 'butler', 'break')),
  device      text,
  text        text not null check (length(text) <= 8000)
);
create index chat_turns_main_idx on chat_turns (created_at desc) where item_id is null;
create index chat_turns_item_idx on chat_turns (item_id, created_at desc) where item_id is not null;

-- Lasting things Butler knows about you, learned from what you said ('learned') or told
-- on purpose ('told'). You can see and forget each one on the website.
create table memories (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  text        text not null check (length(text) between 1 and 300),
  source      text not null default 'learned' check (source in ('learned', 'told'))
);
create index memories_created_idx on memories (created_at desc);

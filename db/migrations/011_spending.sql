-- Money you told Butler you spent ("I spent 2,500 on suya"), for weekly totals.
create table spending (
  id uuid primary key default gen_random_uuid(),
  spent_at timestamptz not null default now(),
  amount numeric(14, 2) not null check (amount > 0),
  currency text not null,
  what text not null,
  category text not null,
  device text
);
create index spending_spent_at on spending (spent_at);

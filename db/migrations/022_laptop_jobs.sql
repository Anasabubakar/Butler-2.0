-- What happened to each command sent to the laptop, so the phone and website can say why one
-- didn't run instead of going quiet. The command itself isn't kept: it carries your secret word.
create table laptop_jobs (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  from_device   text not null,
  to_devices    text[] not null,
  picked_up_at  timestamptz,                -- when a laptop took it from its inbox
  picked_up_by  text,
  state         text not null default 'queued',  -- queued, missed, or a state the laptop reported
  text          text not null default '',
  updated_at    timestamptz not null default now()
);

create index laptop_jobs_open_idx on laptop_jobs (picked_up_by, created_at desc);

-- The job a 'task' message belongs to: one job, one message for each laptop it went to.
alter table messages add column job uuid references laptop_jobs (id) on delete set null;

-- Heads-ups: Butler reads new email and tells you what matters (a login code, a failed
-- payment, a deadline, an event about to start), the way a good assistant would text you.

-- Notes that carry a secret (a login code, a password reset link) are shown once: deleted
-- as soon as a device has them, and dropped unseen once they've expired.
alter table messages add column forget boolean not null default false;
alter table messages add column expires_at timestamptz;

-- Emails Butler has already looked at, so none is told twice. Only Gmail's id and what
-- kind of email it was: never the email itself.
create table alert_mail (
  id       text primary key,
  seen_at  timestamptz not null default now(),
  kind     text not null
);
create index alert_mail_seen_idx on alert_mail (seen_at);

-- Events coming up, found in email (a ticket, a webinar) or on your calendar, so Butler
-- can tell you an hour before, once, with the place and the link to get in.
create table upcoming (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  key           text not null unique,          -- the title, made plain, and the start time
  title         text not null check (length(title) between 1 and 200),
  starts_at     timestamptz not null,
  place         text check (length(place) <= 200),
  link          text check (length(link) <= 2000),
  source        text not null check (source in ('email', 'calendar')),
  announced_at  timestamptz
);
create index upcoming_starts_idx on upcoming (starts_at) where announced_at is null;

-- Dead-link rescue: a copy of each saved page on the Internet Archive, and whether the original still loads.
alter table items add column archive_url text;
alter table items add column link_checked_at timestamptz;
alter table items add column link_dead boolean not null default false;

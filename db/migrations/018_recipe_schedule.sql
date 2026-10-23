-- Recipes that run on their own: at run_at (your time) on run_days (0 = Sunday ... 6 = Saturday).
alter table recipes add column run_at text check (run_at ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
alter table recipes add column run_days smallint[] not null default '{0,1,2,3,4,5,6}';
alter table recipes add column scheduled_on date; -- the last day it ran on its own

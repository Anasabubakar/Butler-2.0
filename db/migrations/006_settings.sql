-- Small things Butler remembers between restarts, like your time zone and
-- the day it last sent your morning brief.
create table settings (
  key    text primary key,
  value  text not null
);

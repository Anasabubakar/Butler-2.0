-- Controlling the laptop from the phone:
-- 'task'   a command for the laptop (checked there for your secret word, then forgotten),
-- 'stop'   stop what the laptop is doing (body 'off' also switches remote control off there),
-- 'status' how a laptop task is going, for the phone.
alter table messages drop constraint messages_kind_check;
alter table messages add constraint messages_kind_check
  check (kind in ('reminder', 'note', 'clip', 'link', 'file', 'sync', 'ring', 'task', 'stop', 'status'));

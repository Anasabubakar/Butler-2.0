-- Sending real files between devices:
-- 'transfer' tells a device files are on their way (the files themselves wait on disk, not here).
alter table messages drop constraint messages_kind_check;
alter table messages add constraint messages_kind_check
  check (kind in ('reminder', 'note', 'clip', 'link', 'file', 'sync', 'ring', 'task', 'stop', 'status', 'transfer'));

-- How to reach a device directly on the same Wi-Fi, with no internet: its port, the
-- fingerprint of its own certificate (so the other device knows it's really yours) and the
-- addresses it last had. Sent by the device when it checks in.
alter table devices add column local jsonb;

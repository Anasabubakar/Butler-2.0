-- 'ring': make a device ring loudly (even on silent) so you can find it.
alter table messages drop constraint messages_kind_check;
alter table messages add constraint messages_kind_check
  check (kind in ('reminder', 'note', 'clip', 'link', 'file', 'sync', 'ring'));

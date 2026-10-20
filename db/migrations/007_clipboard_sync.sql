-- 'sync': what you copied on the laptop, quietly put on your phone's clipboard.
alter table messages drop constraint messages_kind_check;
alter table messages add constraint messages_kind_check
  check (kind in ('reminder', 'note', 'clip', 'link', 'file', 'sync'));

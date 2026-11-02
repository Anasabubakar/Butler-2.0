-- Telegram is one of your devices: Butler's notes and reminders reach the bot's chat with
-- you the way they reach your phone and laptop.
alter table devices drop constraint devices_kind_check;
alter table devices add constraint devices_kind_check check (kind in ('laptop', 'phone', 'telegram'));

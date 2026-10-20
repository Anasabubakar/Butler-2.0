-- A secret link that shows one note to anyone you send it to.
alter table items add column share_token text unique;

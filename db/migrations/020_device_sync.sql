-- The phone keeps its own copy of the library so it works offline. It asks for what
-- changed since it last looked: items stamp when they last changed, and deleted
-- items leave a note behind so the phone can drop them too.

alter table items add column updated_at timestamptz not null default now();
update items set updated_at = created_at;
create index items_updated_at_idx on items (updated_at, id);

create function items_touch() returns trigger language plpgsql as $$
begin
  new.updated_at := clock_timestamp();
  return new;
end $$;
create trigger items_touch before update on items for each row execute function items_touch();

create table deleted_items (
  id          uuid primary key,
  deleted_at  timestamptz not null default clock_timestamp()
);
create index deleted_items_at_idx on deleted_items (deleted_at);

create function items_forget() returns trigger language plpgsql as $$
begin
  insert into deleted_items (id) values (old.id) on conflict (id) do update set deleted_at = clock_timestamp();
  return old;
end $$;
create trigger items_forget after delete on items for each row execute function items_forget();

-- A save made offline carries the phone's own id for it, so sending it twice
-- (the answer got lost, the phone tried again) still makes one item.
alter table items add column client_id text unique check (length(client_id) between 1 and 100);

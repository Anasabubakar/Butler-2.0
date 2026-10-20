-- Lets the library website read your items when you're signed in, and nobody else.

-- Emails allowed to see the library. Add yours once:
--   insert into public.owners (email) values ('you@example.com');
create table public.owners (
  email text primary key check (email = lower(email))
);
alter table public.owners enable row level security;

create function public.is_owner() returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.owners where email = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

create policy "owners read items"   on public.items for select to authenticated using (public.is_owner());
create policy "owners edit items"   on public.items for update to authenticated using (public.is_owner()) with check (public.is_owner());
create policy "owners delete items" on public.items for delete to authenticated using (public.is_owner());

create policy "owners read files" on storage.objects for select to authenticated
  using (bucket_id = 'items' and public.is_owner());
create policy "owners delete files" on storage.objects for delete to authenticated
  using (bucket_id = 'items' and public.is_owner());

-- Counts for the sidebar: categories, platforms and the most used tags.
create function public.item_facets()
returns table (facet text, value text, n bigint)
language sql stable security invoker set search_path = ''
as $$
  select 'category', coalesce(category, 'unsorted'), count(*) from public.items group by 2
  union all
  select 'platform', coalesce(platform, 'none'), count(*) from public.items group by 2
  union all
  (select 'tag', t, count(*) from public.items, unnest(tags) as t group by 2 order by 3 desc limit 30);
$$;

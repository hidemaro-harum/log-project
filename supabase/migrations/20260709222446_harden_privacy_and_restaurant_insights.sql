-- Keep personal food photos private and enforce that every child row belongs
-- to a restaurant owned by the current user.
alter table public.restaurants
  add column if not exists wants_to_revisit boolean not null default false,
  add column if not exists price_range text check (price_range in ('budget', 'standard', 'special')),
  add column if not exists occasions text[] not null default '{}',
  add column if not exists crowd_level text check (crowd_level in ('quiet', 'normal', 'busy')),
  add column if not exists visit_count integer not null default 0,
  add column if not exists latest_visit_at date,
  add column if not exists average_rating numeric(2,1) check (average_rating between 0.5 and 5);

update storage.buckets set public = false where id = 'food-photos';

drop policy if exists "own restaurants" on public.restaurants;
drop policy if exists "own visits" on public.visits;
drop policy if exists "own photos" on public.photos;
drop policy if exists "own tags" on public.tags;
drop policy if exists "own restaurant tags" on public.restaurant_tags;

create policy "own restaurants select" on public.restaurants for select to authenticated using ((select auth.uid()) = user_id);
create policy "own restaurants insert" on public.restaurants for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "own restaurants update" on public.restaurants for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own restaurants delete" on public.restaurants for delete to authenticated using ((select auth.uid()) = user_id);

create policy "own visits select" on public.visits for select to authenticated using ((select auth.uid()) = user_id);
create policy "own visits insert" on public.visits for insert to authenticated with check (
  (select auth.uid()) = user_id
  and exists (select 1 from public.restaurants r where r.id = restaurant_id and r.user_id = (select auth.uid()))
);
create policy "own visits update" on public.visits for update to authenticated using ((select auth.uid()) = user_id) with check (
  (select auth.uid()) = user_id
  and exists (select 1 from public.restaurants r where r.id = restaurant_id and r.user_id = (select auth.uid()))
);
create policy "own visits delete" on public.visits for delete to authenticated using ((select auth.uid()) = user_id);

create policy "own photos select" on public.photos for select to authenticated using ((select auth.uid()) = user_id);
create policy "own photos insert" on public.photos for insert to authenticated with check (
  (select auth.uid()) = user_id
  and exists (select 1 from public.restaurants r where r.id = restaurant_id and r.user_id = (select auth.uid()))
  and (visit_id is null or exists (select 1 from public.visits v where v.id = visit_id and v.restaurant_id = restaurant_id and v.user_id = (select auth.uid())))
);
create policy "own photos update" on public.photos for update to authenticated using ((select auth.uid()) = user_id) with check (
  (select auth.uid()) = user_id
  and exists (select 1 from public.restaurants r where r.id = restaurant_id and r.user_id = (select auth.uid()))
);
create policy "own photos delete" on public.photos for delete to authenticated using ((select auth.uid()) = user_id);

create policy "own tags select" on public.tags for select to authenticated using ((select auth.uid()) = user_id);
create policy "own tags insert" on public.tags for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "own tags update" on public.tags for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own tags delete" on public.tags for delete to authenticated using ((select auth.uid()) = user_id);

create policy "own restaurant tags select" on public.restaurant_tags for select to authenticated using ((select auth.uid()) = user_id);
create policy "own restaurant tags insert" on public.restaurant_tags for insert to authenticated with check (
  (select auth.uid()) = user_id
  and exists (select 1 from public.restaurants r where r.id = restaurant_id and r.user_id = (select auth.uid()))
  and exists (select 1 from public.tags t where t.id = tag_id and t.user_id = (select auth.uid()))
);
create policy "own restaurant tags delete" on public.restaurant_tags for delete to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "own food photo uploads" on storage.objects;
drop policy if exists "own food photo reads" on storage.objects;
drop policy if exists "own food photo updates" on storage.objects;
drop policy if exists "own food photo deletes" on storage.objects;
create policy "own food photo uploads" on storage.objects for insert to authenticated with check (bucket_id = 'food-photos' and (select auth.uid())::text = (storage.foldername(name))[1]);
create policy "own food photo reads" on storage.objects for select to authenticated using (bucket_id = 'food-photos' and (select auth.uid())::text = (storage.foldername(name))[1]);
create policy "own food photo updates" on storage.objects for update to authenticated using (bucket_id = 'food-photos' and (select auth.uid())::text = (storage.foldername(name))[1]) with check (bucket_id = 'food-photos' and (select auth.uid())::text = (storage.foldername(name))[1]);
create policy "own food photo deletes" on storage.objects for delete to authenticated using (bucket_id = 'food-photos' and (select auth.uid())::text = (storage.foldername(name))[1]);

create or replace function public.refresh_restaurant_visit_summary()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  target_restaurant_id uuid;
begin
  if tg_op = 'DELETE' then
    target_restaurant_id := old.restaurant_id;
  else
    target_restaurant_id := new.restaurant_id;
  end if;
  update public.restaurants
  set
    visit_count = (select count(*) from public.visits where restaurant_id = target_restaurant_id),
    latest_visit_at = (select max(visited_at) from public.visits where restaurant_id = target_restaurant_id),
    average_rating = (select round(avg(rating), 1) from public.visits where restaurant_id = target_restaurant_id and rating is not null),
    rating = (select round(avg(rating), 1) from public.visits where restaurant_id = target_restaurant_id and rating is not null),
    updated_at = now()
  where id = target_restaurant_id;
  return null;
end;
$$;

drop trigger if exists refresh_restaurant_visit_summary on public.visits;
create trigger refresh_restaurant_visit_summary
after insert or update or delete on public.visits
for each row execute function public.refresh_restaurant_visit_summary();

update public.restaurants r
set
  visit_count = s.visit_count,
  latest_visit_at = s.latest_visit_at,
  average_rating = s.average_rating,
  rating = s.average_rating
from (
  select restaurant_id, count(*)::integer as visit_count, max(visited_at) as latest_visit_at, round(avg(rating), 1) as average_rating
  from public.visits
  group by restaurant_id
) s
where r.id = s.restaurant_id;

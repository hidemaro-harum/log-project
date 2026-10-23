create extension if not exists pgcrypto;

create type restaurant_status as enum ('visited', 'wishlist');

create table public.restaurants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  area text,
  genre text,
  status restaurant_status not null default 'wishlist',
  memo text,
  rating numeric(2,1) check (rating between 0.5 and 5),
  wants_to_revisit boolean not null default false,
  price_range text check (price_range in ('budget', 'standard', 'special')),
  occasions text[] not null default '{}',
  crowd_level text check (crowd_level in ('quiet', 'normal', 'busy')),
  visit_count integer not null default 0,
  latest_visit_at date,
  average_rating numeric(2,1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.visits (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  visited_at date not null default current_date,
  dish_name text,
  memo text,
  rating numeric(2,1) check (rating between 0.5 and 5),
  created_at timestamptz not null default now()
);

create table public.photos (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  visit_id uuid references public.visits(id) on delete set null,
  user_id uuid not null references auth.users(id) on delete cascade,
  storage_path text not null,
  caption text,
  sort_order integer not null default 0 check (sort_order >= 0),
  created_at timestamptz not null default now()
);

create table public.tags (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  unique (user_id, name)
);

create table public.restaurant_tags (
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  tag_id uuid not null references public.tags(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  primary key (restaurant_id, tag_id)
);

create index restaurants_user_search_idx on public.restaurants (user_id, status, name, area, genre);
-- Location columns are added in migrations for existing projects. Keep the canonical schema in sync.
alter table public.restaurants
  add column if not exists latitude double precision,
  add column if not exists longitude double precision,
  add column if not exists prefecture_code smallint check (prefecture_code between 1 and 47),
  add column if not exists google_place_id text,
  add column if not exists location_source text check (location_source in ('place', 'photo', 'geocoded', 'manual')),
  add column if not exists location_confidence text check (location_confidence in ('high', 'medium', 'low')),
  add column if not exists location_verified_at timestamptz,
  add column if not exists genre_source text check (genre_source in ('manual', 'google_places', 'name')),
  add column if not exists genre_confidence text check (genre_confidence in ('high', 'medium', 'low')),
  add column if not exists genre_raw text;
create index restaurants_user_prefecture_idx on public.restaurants (user_id, prefecture_code) where status = 'visited';
create index visits_user_restaurant_idx on public.visits (user_id, restaurant_id, visited_at desc);
create index photos_user_restaurant_idx on public.photos (user_id, restaurant_id);
create index photos_user_restaurant_sort_idx on public.photos (user_id, restaurant_id, sort_order, created_at);
create index tags_user_name_idx on public.tags (user_id, name);

alter table public.restaurants enable row level security;
alter table public.visits enable row level security;
alter table public.photos enable row level security;
alter table public.tags enable row level security;
alter table public.restaurant_tags enable row level security;

create policy "own restaurants" on public.restaurants for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own visits" on public.visits for all to authenticated using ((select auth.uid()) = user_id) with check (
  (select auth.uid()) = user_id
  and exists (select 1 from public.restaurants r where r.id = restaurant_id and r.user_id = (select auth.uid()))
);
create policy "own photos" on public.photos for all to authenticated using ((select auth.uid()) = user_id) with check (
  (select auth.uid()) = user_id
  and exists (select 1 from public.restaurants r where r.id = restaurant_id and r.user_id = (select auth.uid()))
  and (photos.visit_id is null or exists (select 1 from public.visits v where v.id = photos.visit_id and v.restaurant_id = photos.restaurant_id and v.user_id = (select auth.uid())))
);
create policy "own tags" on public.tags for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own restaurant tags" on public.restaurant_tags for all to authenticated using ((select auth.uid()) = user_id) with check (
  (select auth.uid()) = user_id
  and exists (select 1 from public.restaurants r where r.id = restaurant_id and r.user_id = (select auth.uid()))
  and exists (select 1 from public.tags t where t.id = tag_id and t.user_id = (select auth.uid()))
);

grant usage on schema public to anon, authenticated;
grant all on public.restaurants to authenticated;
grant all on public.visits to authenticated;
grant all on public.photos to authenticated;
grant all on public.tags to authenticated;
grant all on public.restaurant_tags to authenticated;

insert into storage.buckets (id, name, public) values ('food-photos', 'food-photos', false) on conflict (id) do update set public = false;
create policy "own food photo uploads" on storage.objects for insert with check (bucket_id = 'food-photos' and auth.uid()::text = (storage.foldername(name))[1]);
create policy "own food photo reads" on storage.objects for select using (bucket_id = 'food-photos' and auth.uid()::text = (storage.foldername(name))[1]);
create policy "own food photo updates" on storage.objects for update using (bucket_id = 'food-photos' and auth.uid()::text = (storage.foldername(name))[1]) with check (bucket_id = 'food-photos' and auth.uid()::text = (storage.foldername(name))[1]);
create policy "own food photo deletes" on storage.objects for delete using (bucket_id = 'food-photos' and auth.uid()::text = (storage.foldername(name))[1]);

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

create trigger refresh_restaurant_visit_summary
after insert or update or delete on public.visits
for each row execute function public.refresh_restaurant_visit_summary();

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
  rating int check (rating between 1 and 5),
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
  rating int check (rating between 1 and 5),
  created_at timestamptz not null default now()
);

create table public.photos (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  visit_id uuid references public.visits(id) on delete set null,
  user_id uuid not null references auth.users(id) on delete cascade,
  storage_path text not null,
  caption text,
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
create index visits_user_restaurant_idx on public.visits (user_id, restaurant_id, visited_at desc);
create index photos_user_restaurant_idx on public.photos (user_id, restaurant_id);
create index tags_user_name_idx on public.tags (user_id, name);

alter table public.restaurants enable row level security;
alter table public.visits enable row level security;
alter table public.photos enable row level security;
alter table public.tags enable row level security;
alter table public.restaurant_tags enable row level security;

create policy "own restaurants" on public.restaurants for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own visits" on public.visits for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own photos" on public.photos for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own tags" on public.tags for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own restaurant tags" on public.restaurant_tags for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

insert into storage.buckets (id, name, public) values ('food-photos', 'food-photos', true) on conflict (id) do nothing;
create policy "own food photo uploads" on storage.objects for insert with check (bucket_id = 'food-photos' and auth.uid()::text = (storage.foldername(name))[1]);
create policy "own food photo reads" on storage.objects for select using (bucket_id = 'food-photos' and auth.uid()::text = (storage.foldername(name))[1]);
create policy "own food photo updates" on storage.objects for update using (bucket_id = 'food-photos' and auth.uid()::text = (storage.foldername(name))[1]);
create policy "own food photo deletes" on storage.objects for delete using (bucket_id = 'food-photos' and auth.uid()::text = (storage.foldername(name))[1]);

alter table public.restaurants
  add column if not exists latitude double precision,
  add column if not exists longitude double precision,
  add column if not exists prefecture_code smallint,
  add column if not exists google_place_id text,
  add column if not exists location_source text,
  add column if not exists location_confidence text,
  add column if not exists location_verified_at timestamptz;

alter table public.restaurants
  drop constraint if exists restaurants_coordinates_pair_check,
  add constraint restaurants_coordinates_pair_check check (
    (latitude is null and longitude is null)
    or (latitude between -90 and 90 and longitude between -180 and 180)
  ),
  drop constraint if exists restaurants_prefecture_code_check,
  add constraint restaurants_prefecture_code_check check (prefecture_code between 1 and 47),
  drop constraint if exists restaurants_location_source_check,
  add constraint restaurants_location_source_check check (
    location_source is null or location_source in ('place', 'photo', 'geocoded', 'manual')
  ),
  drop constraint if exists restaurants_location_confidence_check,
  add constraint restaurants_location_confidence_check check (
    location_confidence is null or location_confidence in ('high', 'medium', 'low')
  );

create index if not exists restaurants_user_prefecture_idx
  on public.restaurants (user_id, prefecture_code)
  where status = 'visited';

create unique index if not exists restaurants_user_google_place_idx
  on public.restaurants (user_id, google_place_id)
  where google_place_id is not null;

comment on column public.restaurants.prefecture_code is 'JIS X 0401 prefecture code (1-47).';
comment on column public.restaurants.location_source is 'How the coordinates were obtained: place, photo, geocoded, or manual.';

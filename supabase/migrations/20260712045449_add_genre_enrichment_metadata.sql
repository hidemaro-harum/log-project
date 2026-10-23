alter table public.restaurants
  add column if not exists genre_source text,
  add column if not exists genre_confidence text,
  add column if not exists genre_raw text;

alter table public.restaurants
  drop constraint if exists restaurants_genre_source_check,
  add constraint restaurants_genre_source_check check (
    genre_source is null or genre_source in ('manual', 'google_places', 'name')
  ),
  drop constraint if exists restaurants_genre_confidence_check,
  add constraint restaurants_genre_confidence_check check (
    genre_confidence is null or genre_confidence in ('high', 'medium', 'low')
  );

update public.restaurants
set genre_source = 'manual', genre_confidence = 'high'
where genre is not null and btrim(genre) <> '' and genre_source is null;

create or replace function public.merge_own_restaurants(p_keeper_id uuid, p_duplicate_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  keeper public.restaurants%rowtype;
  duplicate public.restaurants%rowtype;
  moved_visits integer := 0;
  moved_photos integer := 0;
begin
  if p_keeper_id = p_duplicate_id then
    raise exception '同じ店舗は統合できません。';
  end if;

  select * into keeper from public.restaurants
  where id = p_keeper_id and user_id = (select auth.uid())
  for update;
  select * into duplicate from public.restaurants
  where id = p_duplicate_id and user_id = (select auth.uid())
  for update;

  if keeper.id is null or duplicate.id is null then
    raise exception '統合対象の店舗が見つかりません。';
  end if;

  update public.visits set restaurant_id = keeper.id where restaurant_id = duplicate.id;
  get diagnostics moved_visits = row_count;

  update public.photos set restaurant_id = keeper.id where restaurant_id = duplicate.id;
  get diagnostics moved_photos = row_count;

  insert into public.restaurant_tags (restaurant_id, tag_id, user_id)
  select keeper.id, tag_id, keeper.user_id
  from public.restaurant_tags
  where restaurant_id = duplicate.id
  on conflict (restaurant_id, tag_id) do nothing;

  update public.restaurants set google_place_id = null where id = duplicate.id;

  update public.restaurants set
    area = coalesce(nullif(area, ''), duplicate.area),
    genre = coalesce(nullif(genre, ''), duplicate.genre),
    genre_source = coalesce(genre_source, duplicate.genre_source),
    genre_confidence = coalesce(genre_confidence, duplicate.genre_confidence),
    genre_raw = coalesce(genre_raw, duplicate.genre_raw),
    memo = coalesce(nullif(memo, ''), duplicate.memo),
    status = case when status = 'visited' or duplicate.status = 'visited' then 'visited' else 'wishlist' end,
    wants_to_revisit = wants_to_revisit or duplicate.wants_to_revisit,
    latitude = coalesce(latitude, duplicate.latitude),
    longitude = coalesce(longitude, duplicate.longitude),
    prefecture_code = coalesce(prefecture_code, duplicate.prefecture_code),
    google_place_id = coalesce(google_place_id, duplicate.google_place_id),
    location_source = coalesce(location_source, duplicate.location_source),
    location_confidence = coalesce(location_confidence, duplicate.location_confidence),
    location_verified_at = coalesce(location_verified_at, duplicate.location_verified_at),
    updated_at = now()
  where id = keeper.id;

  delete from public.restaurants where id = duplicate.id;

  return jsonb_build_object('keeperId', keeper.id, 'movedVisits', moved_visits, 'movedPhotos', moved_photos);
end;
$$;

revoke all on function public.merge_own_restaurants(uuid, uuid) from public, anon;
grant execute on function public.merge_own_restaurants(uuid, uuid) to authenticated;

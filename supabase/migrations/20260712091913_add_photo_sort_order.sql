alter table public.photos
  add column if not exists sort_order integer not null default 0 check (sort_order >= 0);

with ranked_photos as (
  select
    id,
    row_number() over (partition by restaurant_id order by created_at, id) - 1 as next_sort_order
  from public.photos
)
update public.photos as photos
set sort_order = ranked_photos.next_sort_order
from ranked_photos
where photos.id = ranked_photos.id;

create index if not exists photos_user_restaurant_sort_idx
  on public.photos (user_id, restaurant_id, sort_order, created_at);

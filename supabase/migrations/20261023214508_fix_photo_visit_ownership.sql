-- Qualify the outer photos columns: an unqualified restaurant_id inside the
-- visits subquery resolves to v.restaurant_id and makes that check a tautology.
-- Apply the same parent checks to inserts and idempotent photo updates.
alter policy "own photos insert" on public.photos
with check (
  (select auth.uid()) = user_id
  and exists (
    select 1 from public.restaurants r
    where r.id = photos.restaurant_id and r.user_id = (select auth.uid())
  )
  and (
    photos.visit_id is null
    or exists (
      select 1 from public.visits v
      where v.id = photos.visit_id
        and v.restaurant_id = photos.restaurant_id
        and v.user_id = (select auth.uid())
    )
  )
);

alter policy "own photos update" on public.photos
with check (
  (select auth.uid()) = user_id
  and exists (
    select 1 from public.restaurants r
    where r.id = photos.restaurant_id and r.user_id = (select auth.uid())
  )
  and (
    photos.visit_id is null
    or exists (
      select 1 from public.visits v
      where v.id = photos.visit_id
        and v.restaurant_id = photos.restaurant_id
        and v.user_id = (select auth.uid())
    )
  )
);

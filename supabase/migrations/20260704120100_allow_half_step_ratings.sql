alter table public.restaurants drop constraint restaurants_rating_check;
alter table public.restaurants alter column rating type numeric(2,1) using rating::numeric(2,1);
alter table public.restaurants add constraint restaurants_rating_check check (rating between 0.5 and 5);

alter table public.visits drop constraint visits_rating_check;
alter table public.visits alter column rating type numeric(2,1) using rating::numeric(2,1);
alter table public.visits add constraint visits_rating_check check (rating between 0.5 and 5);

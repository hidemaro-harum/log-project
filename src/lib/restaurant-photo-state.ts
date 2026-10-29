import type { Photo, Restaurant, Visit } from "../types/database.ts";

/** Apply acknowledged photo/visit writes without counting the same retry twice. */
export function updateRestaurantPhotoState(restaurant: Restaurant, photos: Photo[], visit?: Visit): Restaurant {
  if (!visit || visit.restaurant_id !== restaurant.id || visit.user_id !== restaurant.user_id) {
    return { ...restaurant, photos };
  }
  const previousVisits = restaurant.visits ?? [];
  const existed = previousVisits.some((item) => item.id === visit.id);
  const visits = existed
    ? previousVisits.map((item) => item.id === visit.id ? visit : item)
    : [...previousVisits, visit];
  const count = Math.max(restaurant.visit_count ?? 0, previousVisits.length);
  const latestDate = [restaurant.latest_visit_at, ...visits.map((item) => item.visited_at)]
    .filter((date): date is string => Boolean(date)).sort().at(-1) ?? null;
  return {
    ...restaurant,
    photos,
    visits,
    status: "visited",
    visit_count: count + (existed ? 0 : 1),
    latest_visit_at: latestDate,
  };
}

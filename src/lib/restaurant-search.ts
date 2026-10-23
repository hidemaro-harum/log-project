import type { Restaurant, RestaurantStatus } from "../types/database.ts";

function normalize(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase("ja-JP").trim();
}

export function filterRestaurants(
  restaurants: Restaurant[],
  query: string,
  status: "all" | RestaurantStatus,
) {
  const terms = normalize(query).split(/\s+/).filter(Boolean);
  return restaurants.filter((restaurant) => {
    if (status !== "all" && restaurant.status !== status) return false;
    const text = normalize(
      [
        restaurant.name,
        restaurant.area,
        restaurant.genre,
        ...(restaurant.tags?.map((tag) => tag.name) ?? []),
      ].join(" "),
    );
    return terms.every((term) => text.includes(term));
  });
}

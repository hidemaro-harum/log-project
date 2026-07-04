export type SortMode = "newest" | "rating" | "visitDate";

export type SortableRestaurant = {
  id: string;
  rating: number | null;
  updated_at: string;
  created_at: string;
  visits?: { visited_at: string }[];
};

export function sortRestaurants<T extends SortableRestaurant>(restaurants: T[], sortMode: SortMode): T[] {
  return [...restaurants].sort((left, right) => {
    if (sortMode === "rating") {
      return compareNullableNumbersDesc(left.rating, right.rating) || compareNewest(left, right);
    }

    if (sortMode === "visitDate") {
      return compareNullableStringsDesc(getLatestVisitDate(left), getLatestVisitDate(right)) || compareNewest(left, right);
    }

    return compareNewest(left, right);
  });
}

function compareNewest(left: SortableRestaurant, right: SortableRestaurant) {
  return compareNullableStringsDesc(left.updated_at || left.created_at, right.updated_at || right.created_at);
}

function getLatestVisitDate(restaurant: SortableRestaurant) {
  return restaurant.visits?.reduce<string | null>((latest, visit) => {
    if (!latest || visit.visited_at > latest) return visit.visited_at;
    return latest;
  }, null) ?? null;
}

function compareNullableNumbersDesc(left: number | null, right: number | null) {
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return right - left;
}

function compareNullableStringsDesc(left: string | null, right: string | null) {
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return right.localeCompare(left);
}

export type DedupeRestaurant = {
  id: string;
  name: string;
  area: string | null;
  updated_at: string;
  photos?: { id: string }[];
};

export type DuplicateRestaurantCleanupPlan = {
  keeperId: string;
  deleteIds: string[];
  name: string;
  area: string | null;
};

export function getDuplicateRestaurantCleanupPlan(restaurants: DedupeRestaurant[]): DuplicateRestaurantCleanupPlan[] {
  const groups = new Map<string, DedupeRestaurant[]>();

  for (const restaurant of restaurants) {
    const key = `${normalizeRestaurantName(restaurant.name)}\u0000${normalizeAddress(restaurant.area)}`;
    const group = groups.get(key) ?? [];
    group.push(restaurant);
    groups.set(key, group);
  }

  return [...groups.values()]
    .filter((group) => group.length > 1)
    .map((group) => {
      const keeper = [...group].sort(compareKeepPriority)[0];
      const deleteIds = group
        .filter((restaurant) => restaurant.id !== keeper.id && (restaurant.photos?.length ?? 0) === 0)
        .map((restaurant) => restaurant.id);

      return {
        keeperId: keeper.id,
        deleteIds,
        name: keeper.name.trim(),
        area: keeper.area,
      };
    })
    .filter((plan) => plan.deleteIds.length > 0);
}

function compareKeepPriority(left: DedupeRestaurant, right: DedupeRestaurant) {
  const photoDiff = (right.photos?.length ?? 0) - (left.photos?.length ?? 0);
  if (photoDiff) return photoDiff;
  return right.updated_at.localeCompare(left.updated_at);
}

function normalizeRestaurantName(name: string) {
  return name.trim().normalize("NFKC").replace(/\s+/g, " ").toLowerCase();
}

function normalizeAddress(address: string | null) {
  return (address ?? "")
    .trim()
    .normalize("NFKC")
    .replace(/[‐‑‒–—―ー−]/g, "-")
    .replace(/\s+/g, "")
    .toLowerCase();
}

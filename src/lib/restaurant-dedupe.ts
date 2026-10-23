export type DedupeRestaurant = {
  id: string;
  name: string;
  area: string | null;
  updated_at: string;
  photos?: { id: string }[];
  visits?: { id: string }[];
  google_place_id?: string | null;
};

export type DuplicateRestaurantCandidate = {
  keeper: DedupeRestaurant;
  duplicate: DedupeRestaurant;
  confidence: "high" | "medium";
  reason: string;
};

export function findRegistrationMatch(
  restaurants: DedupeRestaurant[],
  input: { name: string; area: string | null; googlePlaceId?: string | null },
) {
  if (input.googlePlaceId) {
    const placeMatch = restaurants.find((restaurant) => restaurant.google_place_id === input.googlePlaceId);
    if (placeMatch) return placeMatch;
  }
  const name = normalizeRestaurantName(input.name);
  const area = normalizeAddress(input.area);
  // A shared name alone cannot distinguish branches without a Place ID.
  if (!area) return null;
  return restaurants.find((restaurant) => !haveConflictingPlaceIds(restaurant.google_place_id, input.googlePlaceId)
    && normalizeRestaurantName(restaurant.name) === name
    && normalizeAddress(restaurant.area) === area) ?? null;
}

export function findDuplicateRestaurantCandidates(restaurants: DedupeRestaurant[]): DuplicateRestaurantCandidate[] {
  const candidates: DuplicateRestaurantCandidate[] = [];
  for (let leftIndex = 0; leftIndex < restaurants.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < restaurants.length; rightIndex += 1) {
      const left = restaurants[leftIndex];
      const right = restaurants[rightIndex];
      const assessment = assessDuplicate(left, right);
      if (!assessment) continue;
      const [keeper, duplicate] = [left, right].sort(compareKeepPriority);
      candidates.push({ keeper, duplicate, ...assessment });
    }
  }
  return candidates.sort((a, b) => {
    if (a.confidence !== b.confidence) return a.confidence === "high" ? -1 : 1;
    return a.keeper.name.localeCompare(b.keeper.name, "ja");
  });
}

export type DuplicateRestaurantCleanupPlan = {
  keeperId: string;
  deleteIds: string[];
  name: string;
  area: string | null;
};

export function getDuplicateRestaurantCleanupPlan(restaurants: DedupeRestaurant[]): DuplicateRestaurantCleanupPlan[] {
  const groups = new Map<string, DedupeRestaurant[]>();

  for (const restaurant of restaurants) {
    const area = normalizeAddress(restaurant.area);
    if (!area && !restaurant.google_place_id) continue;
    const key = JSON.stringify([
      normalizeRestaurantName(restaurant.name),
      area,
      area ? null : restaurant.google_place_id,
    ]);
    const group = groups.get(key) ?? [];
    group.push(restaurant);
    groups.set(key, group);
  }

  return [...groups.values()]
    .filter((group) => group.length > 1)
    .filter((group) => new Set(group.map((restaurant) => restaurant.google_place_id).filter(Boolean)).size <= 1)
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
  const visitDiff = (right.visits?.length ?? 0) - (left.visits?.length ?? 0);
  if (visitDiff) return visitDiff;
  return right.updated_at.localeCompare(left.updated_at);
}

function assessDuplicate(left: DedupeRestaurant, right: DedupeRestaurant) {
  if (haveConflictingPlaceIds(left.google_place_id, right.google_place_id)) return null;
  if (left.google_place_id && left.google_place_id === right.google_place_id) {
    return { confidence: "high" as const, reason: "Google上で同じ店舗" };
  }
  const leftName = normalizeRestaurantName(left.name).replace(/[\s・･\-ー_()（）]/g, "");
  const rightName = normalizeRestaurantName(right.name).replace(/[\s・･\-ー_()（）]/g, "");
  const leftAddress = normalizeAddress(left.area);
  const rightAddress = normalizeAddress(right.area);
  const addressMatches = Boolean(leftAddress && rightAddress && (
    leftAddress === rightAddress || leftAddress.includes(rightAddress) || rightAddress.includes(leftAddress)
  ));
  if (leftName === rightName && addressMatches) {
    return { confidence: "high" as const, reason: "店名と住所が一致" };
  }
  const nameScore = similarity(leftName, rightName);
  const addressScore = similarity(leftAddress, rightAddress);
  if (nameScore >= 0.88 && (addressMatches || addressScore >= 0.72)) {
    return { confidence: "medium" as const, reason: "店名と住所がよく似ています" };
  }
  return null;
}

function haveConflictingPlaceIds(left: string | null | undefined, right: string | null | undefined) {
  return Boolean(left && right && left !== right);
}

function similarity(left: string, right: string) {
  if (!left || !right) return 0;
  if (left === right) return 1;
  const leftPairs = new Set(Array.from({ length: Math.max(0, left.length - 1) }, (_, index) => left.slice(index, index + 2)));
  const rightPairs = new Set(Array.from({ length: Math.max(0, right.length - 1) }, (_, index) => right.slice(index, index + 2)));
  if (!leftPairs.size || !rightPairs.size) return 0;
  let overlap = 0;
  for (const pair of leftPairs) if (rightPairs.has(pair)) overlap += 1;
  return (2 * overlap) / (leftPairs.size + rightPairs.size);
}

function normalizeRestaurantName(name: string) {
  return name.trim().normalize("NFKC").replace(/\s+/g, " ").toLowerCase();
}

function normalizeAddress(address: string | null) {
  return (address ?? "")
    .trim()
    .normalize("NFKC")
    .replace(/(?:丁目|番地?|号)/g, "-")
    .replace(/[‐‑‒–—―ー−]/g, "-")
    .replace(/\s+/g, "")
    .replace(/-+/g, "-")
    .toLowerCase();
}

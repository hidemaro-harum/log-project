import test from "node:test";
import assert from "node:assert/strict";
import { sortRestaurants, type SortMode, type SortableRestaurant } from "./restaurant-sort.ts";

const restaurants: SortableRestaurant[] = [
  {
    id: "low-recent",
    rating: 2,
    updated_at: "2026-01-03T00:00:00.000Z",
    created_at: "2026-01-01T00:00:00.000Z",
    visits: [{ visited_at: "2025-12-01" }],
  },
  {
    id: "high-old",
    rating: 5,
    updated_at: "2026-01-01T00:00:00.000Z",
    created_at: "2026-01-01T00:00:00.000Z",
    visits: [{ visited_at: "2025-10-01" }],
  },
  {
    id: "mid-latest-visit",
    rating: 4,
    updated_at: "2026-01-02T00:00:00.000Z",
    created_at: "2026-01-01T00:00:00.000Z",
    visits: [{ visited_at: "2026-01-10" }, { visited_at: "2025-01-01" }],
  },
  {
    id: "missing",
    rating: null,
    updated_at: "2025-01-01T00:00:00.000Z",
    created_at: "2025-01-01T00:00:00.000Z",
    visits: [],
  },
];

test("sorts restaurants by newest update by default", () => {
  assert.deepEqual(ids(sortRestaurants(restaurants, "newest")), [
    "low-recent",
    "mid-latest-visit",
    "high-old",
    "missing",
  ]);
});

test("sorts restaurants by rating with unrated restaurants last", () => {
  assert.deepEqual(ids(sortRestaurants(restaurants, "rating")), [
    "high-old",
    "mid-latest-visit",
    "low-recent",
    "missing",
  ]);
});

test("sorts restaurants by latest visit date with unvisited restaurants last", () => {
  assert.deepEqual(ids(sortRestaurants(restaurants, "visitDate")), [
    "mid-latest-visit",
    "low-recent",
    "high-old",
    "missing",
  ]);
});

test("lists supported sort modes", () => {
  const modes: SortMode[] = ["newest", "rating", "visitDate"];
  assert.equal(modes.length, 3);
});

function ids(restaurants: SortableRestaurant[]) {
  return restaurants.map((restaurant) => restaurant.id);
}

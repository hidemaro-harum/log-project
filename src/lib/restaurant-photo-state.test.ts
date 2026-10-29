import test from "node:test";
import assert from "node:assert/strict";
import { updateRestaurantPhotoState } from "./restaurant-photo-state.ts";
import type { Restaurant, Visit } from "../types/database.ts";

const restaurant: Restaurant = {
  id: "restaurant", user_id: "user", name: "食堂", area: null, genre: null,
  status: "visited", memo: null, rating: null, created_at: "", updated_at: "",
  visit_count: 1, latest_visit_at: "2026-10-29", visits: [],
};
const visit: Visit = {
  id: "visit", user_id: "user", restaurant_id: "restaurant", visited_at: "2026-10-30",
  dish_name: null, memo: null, rating: null, created_at: "",
};

test("a confirmed photo visit increments the existing count only once on retries", () => {
  const added = updateRestaurantPhotoState(restaurant, [], visit);
  assert.equal(added.visit_count, 2);
  assert.equal(added.latest_visit_at, "2026-10-30");
  const retried = updateRestaurantPhotoState(added, [], visit);
  assert.equal(retried.visit_count, 2);
  assert.equal(retried.visits?.length, 1);
});

test("photos alone preserve wishlist status and visit history", () => {
  const original = { ...restaurant, status: "wishlist" as const };
  const updated = updateRestaurantPhotoState(original, []);
  assert.equal(updated.status, "wishlist");
  assert.equal(updated.visit_count, 1);
  assert.equal(updated.visits, original.visits);
});

test("a backdated visit increments count without moving the latest date backwards", () => {
  const updated = updateRestaurantPhotoState(restaurant, [], { ...visit, visited_at: "2026-09-01" });
  assert.equal(updated.visit_count, 2);
  assert.equal(updated.latest_visit_at, "2026-10-29");
});

test("another restaurant's or user's visit cannot change this restaurant's history", () => {
  for (const invalid of [{ ...visit, restaurant_id: "other" }, { ...visit, user_id: "other" }]) {
    assert.equal(updateRestaurantPhotoState(restaurant, [], invalid).visit_count, 1);
  }
});

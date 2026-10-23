import test from "node:test";
import assert from "node:assert/strict";
import { filterRestaurants } from "./restaurant-search.ts";
import type { Restaurant } from "../types/database.ts";
const restaurants = [
  {
    id: "a",
    name: "Ｃａｆｅ １２",
    area: "京都",
    genre: "喫茶",
    status: "visited",
    tags: [{ name: "朝ごはん" }],
  },
  { id: "b", name: "Cafe 13", area: "大阪", genre: "喫茶", status: "wishlist" },
] as Restaurant[];
test("search normalizes width, case and spaces and matches terms across fields", () => {
  assert.deepEqual(
    filterRestaurants(restaurants, "  cafe　京都  ", "all").map((r) => r.id),
    ["a"],
  );
  assert.equal(filterRestaurants(restaurants, "朝ごはん", "visited").length, 1);
  assert.equal(filterRestaurants(restaurants, " ", "wishlist")[0].id, "b");
  assert.equal(filterRestaurants(restaurants, "Cafe", "visited").length, 1);
  assert.equal(filterRestaurants(restaurants, "東京", "all").length, 0);
});

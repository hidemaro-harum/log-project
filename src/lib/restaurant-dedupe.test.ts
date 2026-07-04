import test from "node:test";
import assert from "node:assert/strict";
import { getDuplicateRestaurantCleanupPlan, type DedupeRestaurant } from "./restaurant-dedupe.ts";

const restaurants: DedupeRestaurant[] = [
  {
    id: "photo-keeper",
    name: "黒川食堂",
    area: "東京都世田谷区北沢２丁目１４−６",
    updated_at: "2026-01-02T00:00:00.000Z",
    photos: [{ id: "photo-1" }],
  },
  {
    id: "no-photo-delete",
    name: " 黒川食堂 ",
    area: "東京都世田谷区北沢2丁目14-6",
    updated_at: "2026-01-03T00:00:00.000Z",
    photos: [],
  },
  {
    id: "newest-keeper",
    name: "油そば鈴の木",
    area: "池袋",
    updated_at: "2026-01-03T00:00:00.000Z",
    photos: [],
  },
  {
    id: "old-delete",
    name: "油そば鈴の木",
    area: "池袋",
    updated_at: "2026-01-01T00:00:00.000Z",
    photos: [],
  },
  {
    id: "unique",
    name: "天開",
    area: "新潟県三条市",
    updated_at: "2026-01-01T00:00:00.000Z",
    photos: [],
  },
];

test("plans deletion of duplicate restaurants without photos", () => {
  assert.deepEqual(getDuplicateRestaurantCleanupPlan(restaurants), [
    {
      keeperId: "photo-keeper",
      deleteIds: ["no-photo-delete"],
      name: "黒川食堂",
      area: "東京都世田谷区北沢２丁目１４−６",
    },
    {
      keeperId: "newest-keeper",
      deleteIds: ["old-delete"],
      name: "油そば鈴の木",
      area: "池袋",
    },
  ]);
});

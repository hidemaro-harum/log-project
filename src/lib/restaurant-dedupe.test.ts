import test from "node:test";
import assert from "node:assert/strict";
import { findDuplicateRestaurantCandidates, findRegistrationMatch, getDuplicateRestaurantCleanupPlan, type DedupeRestaurant } from "./restaurant-dedupe.ts";

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

test("finds duplicate candidates even when both stores contain photos", () => {
  const candidates = findDuplicateRestaurantCandidates([
    { id: "a", name: "黒川食堂 下北沢店", area: "東京都世田谷区北沢2-14-6", updated_at: "2026-01-01", photos: [{ id: "1" }], visits: [{ id: "v1" }] },
    { id: "b", name: "黒川食堂 下北沢店", area: "東京都世田谷区北沢２丁目１４−６", updated_at: "2026-01-02", photos: [{ id: "2" }, { id: "3" }], visits: [] },
  ]);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].keeper.id, "b");
  assert.equal(candidates[0].duplicate.id, "a");
  assert.equal(candidates[0].confidence, "high");
});

test("does not suggest same-name restaurants at different addresses", () => {
  assert.deepEqual(findDuplicateRestaurantCandidates([
    { id: "a", name: "山田食堂", area: "東京都新宿区1-1", updated_at: "2026-01-01" },
    { id: "b", name: "山田食堂", area: "東京都渋谷区9-9", updated_at: "2026-01-02" },
  ]), []);
});

test("matches a new registration to an existing Google place", () => {
  const match = findRegistrationMatch(restaurants, {
    name: "別表記の黒川食堂",
    area: "東京都世田谷区",
    googlePlaceId: "google-place-1",
  });
  assert.equal(match, null);

  const withPlaceId = [{ ...restaurants[0], google_place_id: "google-place-1" }];
  assert.equal(findRegistrationMatch(withPlaceId, {
    name: "別表記の黒川食堂",
    area: "東京都世田谷区",
    googlePlaceId: "google-place-1",
  })?.id, "photo-keeper");
});

test("matches normalized name and address when no place id is available", () => {
  assert.equal(findRegistrationMatch(restaurants, {
    name: " 黒川食堂 ",
    area: "東京都世田谷区北沢2丁目14-6",
  })?.id, "photo-keeper");
});

test("does not merge registrations with conflicting Google place IDs", () => {
  const existing = [{ ...restaurants[0], google_place_id: "place-a" }];
  assert.equal(findRegistrationMatch(existing, {
    name: restaurants[0].name,
    area: restaurants[0].area,
    googlePlaceId: "place-b",
  }), null);
  assert.equal(findRegistrationMatch(existing, {
    name: restaurants[0].name,
    area: restaurants[0].area,
  })?.id, "photo-keeper");
});

test("does not suggest or automatically clean up distinct Google places at the same address", () => {
  const distinctPlaces = [
    { ...restaurants[0], google_place_id: "place-a" },
    { ...restaurants[1], google_place_id: "place-b" },
  ];
  assert.deepEqual(findDuplicateRestaurantCandidates(distinctPlaces), []);
  assert.deepEqual(getDuplicateRestaurantCleanupPlan(distinctPlaces), []);
  assert.deepEqual(getDuplicateRestaurantCleanupPlan([
    ...distinctPlaces,
    { ...restaurants[1], id: "unknown-place", google_place_id: null },
  ]), []);
});

test("does not automatically merge same-name branches without an address or shared Place ID", () => {
  const existing = { ...restaurants[0], name: "スターバックス", area: null, photos: [] };
  for (const area of [null, "", "　 "]) {
    assert.equal(findRegistrationMatch([existing], { name: existing.name, area }), null);
    assert.deepEqual(getDuplicateRestaurantCleanupPlan([
      existing,
      { ...existing, id: "different-branch", area },
    ]), []);
  }
});

test("a shared Place ID still identifies addressless records without absorbing unknown branches", () => {
  const existing = { ...restaurants[0], name: "スターバックス", area: null, photos: [], google_place_id: "same-place" };
  const duplicate = { ...existing, id: "same-branch", updated_at: "2026-02-01" };
  const unknown = { ...existing, id: "unknown-branch", google_place_id: null };
  assert.equal(findRegistrationMatch([existing], {
    name: existing.name, area: null, googlePlaceId: "same-place",
  })?.id, existing.id);
  assert.deepEqual(getDuplicateRestaurantCleanupPlan([existing, duplicate, unknown]), [{
    keeperId: duplicate.id,
    deleteIds: [existing.id],
    name: existing.name,
    area: null,
  }]);
  assert.deepEqual(getDuplicateRestaurantCleanupPlan([
    existing, { ...duplicate, google_place_id: "different-place" },
  ]), []);
});

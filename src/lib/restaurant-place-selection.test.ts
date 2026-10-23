import assert from "node:assert/strict";
import test from "node:test";
import type { Restaurant } from "../types/database.ts";
import type { PlaceSuggestion } from "./place-suggestions.ts";
import { getRestaurantPlaceSelection } from "./restaurant-place-selection.ts";

const verifiedAt = "2026-10-04T12:00:00.000Z";
const original: Restaurant = {
  id: "restaurant-id", user_id: "user-id", name: "Cafe 12", area: "東京都渋谷区1-2",
  genre: "カフェ", status: "visited", memo: null, rating: null, created_at: "", updated_at: "",
  latitude: 35.6, longitude: 139.7, prefecture_code: 13, google_place_id: null,
  location_source: "manual", location_confidence: "medium", location_verified_at: "2026-01-01T00:00:00.000Z",
};
const selectedPlace: PlaceSuggestion = {
  id: "google-place-id", name: "大阪食堂", address: "大阪府大阪市福島区1-2", genre: "定食",
  googleMapsUrl: null, distanceMeters: 50, location: { latitude: 34.7, longitude: 135.5 },
};

test("unchanged edits preserve original metadata without manufacturing a Google place ID", () => {
  assert.deepEqual(getRestaurantPlaceSelection({ currentName: " Ｃａｆｅ　１２ ", currentArea: original.area, original, selectedPlace: null, verifiedAt }), {
    latitude: 35.6, longitude: 139.7, prefecture_code: 13, google_place_id: null,
    location_source: "manual", location_confidence: "medium", location_verified_at: original.location_verified_at,
  });
});

test("an explicit matching selection replaces every old location field including prefecture", () => {
  assert.deepEqual(getRestaurantPlaceSelection({ currentName: selectedPlace.name, currentArea: selectedPlace.address, original, selectedPlace, verifiedAt }), {
    latitude: 34.7, longitude: 135.5, prefecture_code: 27, google_place_id: selectedPlace.id,
    location_source: "place", location_confidence: "high", location_verified_at: verifiedAt,
  });
});

test("manual changes invalidate both a stale selected place and the original coordinates", () => {
  const expected = {
    latitude: null, longitude: null, prefecture_code: 26, google_place_id: null,
    location_source: null, location_confidence: null, location_verified_at: null,
  };
  assert.deepEqual(getRestaurantPlaceSelection({ currentName: selectedPlace.name, currentArea: "京都府京都市", original, selectedPlace, verifiedAt }), expected);
  assert.deepEqual(getRestaurantPlaceSelection({ currentName: "別のお店", currentArea: "京都府京都市", original, selectedPlace: null, verifiedAt }), expected);
  assert.equal(getRestaurantPlaceSelection({ currentName: "別のお店", currentArea: selectedPlace.address, selectedPlace, verifiedAt }).google_place_id, null);
});

test("a stale selection cannot replace an unchanged original restaurant", () => {
  assert.deepEqual(
    getRestaurantPlaceSelection({ currentName: original.name, currentArea: original.area, original, selectedPlace, verifiedAt }),
    getRestaurantPlaceSelection({ currentName: original.name, currentArea: original.area, original, selectedPlace: null, verifiedAt }),
  );
});

test("selecting a place without coordinates clears old coordinates instead of mixing two places", () => {
  assert.deepEqual(getRestaurantPlaceSelection({ currentName: selectedPlace.name, currentArea: selectedPlace.address, original, selectedPlace: { ...selectedPlace, location: null }, verifiedAt }), {
    latitude: null, longitude: null, prefecture_code: 27, google_place_id: selectedPlace.id,
    location_source: null, location_confidence: null, location_verified_at: null,
  });
});

test("new manual entries infer only prefecture and selected coordinate zero is valid", () => {
  assert.deepEqual(getRestaurantPlaceSelection({ currentName: "新しい店", currentArea: "横浜", selectedPlace: null, verifiedAt }), {
    latitude: null, longitude: null, prefecture_code: 14, google_place_id: null,
    location_source: null, location_confidence: null, location_verified_at: null,
  });
  const zero = getRestaurantPlaceSelection({ currentName: selectedPlace.name, currentArea: selectedPlace.address, selectedPlace: { ...selectedPlace, location: { latitude: 0, longitude: 0 } }, verifiedAt });
  assert.equal(zero.latitude, 0);
  assert.equal(zero.longitude, 0);
  assert.equal(zero.location_source, "place");
});

test("invalid selected coordinates are never persisted", () => {
  const result = getRestaurantPlaceSelection({ currentName: selectedPlace.name, currentArea: selectedPlace.address, original, selectedPlace: { ...selectedPlace, location: { latitude: NaN, longitude: 181 } }, verifiedAt });
  assert.equal(result.latitude, null);
  assert.equal(result.longitude, null);
  assert.equal(result.location_verified_at, null);
});

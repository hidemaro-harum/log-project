import assert from "node:assert/strict";
import test from "node:test";
import {
  createGoogleNearbySearchRequest,
  createGoogleNameSearchRequest,
  createGoogleTextSearchRequest,
  parsePlaceSearchQuery,
  resolveTextSearchResults,
  toNameSearchSuggestions,
  toPlaceSuggestions,
} from "./place-suggestions.ts";

test("creates a Google Places Nearby Search request for food places around photo coordinates", () => {
  const request = createGoogleNearbySearchRequest({
    apiKey: "google-key",
    location: { latitude: 35.65833333333333, longitude: 139.70416666666668 },
  });

  assert.equal(request.url, "https://places.googleapis.com/v1/places:searchNearby");
  assert.equal(request.init.method, "POST");
  assert.equal(request.init.headers["X-Goog-Api-Key"], "google-key");
  assert.match(request.init.headers["X-Goog-FieldMask"], /places\.displayName/);
  const body = JSON.parse(request.init.body);
  assert.equal(body.includedTypes, undefined);
  for (const type of ["restaurant", "cafe", "bar", "bakery", "coffee_shop", "pub", "tea_house"]) {
    assert.ok(body.includedPrimaryTypes.includes(type));
  }
  assert.ok(body.includedPrimaryTypes.length <= 50);
  assert.ok(!body.includedPrimaryTypes.includes("hotel"));
  assert.ok(!body.includedPrimaryTypes.includes("store"));
  assert.deepEqual({ ...body, includedPrimaryTypes: undefined }, {
    includedPrimaryTypes: undefined,
    languageCode: "ja",
    locationRestriction: {
      circle: {
        center: { latitude: 35.65833333333333, longitude: 139.70416666666668 },
        radius: 150,
      },
    },
    maxResultCount: 8,
    rankPreference: "DISTANCE",
  });
});

test("normalizes Google Places nearby results into distance-sorted restaurant suggestions", () => {
  const suggestions = toPlaceSuggestions(
    {
      places: [
        {
          id: "far-place",
          primaryType: "cafe",
          displayName: { text: "遠いカフェ" },
          formattedAddress: "東京都渋谷区神南1-1-1",
          googleMapsTypeLabel: { text: "カフェ" },
          googleMapsUri: "https://maps.google.com/?cid=far",
          location: { latitude: 35.6605, longitude: 139.7048 },
        },
        {
          id: "near-place",
          primaryType: "japanese_restaurant",
          displayName: { text: "近い食堂" },
          shortFormattedAddress: "東京都渋谷区宇田川町1-1",
          primaryTypeDisplayName: { text: "レストラン" },
          location: { latitude: 35.6584, longitude: 139.7042 },
        },
      ],
    },
    { latitude: 35.65833333333333, longitude: 139.70416666666668 },
  );

  assert.equal(suggestions.length, 2);
  assert.equal(suggestions[0].id, "near-place");
  assert.equal(suggestions[0].name, "近い食堂");
  assert.equal(suggestions[0].address, "東京都渋谷区宇田川町1-1");
  assert.equal(suggestions[0].genre, "レストラン");
  assert.ok(suggestions[0].distanceMeters !== null && suggestions[0].distanceMeters < 20);
  assert.equal(suggestions[1].id, "far-place");
});

test("filters out places without a display name", () => {
  assert.deepEqual(
    toPlaceSuggestions(
      {
        places: [{
          id: "missing-name",
          primaryType: "restaurant",
          formattedAddress: "東京都渋谷区",
          location: { latitude: 35.6584, longitude: 139.7042 },
        }],
      },
      { latitude: 35.65833333333333, longitude: 139.70416666666668 },
    ),
    [],
  );
});

test("dining suggestions exclude hotels and shops even when they carry food or restaurant secondary types", () => {
  const origin = { latitude: 35, longitude: 139 };
  const candidates = [
    { id: "hotel", primaryType: "hotel", types: ["restaurant", "food"] },
    { id: "convenience", primaryType: "convenience_store", types: ["food", "cafe"] },
    { id: "supermarket", primaryType: "supermarket", types: ["restaurant"] },
    { id: "shop", primaryType: "store", types: ["bakery"] },
    { id: "unknown", types: ["restaurant"] },
    { id: "ramen", primaryType: "ramen_restaurant" },
    { id: "coffee", primaryType: "coffee_shop" },
    { id: "bakery", primaryType: "bakery" },
    { id: "bar", primaryType: "bar" },
  ].map((place) => ({ ...place, displayName: { text: place.id }, location: origin }));
  const suggestions = toPlaceSuggestions({ places: candidates }, origin);
  assert.deepEqual(suggestions.map((place) => place.id), ["ramen", "coffee", "bakery", "bar"]);
});

test("dining suggestions fail closed when a place cannot be safely selected", () => {
  const origin = { latitude: 35, longitude: 139 };
  const place = { id: "restaurant", primaryType: "restaurant", displayName: { text: "食堂" }, location: origin };
  for (const invalid of [
    { ...place, id: undefined },
    { ...place, location: undefined },
    { ...place, location: { latitude: NaN, longitude: 139 } },
    { ...place, location: { latitude: 91, longitude: 139 } },
    { ...place, location: { latitude: 35, longitude: 181 } },
  ]) {
    assert.deepEqual(toPlaceSuggestions({ places: [invalid] }, origin), []);
  }
});

test("name search normalizes typed names and rejects empty, too short and excessive input", () => {
  assert.equal(parsePlaceSearchQuery("　Ｃａｆｅ　 テスト　"), "Cafe テスト");
  for (const value of [null, "", "   ", "鮨", "あ".repeat(101)]) assert.equal(parsePlaceSearchQuery(value), null);
  assert.equal(parsePlaceSearchQuery("鮨屋"), "鮨屋");
});

test("name search sends the restaurant name and current location in one location-biased text request", () => {
  const origin = { latitude: 35, longitude: 139 };
  const request = createGoogleNameSearchRequest({ apiKey: "test-key", query: "テストカフェ", location: origin });
  assert.equal(request.url, "https://places.googleapis.com/v1/places:searchText");
  assert.equal(request.init.headers["X-Goog-Api-Key"], "test-key");
  assert.match(request.init.headers["X-Goog-FieldMask"], /places\.primaryType/);
  assert.deepEqual(JSON.parse(request.init.body), {
    textQuery: "テストカフェ",
    languageCode: "ja",
    regionCode: "JP",
    pageSize: 20,
    locationBias: { circle: { center: origin, radius: 3_000 } },
  });
});

test("name search retains relevance order and excludes distant or non-dining results", () => {
  const origin = { latitude: 35, longitude: 139 };
  const candidates = [
    { id: "best-name-match", primaryType: "restaurant", latitude: 35.02 },
    { id: "nearest", primaryType: "cafe", latitude: 35.001 },
    { id: "outside-radius", primaryType: "restaurant", latitude: 35.04 },
    { id: "hotel", primaryType: "hotel", latitude: 35.001 },
  ].map(({ latitude, ...place }) => ({
    ...place,
    displayName: { text: place.id },
    location: { latitude, longitude: 139 },
    types: ["restaurant", "food"],
  }));
  const results = toNameSearchSuggestions({ places: candidates }, origin);
  assert.deepEqual(results.map((place) => place.id), ["best-name-match", "nearest"]);
  assert.ok(results[0].distanceMeters! > results[1].distanceMeters!);
});

test("creates a Japan-scoped text search request", () => {
  const request = createGoogleTextSearchRequest({ apiKey: "key", name: "テスト食堂", area: "東京都新宿区" });
  assert.equal(request.url, "https://places.googleapis.com/v1/places:searchText");
  assert.match(request.init.body, /テスト食堂/);
  assert.equal(request.init.headers["X-Goog-Api-Key"], "key");
});

test("ranks an exact name and address match as high confidence", () => {
  const [result] = resolveTextSearchResults({ places: [{
    id: "place-1",
    displayName: { text: "テスト食堂 本店" },
    formattedAddress: "日本、東京都新宿区西新宿1-1",
    location: { latitude: 35.69, longitude: 139.69 },
  }] }, "テスト食堂", "東京都新宿区");
  assert.equal(result.confidence, "high");
  assert.deepEqual(result.location, { latitude: 35.69, longitude: 139.69 });
});

test("an exact name in a conflicting prefecture remains low confidence", () => {
  for (const shortFormattedAddress of [undefined, "中央区1-1"]) {
    const [result] = resolveTextSearchResults({ places: [{
      id: "different-prefecture",
      displayName: { text: "テスト食堂" },
      formattedAddress: "大阪府大阪市中央区1-1",
      shortFormattedAddress,
      location: { latitude: 34.69, longitude: 135.5 },
    }] }, "テスト食堂", "東京都新宿区");
    assert.equal(result.confidence, "low");
  }
});

test("unknown or abbreviated addresses retain existing non-conflicting confidence", () => {
  const place = {
    id: "same-name",
    displayName: { text: "テスト食堂" },
    location: { latitude: 35.69, longitude: 139.69 },
  };
  const [abbreviated] = resolveTextSearchResults({ places: [{ ...place, formattedAddress: "東京都新宿区西新宿1-1" }] }, "テスト食堂", "新宿");
  assert.equal(abbreviated.confidence, "high");
  for (const formattedAddress of [undefined, "", "中央区1-1"]) {
    const [unknown] = resolveTextSearchResults({ places: [{ ...place, formattedAddress }] }, "テスト食堂", "東京都新宿区");
    assert.equal(unknown.confidence, "medium");
  }
});

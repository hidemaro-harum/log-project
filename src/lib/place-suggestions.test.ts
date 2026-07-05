import test from "node:test";
import assert from "node:assert/strict";
import { createGoogleNearbySearchRequest, toPlaceSuggestions } from "./place-suggestions.ts";

test("creates a Google Places Nearby Search request for food places around photo coordinates", () => {
  const request = createGoogleNearbySearchRequest({
    apiKey: "google-key",
    location: { latitude: 35.65833333333333, longitude: 139.70416666666668 },
  });

  assert.equal(request.url, "https://places.googleapis.com/v1/places:searchNearby");
  assert.equal(request.init.method, "POST");
  assert.equal(request.init.headers["X-Goog-Api-Key"], "google-key");
  assert.match(request.init.headers["X-Goog-FieldMask"], /places\.displayName/);
  assert.deepEqual(JSON.parse(request.init.body), {
    includedTypes: ["restaurant", "cafe", "bar", "bakery"],
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
          displayName: { text: "遠いカフェ" },
          formattedAddress: "東京都渋谷区神南1-1-1",
          googleMapsTypeLabel: { text: "カフェ" },
          googleMapsUri: "https://maps.google.com/?cid=far",
          location: { latitude: 35.6605, longitude: 139.7048 },
        },
        {
          id: "near-place",
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
        places: [
          {
            id: "missing-name",
            formattedAddress: "東京都渋谷区",
            location: { latitude: 35.6584, longitude: 139.7042 },
          },
        ],
      },
      { latitude: 35.65833333333333, longitude: 139.70416666666668 },
    ),
    [],
  );
});

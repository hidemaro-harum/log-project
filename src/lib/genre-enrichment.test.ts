import assert from "node:assert/strict";
import test from "node:test";
import { createGooglePlaceDetailsRequest, inferGenre } from "./genre-enrichment.ts";

test("creates a field-masked Japanese Place Details request", () => {
  const request = createGooglePlaceDetailsRequest({ apiKey: "secret", placeId: "place/id" });
  assert.match(request.url, /place%2Fid\?languageCode=ja/);
  assert.match(request.init.headers["X-Goog-FieldMask"], /primaryType/);
});

test("maps specific Google types to a curated Japanese genre", () => {
  assert.deepEqual(inferGenre({ primaryType: "ramen_restaurant", primaryTypeDisplayName: { text: "ラーメン店" } }, "麺処"), {
    genre: "ラーメン",
    raw: "ラーメン店",
    source: "google_places",
    confidence: "high",
  });
});

test("uses the restaurant name when Google only returns a generic restaurant type", () => {
  assert.deepEqual(inferGenre({ primaryType: "restaurant", primaryTypeDisplayName: { text: "レストラン" }, displayName: { text: "銀座 鮨まる" } }, "鮨まる"), {
    genre: "寿司",
    raw: "レストラン",
    source: "name",
    confidence: "medium",
  });
});

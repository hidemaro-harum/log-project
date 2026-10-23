import assert from "node:assert/strict";
import test from "node:test";
import {
  authenticatePlaceRequest,
  createPlaceRateLimiter,
  fetchPlaceJson,
  parseCoordinate,
  parseRadiusMeters,
  parseRestaurantRequest,
} from "./places-api.ts";
import { createGoogleNearbySearchRequest } from "./place-suggestions.ts";

test("omitted or blank radius preserves the 150 m nearby search default", () => {
  for (const radius of [null, "", "   ", "invalid"]) {
    const request = createGoogleNearbySearchRequest({
      apiKey: "test-key",
      location: { latitude: 35, longitude: 139 },
      radiusMeters: parseRadiusMeters(radius),
    });
    assert.equal(JSON.parse(request.init.body).locationRestriction.circle.radius, 150);
  }
  assert.equal(parseRadiusMeters("25"), 50);
  assert.equal(parseRadiusMeters("250"), 250);
  assert.equal(parseRadiusMeters("1000"), 500);
});

test("coordinates reject missing, blank, non-finite and out-of-range values but accept zero", () => {
  for (const input of [null, "", "  ", "NaN", "Infinity", "91", "-91"]) {
    assert.equal(parseCoordinate(input, -90, 90), null);
  }
  assert.equal(parseCoordinate("0", -90, 90), 0);
  assert.equal(parseCoordinate("-90", -90, 90), -90);
  assert.equal(parseCoordinate("180", -180, 180), 180);
});

test("restaurant requests validate IDs and never coerce a string into an apply instruction", () => {
  const restaurantId = "ae7c0c3a-d293-4f35-b0c2-6454716f094a";
  assert.deepEqual(parseRestaurantRequest({ restaurantId, applyBest: true }), { restaurantId, applyBest: true });
  assert.deepEqual(parseRestaurantRequest({ restaurantId }), { restaurantId, applyBest: false });
  for (const body of [null, [], "text", {}, { restaurantId: 123 }, { restaurantId: "" }, { restaurantId: "invalid" }, { restaurantId, applyBest: "false" }]) {
    assert.equal(parseRestaurantRequest(body), null);
  }
});

test("rate limits isolate users, expose the remaining wait and reset at the boundary", () => {
  let now = 1_000;
  const limit = createPlaceRateLimiter(2, 60_000, () => now);
  assert.equal(limit("user-a"), null);
  assert.equal(limit("user-a"), null);
  now += 10_001;
  const blocked = limit("user-a");
  assert.equal(blocked?.status, 429);
  assert.equal(blocked?.headers.get("Retry-After"), "50");
  assert.equal(limit("user-b"), null);
  now = 61_000;
  assert.equal(limit("user-a"), null);
});

test("malformed authorization is rejected before starting an authentication request", async (context) => {
  const fetchMock = context.mock.method(globalThis, "fetch", () => { throw new Error("Unexpected fetch"); });
  for (const authorization of ["", "Basic abc", "Bearer", "Bearer token extra"]) {
    const auth = await authenticatePlaceRequest(new Request("http://localhost", { headers: { authorization } }));
    assert.equal(auth.error?.status, 401);
  }
  assert.equal(fetchMock.mock.callCount(), 0);
});

test("Places requests disable caching, attach a timeout and return parsed data", async (context) => {
  const fetchMock = context.mock.method(globalThis, "fetch", async () => Response.json({ places: [] }));
  const result = await fetchPlaceJson({ url: "https://places.googleapis.com/test", init: { method: "POST", headers: { "X-Goog-Api-Key": "test-key" } } }, "位置検索");
  assert.deepEqual(result.data, { places: [] });
  const options = fetchMock.mock.calls[0].arguments[1] as RequestInit;
  assert.equal(options.cache, "no-store");
  assert.ok(options.signal instanceof AbortSignal);
});

test("Places failures distinguish timeouts from unavailable or malformed upstream responses", async (context) => {
  const request = { url: "https://places.googleapis.com/test", init: {} };
  for (const [failure, status] of [
    [() => { throw new DOMException("Timed out", "TimeoutError"); }, 504],
    [() => { throw new TypeError("Network failure"); }, 502],
    [() => new Response("Unavailable", { status: 503 }), 502],
    [() => new Response("Not JSON"), 502],
    [() => Response.json(null), 502],
    [() => Response.json([]), 502],
  ] as const) {
    const fetchMock = context.mock.method(globalThis, "fetch", async () => failure());
    const result = await fetchPlaceJson(request, "位置検索");
    assert.equal(result.error?.status, status);
    fetchMock.mock.restore();
  }
});

import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test, { type TestContext } from "node:test";
import type { GoogleTextSearchResponse } from "./place-suggestions.ts";

// Use the same route modules as Next.js with the native TypeScript test runner.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      return nextResolve(new URL(`../${specifier.slice(2)}.ts`, import.meta.url).href, context);
    }
    return nextResolve(specifier === "next/server" ? "next/server.js" : specifier, context);
  },
});

const { NextRequest } = await import("next/server");
const { POST: resolveLocation } = await import("../app/api/places/resolve/route.ts");
const { POST: enrichGenre } = await import("../app/api/places/enrich-genre/route.ts");
const { GET: searchByName } = await import("../app/api/places/search/route.ts");
const { GET: searchNearby } = await import("../app/api/places/nearby/route.ts");
const restaurantId = "ae7c0c3a-d293-4f35-b0c2-6454716f094a";
const userId = "f69dbe4e-c050-499d-93f9-d362e2b2df70";
const updatedAt = "2026-01-01T00:00:00+00:00";

function mockServices(context: TestContext, options: {
  readFails?: boolean;
  conflict?: boolean;
  placeName?: string;
  places?: GoogleTextSearchResponse["places"];
} = {}) {
  const env = {
    NEXT_PUBLIC_SUPABASE_URL: "https://api-test.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "test-anon-key",
    GOOGLE_PLACES_API_KEY: "test-google-key",
  };
  for (const [key, value] of Object.entries(env)) {
    const previous = process.env[key];
    process.env[key] = value;
    context.after(() => {
      if (previous === undefined) delete process.env[key];
      else process.env[key] = previous;
    });
  }

  const updates: URL[] = [];
  const googleRequests: Array<{ pathname: string; body: Record<string, unknown> }> = [];
  context.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.pathname === "/auth/v1/user") return Response.json({ id: userId });
    if (url.pathname === "/rest/v1/restaurants") {
      assert.equal(url.searchParams.get("user_id"), `eq.${userId}`);
      assert.equal(url.searchParams.get("id"), `eq.${restaurantId}`);
      if (init?.method === "PATCH") {
        updates.push(url);
        return Response.json(options.conflict ? [] : [{ id: restaurantId }]);
      }
      if (options.readFails) return Response.json({ message: "Database read failed", code: "TEST" }, { status: 400 });
      return Response.json([{
        id: restaurantId,
        name: "テスト食堂",
        area: "東京都新宿区",
        genre: null,
        google_place_id: "place-id",
        latitude: null,
        longitude: null,
        updated_at: updatedAt,
      }]);
    }
    if (url.hostname === "places.googleapis.com") {
      googleRequests.push({ pathname: url.pathname, body: JSON.parse(String(init?.body ?? "{}")) });
      return Response.json({
        primaryType: "japanese_restaurant",
        places: options.places ?? [{
          id: "place-id",
          primaryType: "japanese_restaurant",
          displayName: { text: options.placeName ?? "テスト食堂" },
          formattedAddress: "東京都新宿区",
          location: { latitude: 35, longitude: 139 },
        }],
      });
    }
    throw new Error(`Unexpected request: ${url.origin}${url.pathname}`);
  });
  return { updates, googleRequests };
}

function request(body: unknown) {
  return new NextRequest("http://localhost/api/places/test", {
    method: "POST",
    headers: { Authorization: "Bearer test-token", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

for (const [name, handler] of [["location", resolveLocation], ["genre", enrichGenre]] as const) {
  test(`${name} enrichment protects newer edits and does not report a zero-row update as applied`, async (context) => {
    const { updates } = mockServices(context, { conflict: true });
    const response = await handler(request({ restaurantId, applyBest: true }));
    assert.equal(response.status, 409);
    assert.equal(updates.length, 1);
    assert.equal(updates[0].searchParams.get("updated_at"), `eq.${updatedAt}`);
    assert.equal((await response.json()).applied, undefined);
  });

  test(`${name} enrichment returns a server error when reading the restaurant fails`, async (context) => {
    const { updates } = mockServices(context, { readFails: true });
    const response = await handler(request({ restaurantId, applyBest: true }));
    assert.equal(response.status, 500);
    assert.equal(updates.length, 0);
  });

  test(`${name} enrichment confirms a successful write`, async (context) => {
    const { updates } = mockServices(context);
    const response = await handler(request({ restaurantId, applyBest: true }));
    assert.equal(response.status, 200);
    assert.equal((await response.json()).applied, true);
    assert.equal(updates.length, 1);
  });
}

test("location lookup without applyBest returns candidates without writing", async (context) => {
  const { updates } = mockServices(context);
  const response = await resolveLocation(request({ restaurantId }));
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.applied, false);
  assert.equal(result.matches.length, 1);
  assert.equal(updates.length, 0);
});

test("automatic location enrichment leaves an unrelated low-confidence result for review", async (context) => {
  const { updates } = mockServices(context, { placeName: "別のカフェ" });
  const response = await resolveLocation(request({ restaurantId, applyBest: true }));
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.applied, false);
  assert.equal(result.reason, "low_confidence");
  assert.equal(result.matches[0].confidence, "low");
  assert.equal(updates.length, 0);
});

test("automatic location enrichment never saves a matching name in a conflicting prefecture", async (context) => {
  const { updates } = mockServices(context, { places: [{
    id: "same-name-different-branch",
    displayName: { text: "テスト食堂" },
    formattedAddress: "大阪府大阪市中央区1-1",
    shortFormattedAddress: "中央区1-1",
    location: { latitude: 34.69, longitude: 135.5 },
  }] });
  const response = await resolveLocation(request({ restaurantId, applyBest: true }));
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.applied, false);
  assert.equal(result.reason, "low_confidence");
  assert.equal(result.matches[0].confidence, "low");
  assert.equal(updates.length, 0);
});

test("name and photo search require authentication before contacting Google", async (context) => {
  const fetchMock = context.mock.method(globalThis, "fetch", () => { throw new Error("Unexpected network request"); });
  for (const handler of [searchByName, searchNearby]) {
    const response = await handler(new NextRequest("http://localhost/api/places/search?query=食堂&lat=35&lng=139"));
    assert.equal(response.status, 401);
  }
  assert.equal(fetchMock.mock.callCount(), 0);
});

test("typed name search validates query and current location before contacting Google", async (context) => {
  const { googleRequests } = mockServices(context);
  for (const params of ["query=鮨&lat=35&lng=139", "query=食堂&lat=&lng=139", "query=食堂&lat=91&lng=139", "query=食堂&lat=35", `query=${"あ".repeat(101)}&lat=35&lng=139`]) {
    const response = await searchByName(new NextRequest(`http://localhost/api/places/search?${params}`, { headers: { Authorization: "Bearer test-token" } }));
    assert.equal(response.status, 400);
  }
  assert.equal(googleRequests.length, 0);
});

test("typed name search uses current geolocation and returns only dining establishments inside 3 km", async (context) => {
  const places = [
    { id: "cafe", primaryType: "cafe", latitude: 35.01 },
    { id: "restaurant", primaryType: "japanese_restaurant", latitude: 35.001 },
    { id: "hotel", primaryType: "hotel", latitude: 35 },
    { id: "shop", primaryType: "store", latitude: 35 },
    { id: "distant", primaryType: "restaurant", latitude: 35.1 },
  ].map(({ latitude, ...place }) => ({ ...place, displayName: { text: place.id }, location: { latitude, longitude: 139 }, types: ["restaurant"] }));
  const { googleRequests } = mockServices(context, { places });
  const response = await searchByName(new NextRequest("http://localhost/api/places/search?query=テスト&lat=35&lng=139", { headers: { Authorization: "Bearer test-token" } }));
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).suggestions.map((place: { id: string }) => place.id), ["cafe", "restaurant"]);
  assert.equal(googleRequests.length, 1);
  assert.equal(googleRequests[0].pathname, "/v1/places:searchText");
  assert.equal(googleRequests[0].body.textQuery, "テスト");
  assert.deepEqual(googleRequests[0].body.locationBias, { circle: { center: { latitude: 35, longitude: 139 }, radius: 3_000 } });
});

test("photo search restricts primary types and defensively removes hotel and shop candidates", async (context) => {
  const places = ["hotel", "store", "restaurant"].map((primaryType) => ({
    id: primaryType,
    primaryType,
    displayName: { text: primaryType },
    location: { latitude: 35, longitude: 139 },
    types: ["restaurant", "food"],
  }));
  const { googleRequests } = mockServices(context, { places });
  const response = await searchNearby(new NextRequest("http://localhost/api/places/nearby?lat=35&lng=139", { headers: { Authorization: "Bearer test-token" } }));
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).suggestions.map((place: { id: string }) => place.id), ["restaurant"]);
  assert.equal(googleRequests[0].pathname, "/v1/places:searchNearby");
  assert.equal(googleRequests[0].body.includedTypes, undefined);
  assert.ok((googleRequests[0].body.includedPrimaryTypes as string[]).includes("restaurant"));
});

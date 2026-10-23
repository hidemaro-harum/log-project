import { NextRequest, NextResponse } from "next/server";
import { authenticatePlaceRequest, createPlaceRateLimiter, fetchPlaceJson, parseCoordinate, parseRadiusMeters } from "@/lib/places-api";
import {
  createGoogleNearbySearchRequest,
  toPlaceSuggestions,
  type GoogleNearbySearchResponse,
} from "@/lib/place-suggestions";

const checkRateLimit = createPlaceRateLimiter(20, 60_000);

export async function GET(request: NextRequest) {
  const auth = await authenticatePlaceRequest(request);
  if (auth.error) return auth.error;

  const latitude = parseCoordinate(request.nextUrl.searchParams.get("lat"), -90, 90);
  const longitude = parseCoordinate(request.nextUrl.searchParams.get("lng"), -180, 180);

  if (latitude === null || longitude === null) {
    return NextResponse.json({ error: "写真の位置情報が不正です。" }, { status: 400 });
  }
  const rateLimitError = checkRateLimit(auth.userId);
  if (rateLimitError) return rateLimitError;

  const apiKey = process.env.GOOGLE_PLACES_API_KEY || process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "GOOGLE_PLACES_API_KEY が未設定です。" }, { status: 503 });
  }

  const nearbyRequest = createGoogleNearbySearchRequest({
    apiKey,
    location: { latitude, longitude },
    radiusMeters: parseRadiusMeters(request.nextUrl.searchParams.get("radius")),
  });

  const result = await fetchPlaceJson<GoogleNearbySearchResponse>(nearbyRequest, "店舗候補の検索");
  if (result.error) return result.error;
  return NextResponse.json({
    suggestions: toPlaceSuggestions(result.data, { latitude, longitude }),
  });
}

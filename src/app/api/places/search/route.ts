import { NextRequest, NextResponse } from "next/server";
import { authenticatePlaceRequest, createPlaceRateLimiter, fetchPlaceJson, parseCoordinate } from "@/lib/places-api";
import {
  createGoogleNameSearchRequest,
  parsePlaceSearchQuery,
  toNameSearchSuggestions,
  type GoogleTextSearchResponse,
} from "@/lib/place-suggestions";

const checkRateLimit = createPlaceRateLimiter(30, 60_000);

export async function GET(request: NextRequest) {
  const auth = await authenticatePlaceRequest(request);
  if (auth.error) return auth.error;

  const query = parsePlaceSearchQuery(request.nextUrl.searchParams.get("query"));
  const latitude = parseCoordinate(request.nextUrl.searchParams.get("lat"), -90, 90);
  const longitude = parseCoordinate(request.nextUrl.searchParams.get("lng"), -180, 180);
  if (!query) return NextResponse.json({ error: "店名は2〜100文字で入力してください。" }, { status: 400 });
  if (latitude === null || longitude === null) {
    return NextResponse.json({ error: "現在地の位置情報が不正です。" }, { status: 400 });
  }
  const rateLimitError = checkRateLimit(auth.userId);
  if (rateLimitError) return rateLimitError;

  const apiKey = process.env.GOOGLE_PLACES_API_KEY || process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "店舗候補の検索が設定されていません。" }, { status: 503 });

  const location = { latitude, longitude };
  const placeRequest = createGoogleNameSearchRequest({ apiKey, query, location });
  const result = await fetchPlaceJson<GoogleTextSearchResponse>(placeRequest, "店舗候補の検索");
  if (result.error) return result.error;
  return NextResponse.json({ suggestions: toNameSearchSuggestions(result.data, location) });
}

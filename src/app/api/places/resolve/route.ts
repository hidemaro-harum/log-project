import { NextRequest, NextResponse } from "next/server";
import { authenticatePlaceRequest, createPlaceRateLimiter, fetchPlaceJson, parseRestaurantRequest } from "@/lib/places-api";
import {
  createGoogleTextSearchRequest,
  resolveTextSearchResults,
  type GoogleTextSearchResponse,
} from "@/lib/place-suggestions";
import { inferPrefectureCode } from "@/lib/japan-prefectures";

const checkRateLimit = createPlaceRateLimiter(500, 60 * 60_000);

export async function POST(request: NextRequest) {
  const auth = await authenticatePlaceRequest(request);
  if (auth.error) return auth.error;
  const { client, userId } = auth;

  const body = parseRestaurantRequest(await request.json().catch(() => null));
  if (!body) return NextResponse.json({ error: "店舗IDまたはリクエストが不正です。" }, { status: 400 });
  const rateLimitError = checkRateLimit(userId);
  if (rateLimitError) return rateLimitError;

  const { data: restaurant, error: readError } = await client
    .from("restaurants")
    .select("id, name, area, latitude, longitude, updated_at")
    .eq("id", body.restaurantId)
    .eq("user_id", userId)
    .maybeSingle();
  if (readError) return NextResponse.json({ error: "店舗情報を取得できませんでした。" }, { status: 500 });
  if (!restaurant) return NextResponse.json({ error: "店舗が見つかりません。" }, { status: 404 });
  if (restaurant.latitude !== null && restaurant.longitude !== null) {
    return NextResponse.json({ error: "この店舗には位置情報があります。" }, { status: 409 });
  }

  const apiKey = process.env.GOOGLE_PLACES_API_KEY || process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "位置検索が設定されていません。" }, { status: 503 });

  const placeRequest = createGoogleTextSearchRequest({ apiKey, name: restaurant.name, area: restaurant.area ?? "" });
  const result = await fetchPlaceJson<GoogleTextSearchResponse>(placeRequest, "位置検索");
  if (result.error) return result.error;

  const matches = resolveTextSearchResults(result.data, restaurant.name, restaurant.area ?? "");
  const best = matches[0];
  if (!body.applyBest || !best?.location) return NextResponse.json({ matches, applied: false });
  if (best.confidence === "low") return NextResponse.json({ matches, applied: false, reason: "low_confidence" });

  const { data: updated, error: updateError } = await client.from("restaurants").update({
    latitude: best.location.latitude,
    longitude: best.location.longitude,
    prefecture_code: inferPrefectureCode(best.address) ?? inferPrefectureCode(restaurant.area),
    google_place_id: best.id,
    location_source: "geocoded",
    location_confidence: best.confidence,
    location_verified_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("id", restaurant.id).eq("user_id", userId)
    .eq("updated_at", restaurant.updated_at).select("id").maybeSingle();
  if (updateError) return NextResponse.json({ error: "位置情報を保存できませんでした。" }, { status: 500 });
  if (!updated) return NextResponse.json({ error: "店舗情報が変更されています。再読み込みしてお試しください。" }, { status: 409 });

  return NextResponse.json({ matches, applied: true, confidence: best.confidence });
}

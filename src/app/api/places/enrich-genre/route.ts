import { NextRequest, NextResponse } from "next/server";
import { authenticatePlaceRequest, createPlaceRateLimiter, fetchPlaceJson, parseRestaurantRequest } from "@/lib/places-api";
import { createGooglePlaceDetailsRequest, inferGenre, type PlaceGenreDetails } from "@/lib/genre-enrichment";

const checkRateLimit = createPlaceRateLimiter(500, 60 * 60_000);

export async function POST(request: NextRequest) {
  const auth = await authenticatePlaceRequest(request);
  if (auth.error) return auth.error;
  const { client, userId } = auth;

  const body = parseRestaurantRequest(await request.json().catch(() => null));
  if (!body) return NextResponse.json({ error: "店舗IDまたはリクエストが不正です。" }, { status: 400 });
  const rateLimitError = checkRateLimit(userId);
  if (rateLimitError) return rateLimitError;
  const { data: restaurant, error: readError } = await client.from("restaurants")
    .select("id, name, genre, google_place_id, updated_at")
    .eq("id", body.restaurantId).eq("user_id", userId).maybeSingle();
  if (readError) return NextResponse.json({ error: "店舗情報を取得できませんでした。" }, { status: 500 });
  if (!restaurant) return NextResponse.json({ error: "店舗が見つかりません。" }, { status: 404 });
  if (restaurant.genre?.trim()) return NextResponse.json({ applied: false, reason: "already_set" });
  if (!restaurant.google_place_id) return NextResponse.json({ applied: false, reason: "missing_place_id" });

  const apiKey = process.env.GOOGLE_PLACES_API_KEY || process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "ジャンル検索が設定されていません。" }, { status: 503 });
  const placeRequest = createGooglePlaceDetailsRequest({ apiKey, placeId: restaurant.google_place_id });
  const result = await fetchPlaceJson<PlaceGenreDetails>(placeRequest, "ジャンル検索");
  if (result.error) return result.error;

  const enrichment = inferGenre(result.data, restaurant.name);
  if (!enrichment) return NextResponse.json({ applied: false, reason: "unresolved" });
  const { data: updated, error } = await client.from("restaurants").update({
    genre: enrichment.genre,
    genre_source: enrichment.source,
    genre_confidence: enrichment.confidence,
    genre_raw: enrichment.raw,
    updated_at: new Date().toISOString(),
  }).eq("id", restaurant.id).eq("user_id", userId)
    .eq("updated_at", restaurant.updated_at).select("id").maybeSingle();
  if (error) return NextResponse.json({ error: "ジャンルを保存できませんでした。" }, { status: 500 });
  if (!updated) return NextResponse.json({ error: "店舗情報が変更されています。再読み込みしてお試しください。" }, { status: 409 });
  return NextResponse.json({ applied: true, ...enrichment });
}

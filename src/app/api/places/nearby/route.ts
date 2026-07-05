import { NextRequest, NextResponse } from "next/server";
import {
  createGoogleNearbySearchRequest,
  toPlaceSuggestions,
  type GoogleNearbySearchResponse,
} from "@/lib/place-suggestions";

export async function GET(request: NextRequest) {
  const latitude = parseCoordinate(request.nextUrl.searchParams.get("lat"), -90, 90);
  const longitude = parseCoordinate(request.nextUrl.searchParams.get("lng"), -180, 180);

  if (latitude === null || longitude === null) {
    return NextResponse.json({ error: "写真の位置情報が不正です。" }, { status: 400 });
  }

  const apiKey = process.env.GOOGLE_PLACES_API_KEY || process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "GOOGLE_PLACES_API_KEY が未設定です。" }, { status: 503 });
  }

  const nearbyRequest = createGoogleNearbySearchRequest({
    apiKey,
    location: { latitude, longitude },
    radiusMeters: parseRadiusMeters(request.nextUrl.searchParams.get("radius")),
  });

  const response = await fetch(nearbyRequest.url, {
    ...nearbyRequest.init,
    cache: "no-store",
  });

  if (!response.ok) {
    return NextResponse.json(
      { error: `Google Places API の検索に失敗しました。${await response.text()}` },
      { status: 502 },
    );
  }

  const payload = (await response.json()) as GoogleNearbySearchResponse;
  return NextResponse.json({
    suggestions: toPlaceSuggestions(payload, { latitude, longitude }),
  });
}

function parseCoordinate(value: string | null, min: number, max: number) {
  if (value === null) return null;
  const coordinate = Number(value);
  if (!Number.isFinite(coordinate) || coordinate < min || coordinate > max) return null;
  return coordinate;
}

function parseRadiusMeters(value: string | null) {
  const radius = Number(value);
  if (!Number.isFinite(radius)) return undefined;
  return Math.min(Math.max(radius, 50), 500);
}

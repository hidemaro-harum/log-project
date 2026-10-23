import type { Restaurant } from "../types/database.ts";
import type { PlaceSuggestion } from "./place-suggestions.ts";
import { inferPrefectureCode } from "./japan-prefectures.ts";

export type RestaurantLocationPayload = {
  latitude: number | null;
  longitude: number | null;
  prefecture_code: number | null;
  google_place_id: string | null;
  location_source: NonNullable<Restaurant["location_source"]> | null;
  location_confidence: NonNullable<Restaurant["location_confidence"]> | null;
  location_verified_at: string | null;
};

type RestaurantPlaceSelectionInput = {
  currentName: string;
  currentArea: string | null;
  selectedPlace: PlaceSuggestion | null;
  original?: Restaurant;
  verifiedAt?: string;
};

/** Save location metadata together, only while it still describes the edited identity. */
export function getRestaurantPlaceSelection({
  currentName,
  currentArea,
  selectedPlace,
  original,
  verifiedAt = new Date().toISOString(),
}: RestaurantPlaceSelectionInput): RestaurantLocationPayload {
  const selectedMatches = selectedPlace?.id.trim()
    && sameIdentity(currentName, currentArea, selectedPlace.name, selectedPlace.address);

  if (selectedPlace && selectedMatches) {
    const location = selectedPlace.location;
    const hasCoordinates = location !== null
      && Number.isFinite(location.latitude) && Math.abs(location.latitude) <= 90
      && Number.isFinite(location.longitude) && Math.abs(location.longitude) <= 180;
    return {
      latitude: hasCoordinates ? location.latitude : null,
      longitude: hasCoordinates ? location.longitude : null,
      prefecture_code: inferPrefectureCode(currentArea),
      google_place_id: selectedPlace.id,
      location_source: hasCoordinates ? "place" : null,
      location_confidence: hasCoordinates ? "high" : null,
      location_verified_at: hasCoordinates ? verifiedAt : null,
    };
  }

  if (original && sameIdentity(currentName, currentArea, original.name, original.area)) {
    return {
      latitude: original.latitude ?? null,
      longitude: original.longitude ?? null,
      prefecture_code: original.prefecture_code ?? inferPrefectureCode(currentArea),
      google_place_id: original.google_place_id ?? null,
      location_source: original.location_source ?? null,
      location_confidence: original.location_confidence ?? null,
      location_verified_at: original.location_verified_at ?? null,
    };
  }

  return {
    latitude: null,
    longitude: null,
    prefecture_code: inferPrefectureCode(currentArea),
    google_place_id: null,
    location_source: null,
    location_confidence: null,
    location_verified_at: null,
  };
}

function sameIdentity(name: string, area: string | null, otherName: string, otherArea: string | null) {
  return normalize(name) === normalize(otherName) && normalize(area) === normalize(otherArea);
}

function normalize(value: string | null) {
  return (value ?? "").normalize("NFKC").trim().replace(/\s+/g, " ");
}

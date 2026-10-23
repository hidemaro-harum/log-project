import type { PhotoCoordinates } from "./photo-location";
import { inferPrefectureCode } from "./japan-prefectures.ts";

export type PlaceSuggestion = {
  id: string;
  name: string;
  address: string;
  genre: string;
  googleMapsUrl: string | null;
  distanceMeters: number | null;
  location: PhotoCoordinates | null;
};

export type GoogleNearbySearchResponse = {
  places?: GooglePlace[];
};

export type GoogleTextSearchResponse = GoogleNearbySearchResponse;

export type ResolvedPlace = PlaceSuggestion & {
  confidence: "high" | "medium" | "low";
};

type GoogleNearbySearchRequestInput = {
  apiKey: string;
  location: PhotoCoordinates;
  radiusMeters?: number;
};

type GoogleNearbySearchRequest = {
  url: string;
  init: {
    method: "POST";
    headers: Record<string, string>;
    body: string;
  };
};

type GooglePlace = {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  googleMapsTypeLabel?: { text?: string };
  googleMapsUri?: string;
  location?: { latitude?: number; longitude?: number };
  primaryType?: string;
  primaryTypeDisplayName?: { text?: string };
  shortFormattedAddress?: string;
  types?: string[];
};

const EARTH_RADIUS_METERS = 6_371_000;
const GOOGLE_NEARBY_SEARCH_URL = "https://places.googleapis.com/v1/places:searchNearby";
const GOOGLE_TEXT_SEARCH_URL = "https://places.googleapis.com/v1/places:searchText";
const GOOGLE_PLACES_FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.shortFormattedAddress",
  "places.primaryType",
  "places.primaryTypeDisplayName",
  "places.googleMapsTypeLabel",
  "places.googleMapsUri",
  "places.location",
  "places.types",
].join(",");
// Google expands the generic restaurant primary type to cuisine-specific types.
// Keep non-restaurant food venues explicit; hotel/store secondary tags are not sufficient.
// https://developers.google.com/maps/documentation/places/web-service/place-types
const DINING_PRIMARY_TYPES = [
  "restaurant", "acai_shop", "bagel_shop", "bakery", "bar", "bar_and_grill",
  "beer_garden", "bistro", "brewpub", "cafe", "cafeteria", "cake_shop", "cat_cafe",
  "cocktail_bar", "coffee_shop", "coffee_stand", "confectionery", "deli", "dessert_shop",
  "diner", "dog_cafe", "donut_shop", "food_court", "gastropub", "hot_dog_stand",
  "ice_cream_shop", "irish_pub", "juice_shop", "kebab_shop", "lounge_bar", "meal_takeaway",
  "noodle_shop", "pastry_shop", "pub", "salad_shop", "sandwich_shop", "snack_bar",
  "sports_bar", "steak_house", "tea_house", "wine_bar",
];
const diningPrimaryTypes = new Set(DINING_PRIMARY_TYPES);
export const NAME_SEARCH_RADIUS_METERS = 3_000;

export function parsePlaceSearchQuery(value: string | null) {
  const query = value?.normalize("NFKC").trim().replace(/\s+/g, " ") ?? "";
  return query.length >= 2 && query.length <= 100 ? query : null;
}

export function createGoogleNameSearchRequest({
  apiKey,
  query,
  location,
}: { apiKey: string; query: string; location: PhotoCoordinates }): GoogleNearbySearchRequest {
  return {
    url: GOOGLE_TEXT_SEARCH_URL,
    init: {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": GOOGLE_PLACES_FIELD_MASK,
      },
      body: JSON.stringify({
        textQuery: query,
        languageCode: "ja",
        regionCode: "JP",
        pageSize: 20,
        locationBias: { circle: { center: location, radius: NAME_SEARCH_RADIUS_METERS } },
        // Text Search accepts only one includedType, which would omit cafes/bars/bakeries.
        // Filter all results by dining primary type and exact distance below instead.
      }),
    },
  };
}

export function toNameSearchSuggestions(response: GoogleTextSearchResponse, origin: PhotoCoordinates): PlaceSuggestion[] {
  return getDiningSuggestions(response, origin)
    .filter((suggestion) => suggestion.location && getDistanceMeters(origin, suggestion.location) <= NAME_SEARCH_RADIUS_METERS)
    .slice(0, 8);
}

export function createGoogleTextSearchRequest({ apiKey, name, area }: { apiKey: string; name: string; area: string }) {
  return {
    url: GOOGLE_TEXT_SEARCH_URL,
    init: {
      method: "POST" as const,
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": GOOGLE_PLACES_FIELD_MASK,
      },
      body: JSON.stringify({
        textQuery: `${name} ${area}`.trim(),
        languageCode: "ja",
        regionCode: "JP",
        maxResultCount: 5,
      }),
    },
  };
}

export function resolveTextSearchResults(response: GoogleTextSearchResponse, name: string, area: string): ResolvedPlace[] {
  const matches: ResolvedPlace[] = [];
  const requestedPrefecture = inferPrefectureCode(area);
  for (const place of response.places ?? []) {
      const location = getPlaceLocation(place);
      const placeName = place.displayName?.text?.trim();
      if (!location || !placeName) continue;
      const address = place.shortFormattedAddress || place.formattedAddress || "";
      const nameScore = getNameSimilarity(name, placeName);
      const normalizedArea = normalizeSearchText(area);
      const normalizedAddress = normalizeSearchText(address);
      const areaMatches = normalizedArea.length >= 2 && normalizedAddress.length >= 2 && (
        normalizedAddress.includes(normalizedArea) || normalizedArea.includes(normalizedAddress)
      );
      const resultPrefecture = inferPrefectureCode(place.formattedAddress) ?? inferPrefectureCode(address);
      const conflictingPrefecture = requestedPrefecture !== null && resultPrefecture !== null
        && requestedPrefecture !== resultPrefecture;
      const confidence = conflictingPrefecture ? "low"
        : nameScore >= 0.9 && areaMatches ? "high" : nameScore >= 0.72 ? "medium" : "low";
      matches.push({
        id: place.id || placeName,
        name: placeName,
        address,
        genre: getPlaceGenre(place),
        googleMapsUrl: place.googleMapsUri || null,
        distanceMeters: null,
        location,
        confidence,
      });
  }
  return matches.sort((a, b) => confidenceRank(b.confidence) - confidenceRank(a.confidence));
}

export function createGoogleNearbySearchRequest({
  apiKey,
  location,
  radiusMeters = 150,
}: GoogleNearbySearchRequestInput): GoogleNearbySearchRequest {
  return {
    url: GOOGLE_NEARBY_SEARCH_URL,
    init: {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": GOOGLE_PLACES_FIELD_MASK,
      },
      body: JSON.stringify({
        includedPrimaryTypes: DINING_PRIMARY_TYPES,
        languageCode: "ja",
        locationRestriction: {
          circle: {
            center: location,
            radius: radiusMeters,
          },
        },
        maxResultCount: 8,
        rankPreference: "DISTANCE",
      }),
    },
  };
}

export function toPlaceSuggestions(
  response: GoogleNearbySearchResponse,
  origin: PhotoCoordinates,
): PlaceSuggestion[] {
  return getDiningSuggestions(response, origin)
    .sort((first, second) => (first.distanceMeters ?? Infinity) - (second.distanceMeters ?? Infinity));
}

function getDiningSuggestions(response: GoogleNearbySearchResponse, origin: PhotoCoordinates) {
  return (Array.isArray(response.places) ? response.places : [])
    .map((place) => toPlaceSuggestion(place, origin))
    .filter((suggestion): suggestion is PlaceSuggestion => Boolean(suggestion));
}

function toPlaceSuggestion(place: GooglePlace, origin: PhotoCoordinates): PlaceSuggestion | null {
  const primaryType = place?.primaryType;
  if (typeof primaryType !== "string" || (!diningPrimaryTypes.has(primaryType) && !primaryType.endsWith("_restaurant"))) return null;
  const name = typeof place.displayName?.text === "string" ? place.displayName.text.trim() : "";
  const id = typeof place.id === "string" ? place.id.trim() : "";
  if (!name || !id) return null;

  const location = getPlaceLocation(place);
  if (!location) return null;

  return {
    id,
    name,
    address: place.shortFormattedAddress || place.formattedAddress || "",
    genre: getPlaceGenre(place),
    googleMapsUrl: place.googleMapsUri || null,
    distanceMeters: Math.round(getDistanceMeters(origin, location)),
    location,
  };
}

function getPlaceLocation(place: GooglePlace): PhotoCoordinates | null {
  const latitude = place.location?.latitude;
  const longitude = place.location?.longitude;
  if (typeof latitude !== "number" || typeof longitude !== "number") return null;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  return { latitude, longitude };
}

function getPlaceGenre(place: GooglePlace) {
  return (
    place.googleMapsTypeLabel?.text?.trim() ||
    place.primaryTypeDisplayName?.text?.trim() ||
    place.primaryType?.replaceAll("_", " ") ||
    place.types?.[0]?.replaceAll("_", " ") ||
    ""
  );
}

function getDistanceMeters(first: PhotoCoordinates, second: PhotoCoordinates) {
  const firstLatitude = toRadians(first.latitude);
  const secondLatitude = toRadians(second.latitude);
  const latitudeDelta = toRadians(second.latitude - first.latitude);
  const longitudeDelta = toRadians(second.longitude - first.longitude);
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(firstLatitude) * Math.cos(secondLatitude) * Math.sin(longitudeDelta / 2) ** 2;

  return EARTH_RADIUS_METERS * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

function toRadians(degrees: number) {
  return (degrees * Math.PI) / 180;
}

function normalizeSearchText(value: string) {
  return value.normalize("NFKC").toLowerCase().replace(/(?:株式会社|有限会社|店|本店|支店|[\s・･\-ー_()（）])/g, "");
}

function getNameSimilarity(first: string, second: string) {
  const a = normalizeSearchText(first);
  const b = normalizeSearchText(second);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return Math.min(a.length, b.length) / Math.max(a.length, b.length);
  const aPairs = new Set(Array.from({ length: Math.max(0, a.length - 1) }, (_, index) => a.slice(index, index + 2)));
  const bPairs = new Set(Array.from({ length: Math.max(0, b.length - 1) }, (_, index) => b.slice(index, index + 2)));
  if (!aPairs.size || !bPairs.size) return 0;
  let overlap = 0;
  for (const pair of aPairs) if (bPairs.has(pair)) overlap += 1;
  return (2 * overlap) / (aPairs.size + bPairs.size);
}

function confidenceRank(value: ResolvedPlace["confidence"]) {
  return value === "high" ? 3 : value === "medium" ? 2 : 1;
}

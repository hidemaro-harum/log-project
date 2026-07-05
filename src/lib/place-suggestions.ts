import type { PhotoCoordinates } from "./photo-location";

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
const FOOD_PLACE_TYPES = ["restaurant", "cafe", "bar", "bakery"];

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
        includedTypes: FOOD_PLACE_TYPES,
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
  return (response.places ?? [])
    .map((place) => toPlaceSuggestion(place, origin))
    .filter((suggestion): suggestion is PlaceSuggestion => Boolean(suggestion))
    .sort((first, second) => {
      if (first.distanceMeters === null) return 1;
      if (second.distanceMeters === null) return -1;
      return first.distanceMeters - second.distanceMeters;
    });
}

function toPlaceSuggestion(place: GooglePlace, origin: PhotoCoordinates): PlaceSuggestion | null {
  const name = place.displayName?.text?.trim();
  if (!name) return null;

  const location = getPlaceLocation(place);

  return {
    id: place.id || name,
    name,
    address: place.shortFormattedAddress || place.formattedAddress || "",
    genre: getPlaceGenre(place),
    googleMapsUrl: place.googleMapsUri || null,
    distanceMeters: location ? Math.round(getDistanceMeters(origin, location)) : null,
    location,
  };
}

function getPlaceLocation(place: GooglePlace): PhotoCoordinates | null {
  const latitude = place.location?.latitude;
  const longitude = place.location?.longitude;
  if (typeof latitude !== "number" || typeof longitude !== "number") return null;
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

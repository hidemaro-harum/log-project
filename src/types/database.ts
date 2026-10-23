export type RestaurantStatus = "visited" | "wishlist";

export type Restaurant = {
  id: string;
  user_id: string;
  name: string;
  area: string | null;
  genre: string | null;
  genre_source?: "manual" | "google_places" | "name" | null;
  genre_confidence?: "high" | "medium" | "low" | null;
  genre_raw?: string | null;
  status: RestaurantStatus;
  memo: string | null;
  rating: number | null;
  wants_to_revisit?: boolean;
  price_range?: "budget" | "standard" | "special" | null;
  occasions?: string[];
  crowd_level?: "quiet" | "normal" | "busy" | null;
  visit_count?: number;
  latest_visit_at?: string | null;
  average_rating?: number | null;
  latitude?: number | null;
  longitude?: number | null;
  prefecture_code?: number | null;
  google_place_id?: string | null;
  location_source?: "place" | "photo" | "geocoded" | "manual" | null;
  location_confidence?: "high" | "medium" | "low" | null;
  location_verified_at?: string | null;
  created_at: string;
  updated_at: string;
  tags?: Tag[];
  visits?: Visit[];
  photos?: Photo[];
};

export type Visit = {
  id: string;
  restaurant_id: string;
  user_id: string;
  visited_at: string;
  dish_name: string | null;
  memo: string | null;
  rating: number | null;
  created_at: string;
};

export type Photo = {
  id: string;
  restaurant_id: string;
  visit_id: string | null;
  user_id: string;
  storage_path: string;
  caption: string | null;
  sort_order?: number;
  created_at: string;
};

export type Tag = { id: string; user_id: string; name: string; created_at: string };

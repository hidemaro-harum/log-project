export type RestaurantStatus = "visited" | "wishlist";

export type Restaurant = {
  id: string;
  user_id: string;
  name: string;
  area: string | null;
  genre: string | null;
  status: RestaurantStatus;
  memo: string | null;
  rating: number | null;
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
  created_at: string;
};

export type Tag = { id: string; user_id: string; name: string; created_at: string };

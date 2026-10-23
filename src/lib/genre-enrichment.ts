export type PlaceGenreDetails = {
  displayName?: { text?: string };
  googleMapsTypeLabel?: { text?: string };
  primaryType?: string;
  primaryTypeDisplayName?: { text?: string };
  types?: string[];
};

export type GenreEnrichment = {
  genre: string;
  raw: string;
  source: "google_places" | "name";
  confidence: "high" | "medium" | "low";
};

const TYPE_GENRES: Record<string, string> = {
  ramen_restaurant: "ラーメン",
  sushi_restaurant: "寿司",
  japanese_restaurant: "和食",
  chinese_restaurant: "中華料理",
  korean_restaurant: "韓国料理",
  italian_restaurant: "イタリアン",
  french_restaurant: "フレンチ",
  indian_restaurant: "インド料理",
  thai_restaurant: "タイ料理",
  vietnamese_restaurant: "ベトナム料理",
  mexican_restaurant: "メキシコ料理",
  seafood_restaurant: "海鮮料理",
  steak_house: "ステーキ",
  barbecue_restaurant: "焼肉・焼き物",
  hamburger_restaurant: "ハンバーガー",
  pizza_restaurant: "ピザ",
  breakfast_restaurant: "朝食・喫茶",
  brunch_restaurant: "カフェ・ブランチ",
  cafe: "カフェ",
  coffee_shop: "カフェ",
  bakery: "パン・ベーカリー",
  dessert_shop: "スイーツ",
  ice_cream_shop: "スイーツ",
  confectionery: "スイーツ",
  bar: "バー",
  pub: "居酒屋・パブ",
  izakaya: "居酒屋",
  meal_takeaway: "テイクアウト",
};

const NAME_RULES: Array<[RegExp, string]> = [
  [/ラーメン|らーめん|麺屋|つけ麺|中華そば/, "ラーメン"],
  [/寿司|鮨|すし/, "寿司"],
  [/焼肉|ホルモン/, "焼肉"],
  [/蕎麦|そば/, "そば"],
  [/うどん/, "うどん"],
  [/カレー/, "カレー"],
  [/珈琲|コーヒー|カフェ|喫茶/, "カフェ"],
  [/居酒屋|酒場|大衆酒場|やきとり|焼鳥/, "居酒屋"],
  [/餃子|中華|四川|広東/, "中華料理"],
  [/ピッツァ|ピザ/, "ピザ"],
  [/パスタ|トラットリア|リストランテ/, "イタリアン"],
  [/ベーカリー|パン工房|製パン/, "パン・ベーカリー"],
  [/ケーキ|パティスリー|洋菓子|甘味/, "スイーツ"],
  [/とんかつ|豚カツ/, "とんかつ"],
  [/天ぷら|天麩羅/, "天ぷら"],
  [/牛丼|定食|食堂/, "定食・食堂"],
];

export function createGooglePlaceDetailsRequest({ apiKey, placeId }: { apiKey: string; placeId: string }) {
  return {
    url: `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}?languageCode=ja&regionCode=JP`,
    init: {
      method: "GET" as const,
      headers: {
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": "displayName,googleMapsTypeLabel,primaryType,primaryTypeDisplayName,types",
      },
    },
  };
}

export function inferGenre(details: PlaceGenreDetails, restaurantName: string): GenreEnrichment | null {
  const raw = details.googleMapsTypeLabel?.text?.trim() || details.primaryTypeDisplayName?.text?.trim() || "";
  const types = [details.primaryType, ...(details.types ?? [])].filter((type): type is string => Boolean(type));
  for (const type of types) {
    const genre = TYPE_GENRES[type];
    if (genre) return { genre, raw: raw || type, source: "google_places", confidence: "high" };
  }

  const name = `${restaurantName} ${details.displayName?.text ?? ""}`.normalize("NFKC");
  for (const [pattern, genre] of NAME_RULES) {
    if (pattern.test(name)) return { genre, raw: raw || "店名から推定", source: "name", confidence: "medium" };
  }

  if (raw && !/^(レストラン|飲食店|Restaurant)$/i.test(raw)) {
    return { genre: raw.replace(/店$/, ""), raw, source: "google_places", confidence: "medium" };
  }
  if (types.some((type) => type === "restaurant" || type === "food")) {
    return { genre: "飲食店", raw: raw || "restaurant", source: "google_places", confidence: "low" };
  }
  return null;
}

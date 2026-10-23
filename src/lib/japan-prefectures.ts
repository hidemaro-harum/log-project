import type { Restaurant } from "@/types/database";

export type Prefecture = {
  code: number;
  id: string;
  name: string;
  region: string;
  aliases: string[];
};

const rows: Array<[number, string, string, string, string[]]> = [
  [1, "hokkaido", "北海道", "北海道", ["札幌", "函館", "旭川", "小樽"]],
  [2, "aomori", "青森県", "東北", ["青森", "弘前", "八戸"]],
  [3, "iwate", "岩手県", "東北", ["岩手", "盛岡"]],
  [4, "miyagi", "宮城県", "東北", ["宮城", "仙台"]],
  [5, "akita", "秋田県", "東北", ["秋田"]],
  [6, "yamagata", "山形県", "東北", ["山形"]],
  [7, "fukushima", "福島県", "東北", ["福島", "郡山", "会津若松"]],
  [8, "ibaraki", "茨城県", "関東", ["茨城", "水戸", "つくば"]],
  [9, "tochigi", "栃木県", "関東", ["栃木", "宇都宮", "日光"]],
  [10, "gunma", "群馬県", "関東", ["群馬", "高崎", "前橋"]],
  [11, "saitama", "埼玉県", "関東", ["埼玉", "さいたま", "川越", "大宮"]],
  [12, "chiba", "千葉県", "関東", ["千葉", "船橋", "柏", "成田"]],
  [13, "tokyo", "東京都", "関東", ["東京", "渋谷", "新宿", "銀座", "池袋", "六本木", "恵比寿", "上野", "浅草", "吉祥寺", "下北沢", "中目黒", "品川", "丸の内"]],
  [14, "kanagawa", "神奈川県", "関東", ["神奈川", "横浜", "川崎", "鎌倉", "湘南", "箱根"]],
  [15, "niigata", "新潟県", "中部", ["新潟"]],
  [16, "toyama", "富山県", "中部", ["富山"]],
  [17, "ishikawa", "石川県", "中部", ["石川", "金沢"]],
  [18, "fukui", "福井県", "中部", ["福井"]],
  [19, "yamanashi", "山梨県", "中部", ["山梨", "甲府", "河口湖"]],
  [20, "nagano", "長野県", "中部", ["長野", "松本", "軽井沢"]],
  [21, "gifu", "岐阜県", "中部", ["岐阜", "高山", "飛騨"]],
  [22, "shizuoka", "静岡県", "中部", ["静岡", "浜松", "熱海", "伊豆"]],
  [23, "aichi", "愛知県", "中部", ["愛知", "名古屋", "豊橋"]],
  [24, "mie", "三重県", "近畿", ["三重", "伊勢", "四日市"]],
  [25, "shiga", "滋賀県", "近畿", ["滋賀", "大津", "琵琶湖"]],
  [26, "kyoto", "京都府", "近畿", ["京都"]],
  [27, "osaka", "大阪府", "近畿", ["大阪", "梅田", "難波", "心斎橋", "天王寺", "堺"]],
  [28, "hyogo", "兵庫県", "近畿", ["兵庫", "神戸", "姫路", "西宮", "淡路"]],
  [29, "nara", "奈良県", "近畿", ["奈良"]],
  [30, "wakayama", "和歌山県", "近畿", ["和歌山", "白浜"]],
  [31, "tottori", "鳥取県", "中国", ["鳥取"]],
  [32, "shimane", "島根県", "中国", ["島根", "松江", "出雲"]],
  [33, "okayama", "岡山県", "中国", ["岡山", "倉敷"]],
  [34, "hiroshima", "広島県", "中国", ["広島", "宮島", "尾道"]],
  [35, "yamaguchi", "山口県", "中国", ["山口", "下関"]],
  [36, "tokushima", "徳島県", "四国", ["徳島"]],
  [37, "kagawa", "香川県", "四国", ["香川", "高松"]],
  [38, "ehime", "愛媛県", "四国", ["愛媛", "松山"]],
  [39, "kochi", "高知県", "四国", ["高知"]],
  [40, "fukuoka", "福岡県", "九州", ["福岡", "博多", "天神", "北九州"]],
  [41, "saga", "佐賀県", "九州", ["佐賀"]],
  [42, "nagasaki", "長崎県", "九州", ["長崎", "佐世保"]],
  [43, "kumamoto", "熊本県", "九州", ["熊本"]],
  [44, "oita", "大分県", "九州", ["大分", "別府", "湯布院"]],
  [45, "miyazaki", "宮崎県", "九州", ["宮崎"]],
  [46, "kagoshima", "鹿児島県", "九州", ["鹿児島"]],
  [47, "okinawa", "沖縄県", "沖縄", ["沖縄", "那覇", "石垣", "宮古島"]],
];

export const PREFECTURES: Prefecture[] = rows.map(([code, id, name, region, aliases]) => ({ code, id, name, region, aliases }));
export const PREFECTURE_BY_ID = new Map(PREFECTURES.map((prefecture) => [prefecture.id, prefecture]));
export const PREFECTURE_BY_CODE = new Map(PREFECTURES.map((prefecture) => [prefecture.code, prefecture]));

export function inferPrefectureCode(area: string | null | undefined) {
  if (!area) return null;
  const normalized = area.normalize("NFKC").replace(/\s/g, "");
  const explicitPrefecture = PREFECTURES.find((prefecture) => normalized.includes(prefecture.name));
  if (explicitPrefecture) return explicitPrefecture.code;

  let match: { code: number; index: number; length: number } | null = null;
  for (const prefecture of PREFECTURES) {
    for (const alias of prefecture.aliases) {
      const index = normalized.indexOf(alias);
      if (index < 0) continue;
      if (!match || index < match.index || (index === match.index && alias.length > match.length)) {
        match = { code: prefecture.code, index, length: alias.length };
      }
    }
  }
  return match?.code ?? null;
}

export function getRestaurantPrefectureCode(restaurant: Restaurant) {
  return restaurant.prefecture_code ?? inferPrefectureCode(restaurant.area);
}

export function getPrefectureCounts(restaurants: Restaurant[]) {
  const counts = new Map<number, number>();
  for (const restaurant of restaurants) {
    if (restaurant.status !== "visited") continue;
    const code = getRestaurantPrefectureCode(restaurant);
    if (code) counts.set(code, (counts.get(code) ?? 0) + 1);
  }
  return counts;
}

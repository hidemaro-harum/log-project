import test from "node:test";
import assert from "node:assert/strict";
import { parseMogurecoCsv } from "./mogureco-import.ts";

test("parses Mogureco visited CSV rows into import records", () => {
  const csv = "\uFEFF店舗名,訪問日,評価,メモ,タグ,住所\n" +
    "天開,2025-12-24,4.5,背脂がうまい,\"ラーメン,新潟\",新潟県三条市西本成寺２丁目１−８\n";

  assert.deepEqual(parseMogurecoCsv(csv), {
    records: [
      {
        name: "天開",
        visitedAt: "2025-12-24",
        rating: 4.5,
        memo: "背脂がうまい",
        tags: ["ラーメン", "新潟"],
        address: "新潟県三条市西本成寺２丁目１−８",
      },
    ],
    errors: [],
  });
});

test("reports missing required columns", () => {
  assert.deepEqual(parseMogurecoCsv("店舗名,評価\n天開,4.5\n"), {
    records: [],
    errors: ["CSVに必要な列がありません: 訪問日, メモ, タグ, 住所"],
  });
});

test("skips invalid rows and keeps valid rows", () => {
  const csv = "店舗名,訪問日,評価,メモ,タグ,住所\n" +
    ",2025-12-24,4.5,,,新潟県三条市\n" +
    "麺屋十色,2025/12/22,4.0,,,新潟市中央区\n" +
    "喫茶 MG,2025-12-05,5.5,,,島根県松江市\n" +
    "喫茶ニュー馬場崎,2025-12-13,4.5,,喫茶 鳥取,鳥取県境港市\n";

  assert.deepEqual(parseMogurecoCsv(csv), {
    records: [
      {
        name: "喫茶ニュー馬場崎",
        visitedAt: "2025-12-13",
        rating: 4.5,
        memo: "",
        tags: ["喫茶", "鳥取"],
        address: "鳥取県境港市",
      },
    ],
    errors: [
      "2行目: 店舗名が空です。",
      "3行目: 訪問日がYYYY-MM-DD形式ではありません。",
      "4行目: 評価は0.5から5の数値で入力してください。",
    ],
  });
});

test("accepts Mogureco half-star minimum ratings and missing visit dates", () => {
  const csv = "店舗名,訪問日,評価,メモ,タグ,住所\n" +
    "CREPESHOP 3o'clock,2024-06-26,0.5,,,燕市井土巻３丁目６５\n" +
    "しじみ処 かみあり製麺,,5.0,,,出雲市斐川町学頭１８１５−１\n";

  assert.deepEqual(parseMogurecoCsv(csv), {
    records: [
      {
        name: "CREPESHOP 3o'clock",
        visitedAt: "2024-06-26",
        rating: 0.5,
        memo: "",
        tags: [],
        address: "燕市井土巻３丁目６５",
      },
      {
        name: "しじみ処 かみあり製麺",
        visitedAt: null,
        rating: 5,
        memo: "",
        tags: [],
        address: "出雲市斐川町学頭１８１５−１",
      },
    ],
    errors: [],
  });
});

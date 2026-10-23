import assert from "node:assert/strict";
import test from "node:test";
import { getPrefectureCounts, inferPrefectureCode } from "./japan-prefectures.ts";

test("infers prefectures from full addresses and common city names", () => {
  assert.equal(inferPrefectureCode("東京都渋谷区恵比寿1-1"), 13);
  assert.equal(inferPrefectureCode("札幌駅周辺"), 1);
  assert.equal(inferPrefectureCode("横浜・みなとみらい"), 14);
  assert.equal(inferPrefectureCode("不明なエリア"), null);
});

test("counts only visited restaurants and prefers stored prefecture codes", () => {
  const counts = getPrefectureCounts([
    { id: "1", user_id: "u", name: "A", area: "渋谷", genre: null, status: "visited", memo: null, rating: null, created_at: "", updated_at: "" },
    { id: "2", user_id: "u", name: "B", area: "大阪", genre: null, status: "wishlist", memo: null, rating: null, created_at: "", updated_at: "" },
    { id: "3", user_id: "u", name: "C", area: null, genre: null, status: "visited", memo: null, rating: null, prefecture_code: 26, created_at: "", updated_at: "" },
  ]);
  assert.equal(counts.get(13), 1);
  assert.equal(counts.get(26), 1);
  assert.equal(counts.has(27), false);
});

test("prefers explicit prefectures over city and ward aliases", () => {
  assert.equal(inferPrefectureCode("大阪府大阪市福島区福島1-1"), 27);
  assert.equal(inferPrefectureCode("神奈川県横浜市青葉区奈良町1-1"), 14);
  assert.equal(inferPrefectureCode("石川県金沢市香林坊1-1"), 17);
});

test("uses the first place in an address when the prefecture suffix is omitted", () => {
  assert.equal(inferPrefectureCode("大阪市福島区福島1-1"), 27);
  assert.equal(inferPrefectureCode("京都市下京区松本町"), 26);
});

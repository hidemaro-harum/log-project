import test from "node:test";
import assert from "node:assert/strict";
import { createFormSaveSession } from "./form-save-session.ts";
import { addRestaurantPhotos, type RestaurantPhotoRow } from "./restaurant-photo-add.ts";
import type { Photo } from "../types/database.ts";

test("shares in-flight and acknowledged steps but gives different records distinct stable IDs", async () => {
  let sequence = 0;
  const session = createFormSaveSession(() => `id-${++sequence}`);
  assert.equal(session.id("restaurant"), session.id("restaurant"));
  assert.notEqual(session.id("restaurant"), session.id("visit"));
  let writes = 0;
  let finish: (result: string) => void = () => {};
  const pending = new Promise<string>((resolve) => { finish = resolve; });
  const save = () => session.once("restaurant", async () => { writes += 1; return pending; });
  const first = save();
  const second = save();
  finish("saved");
  assert.deepEqual(await Promise.all([first, second, save()]), ["saved", "saved", "saved"]);
  assert.equal(writes, 1);
});

test("retries a committed parent whose response was lost using the same record ID", async () => {
  const session = createFormSaveSession(() => "restaurant-stable");
  const database = new Map<string, { id: string; name: string }>();
  const writtenIds: string[] = [];
  let loseResponse = true;
  const save = () => session.once("restaurant", async () => {
    const row = { id: session.id("restaurant"), name: "テスト店" };
    database.set(row.id, row);
    writtenIds.push(row.id);
    if (loseResponse) {
      loseResponse = false;
      throw new Error("response lost");
    }
    return row;
  });
  await assert.rejects(save(), /response lost/);
  assert.equal(database.size, 1);
  assert.equal((await save()).id, "restaurant-stable");
  await save();
  assert.deepEqual(writtenIds, ["restaurant-stable", "restaurant-stable"]);
  assert.equal(database.size, 1);
});

test("a partial photo retry reuses acknowledged parents and preserves the visit, IDs and order", async () => {
  let sequence = 0;
  const session = createFormSaveSession(() => `parent-${++sequence}`);
  const parents: string[] = [];
  const storage = new Map<string, string>();
  const database = new Map<string, Photo>();
  const uploads: string[] = [];
  let loseResponse = true;
  let candidates = ["a", "b", "c"].map((id) => ({ id, file: `${id}.jpg` }));
  let startSortOrder = 4;
  const save = async () => {
    const restaurant = await session.once("restaurant", async () => {
      parents.push("restaurant");
      return { id: session.id("restaurant") };
    });
    const visit = await session.once("visit", async () => {
      parents.push("visit");
      return { id: session.id("visit") };
    });
    const result = await addRestaurantPhotos({
      candidates, userId: "user", restaurantId: restaurant.id, visitId: visit.id,
      startSortOrder, caption: "料理",
    }, {
      prepare: async (file) => file,
      upload: async (path, file) => { storage.set(path, file); uploads.push(path); },
      save: async (row: RestaurantPhotoRow) => {
        const photo = { ...row, created_at: "2026-10-24T00:00:00Z" };
        database.set(row.id, photo);
        if (row.id === "b" && loseResponse) {
          loseResponse = false;
          throw new Error("response lost after commit");
        }
        return photo;
      },
    });
    candidates = candidates.filter(({ id }) => result.remainingIds.includes(id));
    startSortOrder = result.nextSortOrder;
    return result;
  };

  const first = await save();
  assert.equal(first.retryOnly, true);
  assert.deepEqual(candidates.map(({ id }) => id), ["b", "c"]);
  assert.equal(storage.size, 2);
  assert.equal(database.size, 2);
  assert.equal((await save()).error, null);
  assert.deepEqual(parents, ["restaurant", "visit"]);
  assert.deepEqual(uploads, ["a", "b", "b", "c"].map((id) => `user/parent-1/${id}.optimized.webp`));
  assert.deepEqual([...database.values()].map(({ id, visit_id, sort_order }) => [id, visit_id, sort_order]), [
    ["a", "parent-2", 4], ["b", "parent-2", 5], ["c", "parent-2", 6],
  ]);
  assert.equal(storage.size, 3);
  assert.equal(database.size, 3);
});

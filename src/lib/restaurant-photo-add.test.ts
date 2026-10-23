import test from "node:test";
import assert from "node:assert/strict";
import {
  addRestaurantPhotos,
  type RestaurantPhotoAddInput,
  type RestaurantPhotoRow,
} from "./restaurant-photo-add.ts";
import type { Photo } from "../types/database.ts";

type TestFile = { name: string; prepared?: boolean };

function makeInput(): RestaurantPhotoAddInput<TestFile> {
  return {
    candidates: ["a", "b", "c"].map((id) => ({ id, file: { name: `${id}.jpg` } })),
    userId: "user-1",
    restaurantId: "restaurant-1",
    startSortOrder: 5,
    caption: "  お料理  ",
  };
}

function saved(row: RestaurantPhotoRow): Photo {
  return { ...row, created_at: "2026-10-23T00:00:00.000Z" };
}

test("prepares every file before writes, then appends in selection order without a visit", async () => {
  const events: string[] = [];
  const rows: RestaurantPhotoRow[] = [];
  const result = await addRestaurantPhotos(makeInput(), {
    prepare: async (file) => {
      events.push(`prepare:${file.name}`);
      return { ...file, prepared: true };
    },
    upload: async (path, file) => {
      assert.equal(file.prepared, true);
      events.push(`upload:${path}`);
    },
    save: async (row) => {
      events.push(`save:${row.id}`);
      rows.push(row);
      return saved(row);
    },
  });
  assert.deepEqual(events, [
    "prepare:a.jpg", "prepare:b.jpg", "prepare:c.jpg",
    "upload:user-1/restaurant-1/a.optimized.webp", "save:a",
    "upload:user-1/restaurant-1/b.optimized.webp", "save:b",
    "upload:user-1/restaurant-1/c.optimized.webp", "save:c",
  ]);
  assert.deepEqual(rows.map((row) => ({ id: row.id, order: row.sort_order, visit: row.visit_id })), [
    { id: "a", order: 5, visit: null },
    { id: "b", order: 6, visit: null },
    { id: "c", order: 7, visit: null },
  ]);
  assert.ok(rows.every((row) => row.caption === "お料理"));
  assert.deepEqual(result, { photos: rows.map(saved), remainingIds: [], nextSortOrder: 8, retryOnly: false, error: null });
});

test("an image preparation error makes zero writes and retains every candidate", async () => {
  const events: string[] = [];
  const failure = new Error("画像を読み込めませんでした。");
  const result = await addRestaurantPhotos(makeInput(), {
    prepare: async (file) => {
      events.push(`prepare:${file.name}`);
      if (file.name === "b.jpg") throw failure;
      return file;
    },
    upload: async () => { assert.fail("storage must not be written"); },
    save: async () => { assert.fail("database must not be written"); },
  });
  assert.deepEqual(events, ["prepare:a.jpg", "prepare:b.jpg"]);
  assert.deepEqual(result, {
    photos: [], remainingIds: ["a", "b", "c"], nextSortOrder: 5, retryOnly: false, error: failure,
  });
});

test("the first upload failure stops all later uploads and saves", async () => {
  const events: string[] = [];
  const result = await addRestaurantPhotos(makeInput(), {
    prepare: async (file) => file,
    upload: async (path) => {
      events.push(`upload:${path}`);
      if (path.includes("/b.")) throw { message: "通信が途切れました。" };
    },
    save: async (row) => { events.push(`save:${row.id}`); return saved(row); },
  });
  assert.deepEqual(events, [
    "upload:user-1/restaurant-1/a.optimized.webp", "save:a",
    "upload:user-1/restaurant-1/b.optimized.webp",
  ]);
  assert.deepEqual(result.photos.map(({ id }) => id), ["a"]);
  assert.deepEqual(result.remainingIds, ["b", "c"]);
  assert.equal(result.nextSortOrder, 6);
  assert.equal(result.retryOnly, true);
  assert.equal(result.error?.message, "通信が途切れました。");
});

test("retries an uncertain DB success with the same ID, path and order, excluding confirmed successes", async () => {
  const input = makeInput();
  const storage = new Map<string, TestFile>();
  const database = new Map<string, Photo>();
  const uploadedPaths: string[] = [];
  const savedRows: RestaurantPhotoRow[] = [];
  let lostResponse = true;
  const deps = {
    prepare: async (file: TestFile) => file,
    upload: async (path: string, file: TestFile) => {
      storage.set(path, file);
      uploadedPaths.push(path);
    },
    save: async (row: RestaurantPhotoRow) => {
      const photo = saved(row);
      database.set(row.id, photo);
      savedRows.push(row);
      if (row.id === "b" && lostResponse) {
        lostResponse = false;
        throw new Error("応答が届きませんでした。");
      }
      return photo;
    },
  };
  const first = await addRestaurantPhotos(input, deps);
  assert.deepEqual(first.photos.map(({ id }) => id), ["a"]);
  assert.deepEqual(first.remainingIds, ["b", "c"]);
  assert.equal(first.nextSortOrder, 6);
  assert.equal(first.retryOnly, true);
  assert.equal(storage.size, 2);
  assert.equal(database.size, 2);
  assert.equal(database.has("c"), false);

  const retry = await addRestaurantPhotos({
    ...input,
    candidates: input.candidates.filter(({ id }) => first.remainingIds.includes(id)),
    startSortOrder: first.nextSortOrder,
  }, deps);
  assert.equal(retry.error, null);
  assert.equal(retry.retryOnly, false);
  assert.deepEqual(retry.photos.map(({ id }) => id), ["b", "c"]);
  assert.deepEqual(retry.remainingIds, []);
  assert.equal(retry.nextSortOrder, 8);
  assert.deepEqual(uploadedPaths, ["a", "b", "b", "c"].map((id) => `user-1/restaurant-1/${id}.optimized.webp`));
  assert.deepEqual(savedRows[1], savedRows[2]);
  assert.equal(storage.size, 3);
  assert.equal(database.size, 3);
  assert.deepEqual([...database.values()].map((row) => [row.id, row.sort_order]), [["a", 5], ["b", 6], ["c", 7]]);
});

test("blank captions become null and an empty selection performs no work", async () => {
  const input = { ...makeInput(), caption: "  " };
  const result = await addRestaurantPhotos(input, {
    prepare: async (file) => file,
    upload: async () => {},
    save: async (row) => { assert.equal(row.caption, null); return saved(row); },
  });
  assert.equal(result.error, null);
  assert.equal(result.retryOnly, false);
  const empty = await addRestaurantPhotos({ ...input, candidates: [] }, {
    prepare: async () => { assert.fail("no preparation expected"); },
    upload: async () => { assert.fail("no upload expected"); },
    save: async () => { assert.fail("no save expected"); },
  });
  assert.deepEqual(empty, { photos: [], remainingIds: [], nextSortOrder: 5, retryOnly: false, error: null });
});

test("duplicate draft IDs are rejected before preparation or writes", async () => {
  const input = makeInput();
  const result = await addRestaurantPhotos({
    ...input,
    candidates: [input.candidates[0], input.candidates[0]],
  }, {
    prepare: async () => { assert.fail("no preparation expected"); },
    upload: async () => { assert.fail("no upload expected"); },
    save: async () => { assert.fail("no save expected"); },
  });
  assert.equal(result.photos.length, 0);
  assert.equal(result.retryOnly, false);
  assert.match(result.error?.message ?? "", /識別情報/);
});

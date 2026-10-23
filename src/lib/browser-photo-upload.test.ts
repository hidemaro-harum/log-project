import test from "node:test";
import assert from "node:assert/strict";
import { createPhotoUploadDependencies } from "./browser-photo-upload.ts";
import type { RestaurantPhotoRow } from "./restaurant-photo-add.ts";

type Client = Parameters<typeof createPhotoUploadDependencies>[0];

test("the browser adapter uses storage and row upserts, never removing an uncertain save", async () => {
  const calls: unknown[] = [];
  const row: RestaurantPhotoRow = {
    id: "stable-photo", user_id: "user", restaurant_id: "restaurant", visit_id: "visit",
    storage_path: "user/restaurant/stable-photo.optimized.webp", caption: null, sort_order: 3,
  };
  const client = {
    storage: { from: (bucket: string) => ({
      upload: async (path: string, file: File, options: unknown) => {
        calls.push({ bucket, path, file, options });
        return { error: null };
      },
      remove: async () => { assert.fail("an uncertain row response must not delete its stored photo"); },
    }) },
    from: (table: string) => ({
      upsert: (savedRow: unknown, options: unknown) => {
        calls.push({ table, row: savedRow, options });
        return { select: () => ({ single: async () => ({ data: null, error: { message: "response lost" } }) }) };
      },
    }),
  } as unknown as Client;
  const deps = createPhotoUploadDependencies(client, { prepared: true });
  const file = new File(["webp"], "photo.webp", { type: "image/webp" });
  assert.equal(await deps.prepare(file), file);
  await deps.upload(row.storage_path, file);
  await assert.rejects(deps.save(row), { message: "response lost" });
  assert.deepEqual(calls, [
    { bucket: "food-photos", path: row.storage_path, file, options: { cacheControl: "31536000", contentType: "image/webp", upsert: true } },
    { table: "photos", row, options: { onConflict: "id" } },
  ]);
});

test("an unmounted form cannot start more storage or row writes", async () => {
  const client = {
    storage: { from: () => assert.fail("storage must not be used") },
    from: () => assert.fail("database must not be used"),
  } as unknown as Client;
  const deps = createPhotoUploadDependencies(client, { prepared: true, isActive: () => false });
  const file = new File(["x"], "x.webp", { type: "image/webp" });
  await assert.rejects(deps.prepare(file), /中断/);
  await assert.rejects(deps.upload("path", file), /中断/);
});

import test from "node:test";
import assert from "node:assert/strict";
import { deleteRestaurantWithAssets } from "./restaurant-delete.ts";
import type { Restaurant } from "@/types/database";

test("confirms the restaurant deletion before removing each photo path from storage once", async () => {
  const calls: string[] = [];
  const client = {
    storage: {
      from(bucket: string) {
        calls.push(`storage:${bucket}`);
        return {
          async remove(paths: string[]) {
            calls.push(`remove:${paths.join(",")}`);
            return { error: null };
          },
        };
      },
    },
    from(table: string) {
      calls.push(`table:${table}`);
      return {
        delete() {
          calls.push("delete");
          return {
            async eq(column: string, value: string) {
              calls.push(`eq:${column}:${value}`);
              return { error: null };
            },
          };
        },
      };
    },
  };

  await deleteRestaurantWithAssets(client, restaurantWithPhotos(["u/r/photo-1.jpg", "u/r/photo-2.jpg", "u/r/photo-1.jpg"]));

  assert.deepEqual(calls, [
    "table:restaurants",
    "delete",
    "eq:id:restaurant-1",
    "storage:food-photos",
    "remove:u/r/photo-1.jpg,u/r/photo-2.jpg",
  ]);
});

test("retries storage cleanup from the same snapshot after the restaurant is already deleted", async () => {
  const calls: string[] = [];
  const deletedRowCounts: number[] = [];
  let restaurantExists = true;
  let storageAttempts = 0;
  const client = {
    storage: {
      from(bucket: string) {
        calls.push(`storage:${bucket}`);
        return {
          async remove(paths: string[]) {
            calls.push(`remove:${paths.join(",")}`);
            storageAttempts += 1;
            return { error: storageAttempts === 1 ? new Error("storage failed") : null };
          },
        };
      },
    },
    from(table: string) {
      calls.push(`table:${table}`);
      return {
        delete() {
          calls.push("delete");
          return {
            async eq(column: string, value: string) {
              calls.push(`eq:${column}:${value}`);
              deletedRowCounts.push(restaurantExists ? 1 : 0);
              restaurantExists = false;
              return { error: null };
            },
          };
        },
      };
    },
  };

  const snapshot = restaurantWithPhotos(["u/r/photo-1.jpg"]);
  await assert.rejects(() => deleteRestaurantWithAssets(client, snapshot), {
    message: "店舗は削除しましたが、写真ファイルの削除を確認できませんでした。もう一度削除を実行してください。",
  });
  await deleteRestaurantWithAssets(client, snapshot);

  assert.deepEqual(deletedRowCounts, [1, 0]);
  assert.deepEqual(calls, [
    "table:restaurants", "delete", "eq:id:restaurant-1", "storage:food-photos", "remove:u/r/photo-1.jpg",
    "table:restaurants", "delete", "eq:id:restaurant-1", "storage:food-photos", "remove:u/r/photo-1.jpg",
  ]);
});

test("a failed or uncertain database deletion never touches photo storage", async () => {
  for (const lostResponse of [false, true]) {
    const failure = new Error(lostResponse ? "response lost" : "database failed");
    const client = {
      storage: {
        from() { assert.fail("photos must remain untouched until DB success is confirmed"); },
      },
      from() {
        return {
          delete() {
            return {
              async eq() {
                if (lostResponse) throw failure;
                return { error: failure };
              },
            };
          },
        };
      },
    };
    await assert.rejects(() => deleteRestaurantWithAssets(client, restaurantWithPhotos(["u/r/photo-1.jpg"])), {
      message: failure.message,
    });
  }
});

test("a lost storage response reports the completed restaurant deletion and allows retry", async () => {
  const client = {
    storage: {
      from() {
        return { async remove() { throw new Error("response lost"); } };
      },
    },
    from() {
      return { delete() { return { async eq() { return { error: null }; } }; } };
    },
  };
  await assert.rejects(() => deleteRestaurantWithAssets(client, restaurantWithPhotos(["u/r/photo-1.jpg"])), {
    message: "店舗は削除しましたが、写真ファイルの削除を確認できませんでした。もう一度削除を実行してください。",
  });
});

test("a restaurant without photo paths needs no storage cleanup", async () => {
  let rowDeleted = false;
  const client = {
    storage: {
      from() { assert.fail("there are no photo files to remove"); },
    },
    from() {
      return { delete() { return { async eq() { rowDeleted = true; return { error: null }; } }; } };
    },
  };
  await deleteRestaurantWithAssets(client, restaurantWithPhotos([]));
  assert.equal(rowDeleted, true);
});

function restaurantWithPhotos(paths: string[]): Restaurant {
  return {
    id: "restaurant-1",
    user_id: "user-1",
    name: "BiteLog Cafe",
    area: null,
    genre: null,
    status: "visited",
    memo: null,
    rating: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    photos: paths.map((storage_path, index) => ({
      id: `photo-${index + 1}`,
      restaurant_id: "restaurant-1",
      visit_id: null,
      user_id: "user-1",
      storage_path,
      caption: null,
      sort_order: index,
      created_at: "2026-01-01T00:00:00.000Z",
    })),
  };
}

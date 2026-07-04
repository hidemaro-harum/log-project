import test from "node:test";
import assert from "node:assert/strict";
import { deleteRestaurantWithAssets } from "./restaurant-delete.ts";
import type { Restaurant } from "@/types/database";

test("removes restaurant photos from storage before deleting the restaurant row", async () => {
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

  await deleteRestaurantWithAssets(client, restaurantWithPhotos(["u/r/photo-1.jpg", "u/r/photo-2.jpg"]));

  assert.deepEqual(calls, [
    "storage:food-photos",
    "remove:u/r/photo-1.jpg,u/r/photo-2.jpg",
    "table:restaurants",
    "delete",
    "eq:id:restaurant-1",
  ]);
});

test("does not delete the restaurant row when storage removal fails", async () => {
  const calls: string[] = [];
  const client = {
    storage: {
      from(bucket: string) {
        calls.push(`storage:${bucket}`);
        return {
          async remove(paths: string[]) {
            calls.push(`remove:${paths.join(",")}`);
            return { error: new Error("storage failed") };
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

  await assert.rejects(
    () => deleteRestaurantWithAssets(client, restaurantWithPhotos(["u/r/photo-1.jpg"])),
    /storage failed/,
  );

  assert.deepEqual(calls, ["storage:food-photos", "remove:u/r/photo-1.jpg"]);
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
      created_at: "2026-01-01T00:00:00.000Z",
    })),
  };
}

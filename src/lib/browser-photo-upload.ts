import type { getBrowserClient } from "./browser-client";
import { PHOTO_CACHE_CONTROL_SECONDS, optimizePhotoFile } from "./photo-optimization.ts";
import type { RestaurantPhotoAddDependencies } from "./restaurant-photo-add";
import type { Photo } from "../types/database";

/** The same idempotent storage/row writes are used by every photo-entry form. */
export function createPhotoUploadDependencies(
  client: NonNullable<ReturnType<typeof getBrowserClient>>,
  options: { prepared?: boolean; isActive?: () => boolean } = {},
): RestaurantPhotoAddDependencies<File> {
  function ensureActive() {
    if (options.isActive && !options.isActive()) throw new Error("写真の保存を中断しました。");
  }
  return {
    prepare: async (file) => {
      ensureActive();
      return options.prepared ? file : (await optimizePhotoFile(file, { force: true })).file;
    },
    upload: async (path, file) => {
      ensureActive();
      const { error } = await client.storage.from("food-photos").upload(path, file, {
        cacheControl: PHOTO_CACHE_CONTROL_SECONDS,
        contentType: file.type,
        upsert: true,
      });
      if (error) throw error;
    },
    save: async (row) => {
      ensureActive();
      const { data, error } = await client.from("photos").upsert(row, { onConflict: "id" }).select().single();
      if (error || !data) throw error ?? new Error("写真の登録結果を確認できませんでした。");
      return data as Photo;
    },
  };
}

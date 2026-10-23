import type { Photo } from "../types/database.ts";

export type RestaurantPhotoCandidate<TFile> = {
  id: string;
  file: TFile;
};

export type RestaurantPhotoRow = Pick<
  Photo,
  "id" | "user_id" | "restaurant_id" | "storage_path" | "caption"
> & {
  visit_id: string | null;
  sort_order: number;
};

export type RestaurantPhotoAddInput<TFile> = {
  candidates: readonly RestaurantPhotoCandidate<TFile>[];
  userId: string;
  restaurantId: string;
  /** Omit when attaching photos directly to a restaurant. */
  visitId?: string | null;
  startSortOrder: number;
  caption: string;
};

export type RestaurantPhotoAddDependencies<TFile> = {
  /** Prepare every file as WebP before any storage or database write. */
  prepare: (file: TFile) => Promise<TFile>;
  /** Must overwrite the same path on retry. */
  upload: (path: string, file: TFile) => Promise<void>;
  /** Must upsert on id, returning the saved row. */
  save: (row: RestaurantPhotoRow) => Promise<Photo>;
};

export type RestaurantPhotoAddResult = {
  photos: Photo[];
  remainingIds: string[];
  /** Pass this as startSortOrder when retrying only remainingIds. */
  nextSortOrder: number;
  /** Writes may have committed; preserve the remaining selection until retry. */
  retryOnly: boolean;
  error: Error | null;
};

function toError(error: unknown): Error {
  if (error instanceof Error) return error;
  if (typeof error === "string") return new Error(error);
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") {
    return new Error(error.message);
  }
  return new Error("写真を追加できませんでした。もう一度お試しください。");
}

/**
 * Adds photos to an existing restaurant/optional visit without creating parents. Stable draft IDs make retrying
 * an uncertain storage/database response safe when both dependencies use upsert.
 */
export async function addRestaurantPhotos<TFile>(
  input: RestaurantPhotoAddInput<TFile>,
  deps: RestaurantPhotoAddDependencies<TFile>,
): Promise<RestaurantPhotoAddResult> {
  const { userId, restaurantId, startSortOrder } = input;
  const candidates = [...input.candidates];
  const photos: Photo[] = [];
  const remainingIds = () => candidates.slice(photos.length).map(({ id }) => id);
  const prepared: TFile[] = [];
  let retryOnly = false;

  try {
    if (!Number.isSafeInteger(startSortOrder) || startSortOrder < 0
      || !Number.isSafeInteger(startSortOrder + candidates.length)) {
      throw new Error("写真の表示順が不正です。");
    }
    const ids = new Set<string>();
    for (const { id } of candidates) {
      if (!id || id.includes("/") || id.includes("\\") || ids.has(id)) {
        throw new Error("写真の識別情報が不正です。写真を選び直してください。");
      }
      ids.add(id);
    }
    for (const { file } of candidates) {
      prepared.push(await deps.prepare(file));
    }

    const caption = input.caption.trim() || null;
    for (const [index, { id }] of candidates.entries()) {
      const path = `${userId}/${restaurantId}/${id}.optimized.webp`;
      retryOnly = true;
      await deps.upload(path, prepared[index]);
      const photo = await deps.save({
        id,
        user_id: userId,
        restaurant_id: restaurantId,
        visit_id: input.visitId ?? null,
        storage_path: path,
        caption,
        sort_order: startSortOrder + index,
      });
      photos.push(photo);
    }
    return { photos, remainingIds: [], nextSortOrder: startSortOrder + photos.length, retryOnly: false, error: null };
  } catch (error) {
    // A failed response can still mean the write committed. Keep its stable ID
    // and object for retry, and never remove storage after an uncertain DB save.
    return {
      photos,
      remainingIds: remainingIds(),
      nextSortOrder: startSortOrder + photos.length,
      retryOnly,
      error: toError(error),
    };
  }
}

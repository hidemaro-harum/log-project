import type { Photo } from "../types/database.ts";

export function sortPhotos(photos: Photo[] = []) {
  return [...photos].sort(
    (a, b) =>
      (a.sort_order ?? 0) - (b.sort_order ?? 0) ||
      a.created_at.localeCompare(b.created_at) ||
      a.id.localeCompare(b.id),
  );
}

export function getNextPhotoSortOrder(photos: Photo[] = []) {
  return (
    photos.reduce(
      (highest, photo) => Math.max(highest, photo.sort_order ?? 0),
      -1,
    ) + 1
  );
}

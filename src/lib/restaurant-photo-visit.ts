import type { Visit } from "../types/database.ts";
import type { createFormSaveSession } from "./form-save-session.ts";
import {
  addRestaurantPhotos,
  type RestaurantPhotoAddDependencies,
  type RestaurantPhotoAddInput,
  type RestaurantPhotoAddResult,
} from "./restaurant-photo-add.ts";

export type PhotoVisitRow = Omit<Visit, "created_at">;

type PhotoVisitInput<TFile> = Omit<RestaurantPhotoAddInput<TFile>, "visitId"> & {
  /** Null adds only photos; a date always records a distinct visit, even on the same day. */
  newVisitDate: string | null;
};

type PhotoVisitDependencies<TFile> = RestaurantPhotoAddDependencies<TFile> & {
  /** Upsert using row.id so an uncertain response can be retried safely. */
  saveVisit: (row: PhotoVisitRow) => Promise<Visit>;
  markVisited: (restaurantId: string) => Promise<void>;
};

export async function addRestaurantPhotoVisit<TFile>(
  input: PhotoVisitInput<TFile>,
  deps: PhotoVisitDependencies<TFile>,
  session: ReturnType<typeof createFormSaveSession>,
): Promise<RestaurantPhotoAddResult & { visit: Visit | null }> {
  if (input.newVisitDate !== null && !isCalendarDate(input.newVisitDate)) {
    return {
      photos: [], remainingIds: input.candidates.map(({ id }) => id),
      nextSortOrder: input.startSortOrder, retryOnly: false, visit: null,
      error: new Error("来店日を正しい日付で入力してください。"),
    };
  }

  const newVisitDate = input.newVisitDate;
  const visitId = newVisitDate === null ? null : session.id("photo-visit");
  let visit: Visit | null = null;
  const result = await addRestaurantPhotos({ ...input, visitId }, {
    ...deps,
    upload: async (path, file) => {
      // addRestaurantPhotos prepares and validates every draft before this first
      // write boundary. Failed preparation must never create an empty visit.
      if (visitId && newVisitDate !== null) {
        visit = await session.once("photo-visit", () => deps.saveVisit({
          id: visitId,
          user_id: input.userId,
          restaurant_id: input.restaurantId,
          visited_at: newVisitDate,
          dish_name: null,
          memo: null,
          rating: null,
        }));
        await session.once("photo-visit-status", () => deps.markVisited(input.restaurantId));
      }
      await deps.upload(path, file);
    },
  });

  // A visit may be confirmed even when a later photo/status request fails.
  return { ...result, visit };
}

function isCalendarDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000-")) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

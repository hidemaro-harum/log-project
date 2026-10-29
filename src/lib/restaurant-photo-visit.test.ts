import assert from "node:assert/strict";
import test from "node:test";
import type { Photo, Visit } from "../types/database.ts";
import { createFormSaveSession } from "./form-save-session.ts";
import { addRestaurantPhotoVisit, type PhotoVisitRow } from "./restaurant-photo-visit.ts";
import type { RestaurantPhotoRow } from "./restaurant-photo-add.ts";

function setup() {
  const events: string[] = [];
  const visits = new Map<string, Visit>();
  const photos = new Map<string, Photo>();
  const input = {
    candidates: ["a", "b", "c"].map((id) => ({ id, file: `${id}.jpg` })),
    userId: "user", restaurantId: "restaurant", startSortOrder: 3, caption: "料理",
    newVisitDate: "2026-10-30" as string | null,
  };
  const deps = {
    prepare: async (file: string) => { events.push(`prepare:${file}`); return file; },
    saveVisit: async (row: PhotoVisitRow) => {
      events.push(`visit:${row.id}`);
      const visit = { ...row, created_at: "2026-10-30T00:00:00Z" };
      visits.set(row.id, visit);
      return visit;
    },
    markVisited: async (restaurantId: string) => { events.push(`status:${restaurantId}`); },
    upload: async (path: string) => { events.push(`upload:${path}`); },
    save: async (row: RestaurantPhotoRow) => {
      events.push(`photo:${row.id}`);
      const photo = { ...row, created_at: "2026-10-30T00:00:00Z" };
      photos.set(row.id, photo);
      return photo;
    },
  };
  return { events, visits, photos, input, deps, session: createFormSaveSession(() => "visit-1") };
}

test("photo-only additions do not create visits or change restaurant status", async () => {
  const { input, deps, session, visits, photos, events } = setup();
  const result = await addRestaurantPhotoVisit({ ...input, newVisitDate: null }, deps, session);
  assert.equal(result.error, null);
  assert.equal(result.visit, null);
  assert.equal(visits.size, 0);
  assert.equal(events.some((event) => event.startsWith("status:")), false);
  assert.ok([...photos.values()].every((photo) => photo.visit_id === null));
});

test("prepares all photos before creating exactly one new visit and linking all photos", async () => {
  const { input, deps, session, visits, photos, events } = setup();
  const result = await addRestaurantPhotoVisit(input, deps, session);
  assert.equal(result.error, null);
  assert.equal(result.visit?.id, "visit-1");
  assert.deepEqual(events.slice(0, 5), ["prepare:a.jpg", "prepare:b.jpg", "prepare:c.jpg", "visit:visit-1", "status:restaurant"]);
  assert.equal(visits.size, 1);
  assert.equal(events.filter((event) => event.startsWith("visit:")).length, 1);
  assert.equal(events.filter((event) => event.startsWith("status:")).length, 1);
  assert.ok([...photos.values()].every((photo) => photo.visit_id === "visit-1"));
});

test("a broken image never creates a visit and leaves the selection editable", async () => {
  const { input, deps, session, visits, photos, events } = setup();
  const result = await addRestaurantPhotoVisit(input, {
    ...deps,
    prepare: async (file) => { if (file === "b.jpg") throw new Error("broken image"); return file; },
  }, session);
  assert.match(result.error?.message ?? "", /broken image/);
  assert.equal(result.retryOnly, false);
  assert.equal(visits.size, 0);
  assert.equal(photos.size, 0);
  assert.deepEqual(events, []);
  assert.deepEqual(result.remainingIds, ["a", "b", "c"]);
});

test("a lost visit response retries with the same ID without adding another visit", async () => {
  const { input, deps, session, visits, photos, events } = setup();
  let fail = true;
  const retryDeps = { ...deps, saveVisit: async (row: PhotoVisitRow) => {
    const saved = await deps.saveVisit(row);
    if (fail) { fail = false; throw new Error("visit response lost after commit"); }
    return saved;
  } };
  const first = await addRestaurantPhotoVisit(input, retryDeps, session);
  assert.equal(first.retryOnly, true);
  assert.equal(first.visit, null);
  assert.equal(visits.size, 1);
  assert.equal(photos.size, 0);
  const second = await addRestaurantPhotoVisit(input, retryDeps, session);
  assert.equal(second.error, null);
  assert.equal(second.visit?.id, "visit-1");
  assert.equal(visits.size, 1);
  assert.deepEqual(events.filter((event) => event.startsWith("visit:")), ["visit:visit-1", "visit:visit-1"]);
  assert.equal(photos.size, 3);
});

test("partial photo retries reuse the confirmed visit, photos and display order", async () => {
  const { input, deps, session, visits, photos, events } = setup();
  let fail = true;
  const retryDeps = { ...deps, save: async (row: RestaurantPhotoRow) => {
    const saved = await deps.save(row);
    if (row.id === "b" && fail) { fail = false; throw new Error("photo response lost after commit"); }
    return saved;
  } };
  const first = await addRestaurantPhotoVisit(input, retryDeps, session);
  assert.equal(first.visit?.id, "visit-1");
  assert.equal(first.retryOnly, true);
  assert.deepEqual(first.remainingIds, ["b", "c"]);
  const second = await addRestaurantPhotoVisit({
    ...input,
    candidates: input.candidates.filter(({ id }) => first.remainingIds.includes(id)),
    startSortOrder: first.nextSortOrder,
  }, retryDeps, session);
  assert.equal(second.error, null);
  assert.equal(visits.size, 1);
  assert.equal(events.filter((event) => event.startsWith("visit:")).length, 1);
  assert.equal(events.filter((event) => event.startsWith("status:")).length, 1);
  assert.deepEqual([...photos.values()].map(({ id, visit_id, sort_order }) => [id, visit_id, sort_order]), [
    ["a", "visit-1", 3], ["b", "visit-1", 4], ["c", "visit-1", 5],
  ]);
});

test("a failed status update still reports the confirmed visit and safely retries only pending work", async () => {
  const { input, deps, session, visits, photos, events } = setup();
  let fail = true;
  const retryDeps = { ...deps, markVisited: async (restaurantId: string) => {
    await deps.markVisited(restaurantId);
    if (fail) { fail = false; throw new Error("status response lost"); }
  } };
  const first = await addRestaurantPhotoVisit(input, retryDeps, session);
  assert.equal(first.visit?.id, "visit-1");
  assert.equal(first.photos.length, 0);
  assert.equal(first.retryOnly, true);
  assert.equal((await addRestaurantPhotoVisit(input, retryDeps, session)).error, null);
  assert.equal(visits.size, 1);
  assert.equal(photos.size, 3);
  assert.equal(events.filter((event) => event.startsWith("visit:")).length, 1);
  assert.equal(events.filter((event) => event.startsWith("status:")).length, 2);
});

test("a separate new-visit submission on the same date records a second visit", async () => {
  const { input, deps, session, visits } = setup();
  await addRestaurantPhotoVisit(input, deps, session);
  const second = await addRestaurantPhotoVisit({
    ...input, candidates: [{ id: "d", file: "d.jpg" }],
  }, deps, createFormSaveSession(() => "visit-2"));
  assert.equal(second.error, null);
  assert.equal(visits.size, 2);
  assert.deepEqual([...visits.values()].map(({ visited_at }) => visited_at), ["2026-10-30", "2026-10-30"]);
});

test("invalid dates and an empty photo selection do not create a visit", async () => {
  const { input, deps, session, events, visits } = setup();
  for (const newVisitDate of ["", "2026-02-30", "0000-01-01"]) {
    const result = await addRestaurantPhotoVisit({ ...input, newVisitDate }, deps, session);
    assert.match(result.error?.message ?? "", /来店日/);
    assert.equal(result.retryOnly, false);
  }
  const empty = await addRestaurantPhotoVisit({ ...input, candidates: [] }, deps, session);
  assert.equal(empty.error, null);
  assert.equal(empty.visit, null);
  assert.equal(visits.size, 0);
  assert.deepEqual(events, []);
});

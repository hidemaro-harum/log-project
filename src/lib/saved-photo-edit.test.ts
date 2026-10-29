import test from "node:test";
import assert from "node:assert/strict";
import { createSavedPhotoEditSession, saveSavedPhotoEdit, type SavedPhotoEditDependencies } from "./saved-photo-edit.ts";
import type { Photo } from "../types/database.ts";

const photo: Photo = {
  id: "photo", user_id: "user", restaurant_id: "restaurant", visit_id: "visit",
  storage_path: "user/restaurant/original.webp", caption: "料理", sort_order: 3,
  created_at: "2026-10-30T00:00:00Z",
};

function fixture() {
  const session = createSavedPhotoEditSession(photo, "edited pixels", () => "version");
  let current: Photo | null = { ...photo };
  const files = new Map([[photo.storage_path, "original pixels"]]);
  const uploads: { path: string; file: string }[] = [];
  const updates: { photo: Photo; path: string }[] = [];
  const prepared: string[] = [];
  const deps: SavedPhotoEditDependencies<string> = {
    prepare: async (file) => { prepared.push(file); return `${file} webp`; },
    upload: async (path, file) => { uploads.push({ path, file }); files.set(path, file); },
    read: async () => current,
    updatePath: async (original, path) => {
      updates.push({ photo: original, path });
      if (current?.storage_path !== original.storage_path) return null;
      current = { ...current, storage_path: path };
      return current;
    },
  };
  return { session, deps, files, uploads, updates, prepared, current: () => current, setCurrent: (value: Photo | null) => { current = value; } };
}

test("changes one existing photo path while retaining identity, visit, metadata and original object", async () => {
  const f = fixture();
  const saved = await saveSavedPhotoEdit(f.session, f.deps);
  assert.deepEqual(saved, { ...photo, storage_path: f.session.storagePath });
  assert.equal(f.files.get(photo.storage_path), "original pixels");
  assert.equal(f.files.get(saved.storage_path), "edited pixels webp");
  assert.equal(f.updates.length, 1);
  assert.deepEqual(f.updates[0], { photo, path: saved.storage_path });
  assert.equal(await saveSavedPhotoEdit(f.session, f.deps), saved);
  assert.equal(f.updates.length, 1);
});

test("an uncertain upload reuses the exact prepared content and fixed new path", async () => {
  const f = fixture();
  const upload = f.deps.upload;
  let fail = true;
  f.deps.upload = async (path, file) => {
    await upload(path, file);
    if (fail) { fail = false; throw new Error("upload response lost"); }
  };
  await assert.rejects(saveSavedPhotoEdit(f.session, f.deps), /upload response lost/);
  assert.equal(f.updates.length, 0);
  assert.equal(f.current()?.storage_path, photo.storage_path);
  await saveSavedPhotoEdit(f.session, f.deps);
  assert.deepEqual(f.prepared, ["edited pixels"]);
  assert.equal(f.uploads.length, 2);
  assert.deepEqual(f.uploads[0], f.uploads[1]);
  assert.equal(f.files.size, 2);
});

test("readback acknowledges a committed update whose response was lost", async () => {
  const f = fixture();
  const update = f.deps.updatePath;
  f.deps.updatePath = async (original, path) => { await update(original, path); throw new Error("response lost"); };
  const saved = await saveSavedPhotoEdit(f.session, f.deps);
  assert.equal(saved.storage_path, f.session.storagePath);
  assert.equal(f.updates.length, 1);
  assert.equal(f.uploads.length, 1);
});

test("retry reconciles an uncertain database write before any repeated upload or update", async () => {
  const f = fixture();
  const update = f.deps.updatePath;
  const read = f.deps.read;
  let unavailable = false;
  f.deps.updatePath = async (original, path) => { await update(original, path); unavailable = true; throw new Error("response lost"); };
  f.deps.read = async (original) => {
    if (unavailable) throw new Error("readback unavailable");
    return read(original);
  };
  await assert.rejects(saveSavedPhotoEdit(f.session, f.deps), /readback unavailable/);
  await assert.rejects(saveSavedPhotoEdit(f.session, f.deps), /readback unavailable/);
  assert.equal(f.updates.length, 1);
  unavailable = false;
  const saved = await saveSavedPhotoEdit(f.session, f.deps);
  assert.equal(saved.storage_path, f.session.storagePath);
  assert.equal(f.updates.length, 1);
  assert.equal(f.uploads.length, 1);
  assert.equal(f.files.size, 2);
});

test("a rejected database update retries only that step and preserves newer metadata", async () => {
  const f = fixture();
  const update = f.deps.updatePath;
  let fail = true;
  f.deps.updatePath = async (original, path) => {
    if (fail) { fail = false; throw new Error("temporary database error"); }
    return update(original, path);
  };
  await assert.rejects(saveSavedPhotoEdit(f.session, f.deps), /temporary database error/);
  f.setCurrent({ ...photo, caption: "更新済みメモ", sort_order: 1 });
  const saved = await saveSavedPhotoEdit(f.session, f.deps);
  assert.equal(saved.caption, "更新済みメモ");
  assert.equal(saved.sort_order, 1);
  assert.equal(f.uploads.length, 1);
  assert.equal(f.prepared.length, 1);
});

test("a concurrently edited or deleted photo is never overwritten or recreated", async () => {
  for (const changed of [{ ...photo, storage_path: "other-edit.webp" }, null]) {
    const f = fixture();
    f.setCurrent(changed);
    await assert.rejects(saveSavedPhotoEdit(f.session, f.deps));
    assert.equal(f.uploads.length, 0);
    assert.equal(f.updates.length, 0);
    assert.deepEqual(f.current(), changed);
  }
});

test("a compare-and-swap conflict after upload retains both objects and does not retry blindly", async () => {
  const f = fixture();
  const upload = f.deps.upload;
  f.deps.upload = async (path, file) => { await upload(path, file); f.setCurrent({ ...photo, storage_path: "other-edit.webp" }); };
  await assert.rejects(saveSavedPhotoEdit(f.session, f.deps), /別の操作で変更/);
  await assert.rejects(saveSavedPhotoEdit(f.session, f.deps), /別の操作で変更/);
  assert.equal(f.updates.length, 1);
  assert.equal(f.uploads.length, 1);
  assert.equal(f.files.size, 2);
  assert.equal(f.current()?.storage_path, "other-edit.webp");
});

test("double submission shares the in-flight work", async () => {
  const f = fixture();
  let release: () => void = () => {};
  const pending = new Promise<void>((resolve) => { release = resolve; });
  const prepare = f.deps.prepare;
  f.deps.prepare = async (file) => { await pending; return prepare(file); };
  const first = saveSavedPhotoEdit(f.session, f.deps);
  const second = saveSavedPhotoEdit(f.session, f.deps);
  assert.equal(first, second);
  release();
  await Promise.all([first, second]);
  assert.equal(f.uploads.length, 1);
  assert.equal(f.updates.length, 1);
});

test("unrelated readback rows cannot acknowledge a photo update", async () => {
  const f = fixture();
  f.deps.updatePath = async () => {
    f.setCurrent({ ...photo, user_id: "another-user", storage_path: f.session.storagePath });
    return f.current();
  };
  await assert.rejects(saveSavedPhotoEdit(f.session, f.deps), /登録情報を確認/);
  assert.equal(f.session.saved, null);
});

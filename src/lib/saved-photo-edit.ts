import type { Photo } from "../types/database.ts";

export type SavedPhotoEditSession<TFile> = {
  readonly photo: Photo;
  readonly file: TFile;
  readonly storagePath: string;
  prepared: TFile | null;
  uploaded: boolean;
  updateAttempted: boolean;
  saved: Photo | null;
  pending: Promise<Photo> | null;
};

export type SavedPhotoEditDependencies<TFile> = {
  prepare: (file: TFile) => Promise<TFile>;
  /** Repeating this upload must write the same content to this session's new path. */
  upload: (path: string, file: TFile) => Promise<void>;
  read: (photo: Photo) => Promise<Photo | null>;
  /** Update only storage_path, matching id, user_id, restaurant_id and the old path. */
  updatePath: (photo: Photo, storagePath: string) => Promise<Photo | null>;
};

export function createSavedPhotoEditSession<TFile>(
  photo: Photo,
  file: TFile,
  createId: () => string = () => crypto.randomUUID(),
): SavedPhotoEditSession<TFile> {
  const version = createId();
  for (const id of [photo.id, photo.user_id, photo.restaurant_id, version]) {
    if (!id || id === "." || id === ".." || /[/\\]/.test(id)) {
      throw new Error("写真の識別情報が不正です。画面を開き直してください。");
    }
  }
  const storagePath = `${photo.user_id}/${photo.restaurant_id}/${photo.id}-${version}.edited.optimized.webp`;
  if (!photo.storage_path || photo.storage_path === storagePath) {
    throw new Error("写真の保存先が不正です。画面を開き直してください。");
  }
  return {
    photo: { ...photo }, file, storagePath, prepared: null,
    uploaded: false, updateAttempted: false, saved: null, pending: null,
  };
}

function checkCurrent<TFile>(session: SavedPhotoEditSession<TFile>, current: Photo | null) {
  const { photo, storagePath } = session;
  if (!current || current.id !== photo.id || current.user_id !== photo.user_id
    || current.restaurant_id !== photo.restaurant_id) {
    throw new Error("写真の登録情報を確認できませんでした。画面を開き直してください。");
  }
  if (session.updateAttempted && current.storage_path === storagePath) {
    session.saved = current;
    return current;
  }
  if (current.storage_path !== photo.storage_path) {
    throw new Error("この写真は別の操作で変更されています。画面を開き直して確認してください。");
  }
  return null;
}

/**
 * Replaces the pixels of one existing photo without changing its identity or metadata.
 * No object is removed: after an uncertain write, either version may still be in use.
 */
export function saveSavedPhotoEdit<TFile>(
  session: SavedPhotoEditSession<TFile>,
  deps: SavedPhotoEditDependencies<TFile>,
): Promise<Photo> {
  if (session.saved) return Promise.resolve(session.saved);
  if (session.pending) return session.pending;

  const save = async () => {
    // Also reconcile a previously attempted update before doing another write.
    const acknowledged = checkCurrent(session, await deps.read(session.photo));
    if (acknowledged) return acknowledged;
    if (session.prepared === null) session.prepared = await deps.prepare(session.file);
    if (!session.uploaded) {
      await deps.upload(session.storagePath, session.prepared);
      session.uploaded = true;
    }

    session.updateAttempted = true;
    let updateError: unknown;
    try {
      const saved = checkCurrent(session, await deps.updatePath(session.photo, session.storagePath));
      if (saved) return saved;
    } catch (error) {
      updateError = error;
    }
    // A network error or a zero-row response does not prove that the update failed.
    const reconciled = checkCurrent(session, await deps.read(session.photo));
    if (reconciled) return reconciled;
    if (updateError instanceof Error) throw updateError;
    throw new Error("編集した写真の保存を確認できませんでした。もう一度お試しください。");
  };

  session.pending = save().finally(() => { session.pending = null; });
  return session.pending;
}

"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { LoaderCircle, X } from "lucide-react";
import { useModalDialog } from "@/hooks/use-modal-dialog";
import { getBrowserClient } from "@/lib/browser-client";
import { optimizePhotoFile, PHOTO_CACHE_CONTROL_SECONDS } from "@/lib/photo-optimization";
import { createSavedPhotoEditSession, saveSavedPhotoEdit, type SavedPhotoEditSession } from "@/lib/saved-photo-edit";
import type { Photo } from "@/types/database";
import { PhotoEditor } from "./photo-editor";

export function SavedPhotoEditor({ photo, onSaved, onClose }: {
  photo: Photo;
  onSaved: (photo: Photo) => void;
  onClose: () => void;
}) {
  const activeRef = useRef(false);
  const sessionRef = useRef<SavedPhotoEditSession<File> | null>(null);
  const [loaded, setLoaded] = useState<{ path: string; file: File } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    activeRef.current = true;
    let cancelled = false;
    const client = getBrowserClient();
    async function download() {
      if (!client) throw new Error("接続設定を確認できませんでした。");
      const { data: auth, error: authError } = await client.auth.getUser();
      if (authError || auth.user?.id !== photo.user_id) throw new Error("写真を編集するには、登録したアカウントでログインしてください。");
      if (cancelled) return;
      const { data, error: downloadError } = await client.storage.from("food-photos").download(photo.storage_path);
      if (downloadError || !data) throw downloadError ?? new Error("写真を読み込めませんでした。");
      if (cancelled) return;
      const name = photo.storage_path.split("/").at(-1) || "photo.webp";
      setLoaded({ path: photo.storage_path, file: new File([data], name, { type: data.type || "image/webp" }) });
    }
    download().catch((cause: unknown) => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : "写真を読み込めませんでした。もう一度お試しください。");
    });
    return () => { cancelled = true; activeRef.current = false; };
  }, [photo.user_id, photo.storage_path, attempt]);

  async function save(file: File) {
    const client = getBrowserClient();
    if (!client) throw new Error("接続設定を確認できませんでした。");
    const { data: auth, error: authError } = await client.auth.getUser();
    if (authError || auth.user?.id !== photo.user_id) throw new Error("写真を編集するには、登録したアカウントでログインしてください。");
    function ensureActive() {
      if (!activeRef.current) throw new Error("写真の保存を中断しました。");
    }
    ensureActive();
    const session = sessionRef.current ?? createSavedPhotoEditSession(photo, file);
    sessionRef.current = session;
    const saved = await saveSavedPhotoEdit(session, {
      prepare: async (source) => {
        ensureActive();
        return (await optimizePhotoFile(source, { force: true })).file;
      },
      upload: async (path, prepared) => {
        ensureActive();
        const { error: uploadError } = await client.storage.from("food-photos").upload(path, prepared, {
          cacheControl: PHOTO_CACHE_CONTROL_SECONDS,
          contentType: prepared.type,
          upsert: true,
        });
        if (uploadError) throw uploadError;
      },
      read: async (original) => {
        ensureActive();
        const { data, error: readError } = await client.from("photos").select("*")
          .eq("id", original.id).eq("user_id", original.user_id).eq("restaurant_id", original.restaurant_id).maybeSingle();
        if (readError) throw readError;
        return data as Photo | null;
      },
      updatePath: async (original, storagePath) => {
        ensureActive();
        const { data, error: updateError } = await client.from("photos").update({ storage_path: storagePath })
          .eq("id", original.id).eq("user_id", original.user_id).eq("restaurant_id", original.restaurant_id)
          .eq("storage_path", original.storage_path).select("*").maybeSingle();
        if (updateError) throw updateError;
        return data as Photo | null;
      },
    });
    if (activeRef.current) {
      onSaved(saved);
      onClose();
    }
  }

  if (loaded?.path === photo.storage_path) {
    return <PhotoEditor file={loaded.file} onApply={save} onClose={onClose} applyLabel="写真を保存" applyingLabel="保存しています…" lockAfterApplyError />;
  }
  return <PhotoDownloadDialog error={error} onClose={onClose} onRetry={() => { setError(null); setAttempt((current) => current + 1); }} />;
}

function PhotoDownloadDialog({ error, onClose, onRetry }: { error: string | null; onClose: () => void; onRetry: () => void }) {
  const { dialogRef, onCancel } = useModalDialog(onClose);
  if (typeof document === "undefined") return null;
  return createPortal(
    <dialog ref={dialogRef} onCancel={onCancel} aria-label="編集する写真を読み込み" className="fixed inset-0 m-auto w-[calc(100%-2rem)] max-w-sm rounded-2xl border-0 bg-white p-5 text-stone-800 shadow-xl backdrop:bg-black/60">
      <div className="mb-4 flex items-center justify-between gap-4">
        <h2 className="font-bold">写真を編集</h2>
        <button type="button" onClick={onClose} aria-label="写真の編集を閉じる" className="grid size-11 place-items-center rounded-xl border border-stone-200"><X className="size-5" /></button>
      </div>
      {error ? <div className="space-y-4"><p role="alert" className="text-sm text-red-700">{error}</p><button type="button" onClick={onRetry} className="min-h-11 rounded-xl bg-primary px-4 text-sm font-semibold text-white">読み込みを再試行</button></div>
        : <p role="status" className="flex items-center gap-2 text-sm text-stone-500"><LoaderCircle className="size-4 animate-spin" aria-hidden="true" />写真を読み込んでいます…</p>}
    </dialog>, document.body,
  );
}

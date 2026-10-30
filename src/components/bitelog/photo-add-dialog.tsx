"use client";

import { useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { ImagePlus, LoaderCircle, X } from "lucide-react";
import { useModalDialog } from "@/hooks/use-modal-dialog";
import { getBrowserClient } from "@/lib/browser-client";
import { createPhotoUploadDependencies } from "@/lib/browser-photo-upload";
import { getNextPhotoSortOrder } from "@/lib/photo-order";
import { addRestaurantPhotoVisit } from "@/lib/restaurant-photo-visit";
import { createFormSaveSession } from "@/lib/form-save-session";
import { getLocalDateInputValue } from "@/lib/display-format";
import type { Photo, Restaurant, Visit } from "@/types/database";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, MessageBanner, type Message } from "./form-primitives";
import { PhotoPicker, createPhotoDrafts, type PhotoDraft } from "./photo-picker";

export function PhotoAddDialog({
  restaurant,
  photos,
  onAdded,
  onClose,
}: {
  restaurant: Restaurant;
  photos: Photo[];
  onAdded: (photos: Photo[], visit?: Visit) => void;
  onClose: () => void;
}) {
  const busyRef = useRef(false);
  const { dialogRef, activeRef, onCancel } = useModalDialog(close);
  const nextSortOrderRef = useRef(getNextPhotoSortOrder(photos));
  const [saveSession] = useState(createFormSaveSession);
  const [drafts, setDrafts] = useState<PhotoDraft[]>([]);
  const [mode, setMode] = useState<"visit" | "photos">(restaurant.status === "visited" ? "visit" : "photos");
  const [visitedAt, setVisitedAt] = useState(getLocalDateInputValue);
  const [caption, setCaption] = useState("");
  const [busy, setBusy] = useState(false);
  const [retryOnly, setRetryOnly] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);

  function close() {
    if (!busyRef.current) onClose();
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busyRef.current || !drafts.length) return;
    busyRef.current = true;
    setBusy(true);
    setMessage(null);

    try {
      const client = getBrowserClient();
      if (!client) throw new Error("写真の追加を利用できません。ページを再読み込みしてください。");
      const { data, error } = await client.auth.getUser();
      if (error || !data.user || data.user.id !== restaurant.user_id) {
        throw new Error("ログイン状態を確認できませんでした。再ログインしてお試しください。");
      }
      if (!activeRef.current) return;

      function ensureActive() {
        if (!activeRef.current) throw new Error("写真の保存を中断しました。");
      }
      const result = await addRestaurantPhotoVisit({
        candidates: drafts.map((draft) => ({ id: draft.id, file: draft.file })),
        userId: data.user.id,
        restaurantId: restaurant.id,
        startSortOrder: nextSortOrderRef.current,
        caption,
        newVisitDate: mode === "visit" ? visitedAt : null,
      }, {
        ...createPhotoUploadDependencies(client, { isActive: () => activeRef.current }),
        saveVisit: async (row) => {
          ensureActive();
          const { data: visit, error: visitError } = await client.from("visits")
            .upsert(row, { onConflict: "id" }).select().single();
          if (visitError || !visit) throw visitError ?? new Error("来店記録の保存結果を確認できませんでした。");
          return visit as Visit;
        },
        markVisited: async (restaurantId) => {
          ensureActive();
          const { data: saved, error: statusError } = await client.from("restaurants")
            .update({ status: "visited", updated_at: new Date().toISOString() })
            .eq("id", restaurantId).eq("user_id", data.user.id).select("id").single();
          if (statusError || !saved) throw statusError ?? new Error("店舗の来店状態を確認できませんでした。");
        },
      }, saveSession);

      if (!activeRef.current) return;
      nextSortOrderRef.current = result.nextSortOrder;
      const keepSelection = Boolean(result.error && (retryOnly || result.retryOnly));
      setRetryOnly(keepSelection);
      const remaining = new Set(result.remainingIds);
      setDrafts((current) => current.filter((draft) => remaining.has(draft.id)));
      if (result.photos.length || result.visit) onAdded(result.photos, result.visit ?? undefined);
      if (result.error) {
        setMessage({
          type: "error",
          text: `${result.visit ? "来店記録は保存しました。" : ""}${result.photos.length ? `${result.photos.length}枚を追加しました。` : ""}残り${result.remainingIds.length}枚を追加できませんでした。${keepSelection ? "内容を保ったまま「保存を再試行」を押してください。来店記録と写真は重複しません。" : "選択した写真や来店日を確認して、もう一度お試しください。"}${result.error.message}`,
        });
      } else {
        onClose();
      }
    } catch (error) {
      if (activeRef.current) {
        setMessage({ type: "error", text: error instanceof Error ? error.message : "写真を追加できませんでした。もう一度お試しください。" });
      }
    } finally {
      busyRef.current = false;
      if (activeRef.current) setBusy(false);
    }
  }

  if (typeof document === "undefined") return null;

  return createPortal(
    <dialog
      ref={dialogRef}
      aria-label="写真を追加"
      className="fixed inset-0 m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-3xl overflow-y-auto overscroll-contain rounded-2xl border-0 bg-white p-0 text-stone-800 shadow-2xl backdrop:bg-black/60 backdrop:backdrop-blur-sm"
      onCancel={onCancel}
    >
      <div className="flex shrink-0 items-start justify-between gap-3 border-b border-stone-100 p-4 sm:px-5">
        <div className="min-w-0">
          <h2 className="text-lg font-bold">写真を追加</h2>
          <p className="mt-1 break-words text-sm text-stone-500">{restaurant.name}</p>
        </div>
        <button aria-label="写真の追加を閉じる" className="grid size-11 shrink-0 place-items-center rounded-xl border border-stone-200 hover:bg-stone-50 disabled:opacity-40" type="button" onClick={close} disabled={busy}>
          <X className="size-5" />
        </button>
      </div>
      {/* Keep intrinsic block height: Safari can collapse flex: 1 inside an auto-height dialog. */}
      <form onSubmit={save}>
        <div className="space-y-5 p-4 sm:p-5">
          <fieldset disabled={busy || retryOnly} className="space-y-3">
            <legend className="mb-2 text-sm font-semibold text-stone-700">今回の記録</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 ${mode === "visit" ? "border-primary bg-primary/5" : "border-stone-200"}`}>
                <input type="radio" name="photo-add-mode" value="visit" checked={mode === "visit"} onChange={() => setMode("visit")} className="mt-1 accent-primary" />
                <span><span className="block text-sm font-semibold">新しい来店</span><span className="mt-1 block text-xs leading-relaxed text-stone-500">同じ日でも、来店回数が1回増えます。</span></span>
              </label>
              <label className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 ${mode === "photos" ? "border-primary bg-primary/5" : "border-stone-200"}`}>
                <input type="radio" name="photo-add-mode" value="photos" checked={mode === "photos"} onChange={() => setMode("photos")} className="mt-1 accent-primary" />
                <span><span className="block text-sm font-semibold">写真だけ</span><span className="mt-1 block text-xs leading-relaxed text-stone-500">来店回数や「行きたい」は変えません。</span></span>
              </label>
            </div>
            {mode === "visit" && <Field label="来店日"><Input type="date" required value={visitedAt} onChange={(event) => setVisitedAt(event.target.value)} /></Field>}
          </fieldset>
          <PhotoPicker
            photos={drafts}
            onChange={setDrafts}
            onAddFiles={(files) => {
              const added = createPhotoDrafts(files);
              setDrafts((current) => [...current, ...added]);
            }}
            disabled={busy || retryOnly}
            hasExistingPhotos={photos.length > 0}
          />
          <Field label="写真のメモ（任意）">
            <Input placeholder="例：ランチのパスタと店内" value={caption} disabled={busy || retryOnly} onChange={(event) => setCaption(event.target.value)} />
          </Field>
          {message && <MessageBanner message={message} />}
        </div>
        <div className="flex flex-wrap justify-end gap-2 border-t border-stone-100 bg-white p-4 sm:px-5">
          <Button type="button" variant="outline" disabled={busy} onClick={close}>キャンセル</Button>
          <Button type="submit" disabled={busy || !drafts.length}>
            {busy ? <LoaderCircle className="size-4 animate-spin" /> : <ImagePlus className="size-4" />}
            {busy ? "保存しています…" : retryOnly ? "保存を再試行" : mode === "visit" ? "来店と写真を保存する" : "写真を追加する"}
          </Button>
        </div>
      </form>
    </dialog>,
    document.body,
  );
}

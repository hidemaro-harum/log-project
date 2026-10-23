"use client";

import { useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { ImagePlus, LoaderCircle, X } from "lucide-react";
import { useModalDialog } from "@/hooks/use-modal-dialog";
import { getBrowserClient } from "@/lib/browser-client";
import { createPhotoUploadDependencies } from "@/lib/browser-photo-upload";
import { getNextPhotoSortOrder } from "@/lib/photo-order";
import { addRestaurantPhotos } from "@/lib/restaurant-photo-add";
import type { Photo, Restaurant } from "@/types/database";
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
  onAdded: (photos: Photo[]) => void;
  onClose: () => void;
}) {
  const busyRef = useRef(false);
  const { dialogRef, activeRef, onCancel } = useModalDialog(close);
  const nextSortOrderRef = useRef(getNextPhotoSortOrder(photos));
  const [drafts, setDrafts] = useState<PhotoDraft[]>([]);
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

      const result = await addRestaurantPhotos({
        candidates: drafts.map((draft) => ({ id: draft.id, file: draft.file })),
        userId: data.user.id,
        restaurantId: restaurant.id,
        startSortOrder: nextSortOrderRef.current,
        caption,
      }, createPhotoUploadDependencies(client, { isActive: () => activeRef.current }));

      if (!activeRef.current) return;
      nextSortOrderRef.current = result.nextSortOrder;
      const keepSelection = Boolean(result.error && (retryOnly || result.retryOnly));
      setRetryOnly(keepSelection);
      const remaining = new Set(result.remainingIds);
      setDrafts((current) => current.filter((draft) => remaining.has(draft.id)));
      if (result.photos.length) onAdded(result.photos);
      if (result.error) {
        setMessage({
          type: "error",
          text: `${result.photos.length ? `${result.photos.length}枚を追加しました。` : ""}残り${result.remainingIds.length}枚を追加できませんでした。${keepSelection ? "選択した写真を保ったまま、もう一度「写真を追加する」を押してください。確認できた写真は重複しません。" : "選択した写真を確認して、もう一度「写真を追加する」を押してください。"}${result.error.message}`,
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
      className="fixed inset-0 m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-3xl overflow-hidden rounded-2xl border-0 bg-white p-0 text-stone-800 shadow-2xl backdrop:bg-black/60 backdrop:backdrop-blur-sm open:flex open:flex-col"
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
      <form className="flex min-h-0 flex-1 flex-col" onSubmit={save}>
        <div className="min-h-0 space-y-5 overflow-y-auto p-4 sm:p-5">
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
        <div className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-stone-100 bg-white p-4 sm:px-5">
          <Button type="button" variant="outline" disabled={busy} onClick={close}>キャンセル</Button>
          <Button type="submit" disabled={busy || !drafts.length}>
            {busy ? <LoaderCircle className="size-4 animate-spin" /> : <ImagePlus className="size-4" />}
            {busy ? "追加しています…" : "写真を追加する"}
          </Button>
        </div>
      </form>
    </dialog>,
    document.body,
  );
}

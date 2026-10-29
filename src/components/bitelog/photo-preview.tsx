"use client";

import { Pencil, X } from "lucide-react";
import { useModalDialog } from "@/hooks/use-modal-dialog";
import type { Photo } from "@/types/database";
import { PhotoTile } from "./photo-tile";

export function PhotoPreview({
  photo,
  onClose,
  onEdit,
}: {
  photo: Photo;
  onClose: () => void;
  onEdit?: () => void;
}) {
  const { dialogRef, onCancel } = useModalDialog(onClose);

  return (
    <dialog
      ref={dialogRef}
      aria-label="写真プレビュー"
      className="fixed inset-0 m-0 h-dvh max-h-none w-screen max-w-none border-0 bg-transparent p-4 text-white backdrop:bg-black/90 backdrop:backdrop-blur-sm sm:p-6"
      onCancel={onCancel}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="pointer-events-none mx-auto flex h-full max-w-5xl flex-col gap-3">
        <div className="flex shrink-0 items-center justify-between gap-4">
          <p className="min-w-0 flex-1 break-words text-sm [overflow-wrap:anywhere]">{photo.caption || "食事の写真"}</p>
          <div className="pointer-events-auto flex shrink-0 gap-2">
            {onEdit && <button type="button" onClick={onEdit} className="inline-flex min-h-11 items-center gap-2 rounded-full bg-white/15 px-4 text-sm font-semibold hover:bg-white/25"><Pencil className="size-4" aria-hidden="true" />写真を編集</button>}
            <button
              type="button"
              aria-label="写真を閉じる"
              onClick={onClose}
              className="pointer-events-auto grid size-11 shrink-0 place-items-center rounded-full bg-white/15 text-white hover:bg-white/25"
            >
              <X className="size-5" />
            </button>
          </div>
        </div>
        <div className="pointer-events-auto min-h-0 flex-1">
          <PhotoTile
            className="size-full rounded-xl"
            fit="contain"
            sizes="(max-width: 1024px) 100vw, 1024px"
            photo={photo}
            eager
          />
        </div>
      </div>
    </dialog>
  );
}

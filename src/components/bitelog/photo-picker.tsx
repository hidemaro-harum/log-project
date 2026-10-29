"use client";

import { useEffect, useId, useRef, useState, type PointerEvent } from "react";
import Image from "next/image";
import { ArrowLeft, ArrowRight, GripVertical, ImagePlus, Pencil, Star, Trash2 } from "lucide-react";
import { DEFAULT_PHOTO_EDIT, type PhotoEdit } from "@/lib/photo-edit";
import { PhotoEditor } from "./photo-editor";

export type PhotoDraft = {
  id: string;
  original: File;
  file: File;
  edit: PhotoEdit;
};

export function createPhotoDrafts(files: File[]): PhotoDraft[] {
  return files.map((file) => ({ id: crypto.randomUUID(), original: file, file, edit: { ...DEFAULT_PHOTO_EDIT } }));
}

type PhotoPickerProps = {
  photos: PhotoDraft[];
  onChange: (photos: PhotoDraft[]) => void;
  onAddFiles: (files: File[]) => void;
  disabled?: boolean;
  hasExistingPhotos?: boolean;
};

const actionClass = "inline-flex min-h-11 min-w-11 whitespace-nowrap items-center justify-center gap-1.5 rounded-lg px-2 text-xs font-medium text-stone-600 hover:bg-stone-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-30";

function DraftPreview({ photo }: { photo: PhotoDraft }) {
  const [source, setSource] = useState<{ file: File; url: string } | null>(null);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  useEffect(() => {
    const url = URL.createObjectURL(photo.file);
    setSource({ file: photo.file, url });
    return () => URL.revokeObjectURL(url);
  }, [photo.file]);
  const url = source?.file === photo.file ? source.url : null;

  return (
    <div className="relative aspect-[4/3] overflow-hidden rounded-xl bg-stone-100">
      {url && failedUrl !== url ? (
        <Image src={url} alt={photo.original.name} fill unoptimized sizes="(max-width: 640px) 50vw, 240px" className="pointer-events-none object-contain" draggable={false} onError={() => setFailedUrl(url)} />
      ) : (
        <div className="flex h-full items-center justify-center p-3 text-center text-xs text-stone-500">{url ? "プレビューを表示できません" : "読み込み中…"}</div>
      )}
    </div>
  );
}

export function PhotoPicker({ photos, onChange, onAddFiles, disabled = false, hasExistingPhotos = false }: PhotoPickerProps) {
  const inputId = useId();
  const helpId = useId();
  const listRef = useRef<HTMLOListElement>(null);
  const dragRef = useRef<{
    id: string;
    pointerId: number;
    initial: PhotoDraft[];
    current: PhotoDraft[];
  } | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const editing = photos.find((photo) => photo.id === editingId);

  useEffect(() => {
    function cancelWithEscape(event: KeyboardEvent) {
      if (event.key !== "Escape" || !dragRef.current) return;
      event.preventDefault();
      onChange(dragRef.current.initial);
      dragRef.current = null;
      setDraggingId(null);
      setDropTargetId(null);
      setStatus("写真の並べ替えを取り消しました。");
    }
    window.addEventListener("keydown", cancelWithEscape);
    return () => window.removeEventListener("keydown", cancelWithEscape);
  }, [onChange]);

  function move(id: string, to: number) {
    const from = photos.findIndex((photo) => photo.id === id);
    if (disabled || from < 0 || to < 0 || to >= photos.length || from === to) return;
    const next = [...photos];
    const [photo] = next.splice(from, 1);
    next.splice(to, 0, photo);
    onChange(next);
    setStatus(`${photo.original.name}を${to + 1}番目に移動しました。`);
  }

  function startDrag(event: PointerEvent<HTMLButtonElement>, id: string) {
    if (disabled || photos.length < 2 || !event.isPrimary || event.button !== 0) return;
    dragRef.current = { id, pointerId: event.pointerId, initial: [...photos], current: [...photos] };
    event.currentTarget.setPointerCapture(event.pointerId);
    setDraggingId(id);
    setStatus("移動先の写真へドラッグしてください。Escキーで取り消せます。");
  }

  function dragOver(event: PointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-photo-draft-id]");
    if (!target || !listRef.current?.contains(target) || target.dataset.photoDraftId === drag.id) {
      drag.current = [...drag.initial];
      setDropTargetId(null);
      return;
    }
    const to = drag.initial.findIndex((photo) => photo.id === target.dataset.photoDraftId);
    const from = drag.initial.findIndex((photo) => photo.id === drag.id);
    if (to < 0 || from < 0 || from === to) return;
    const next = [...drag.initial];
    const [photo] = next.splice(from, 1);
    next.splice(to, 0, photo);
    drag.current = next;
    setDropTargetId(target.dataset.photoDraftId ?? null);
  }

  function finishDrag(event: PointerEvent<HTMLButtonElement>, cancelled = false) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setDraggingId(null);
    setDropTargetId(null);
    if (cancelled) {
      onChange(drag.initial);
      setStatus("写真の並べ替えを取り消しました。");
    } else {
      onChange(drag.current);
      const index = drag.current.findIndex((photo) => photo.id === drag.id);
      setStatus(`写真を${index + 1}番目に移動しました。`);
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  return (
    <div className="space-y-3">
      <div className="relative inline-flex max-w-full">
        <input
          id={inputId}
          aria-describedby={helpId}
          aria-label="写真を追加"
          className="peer absolute inset-0 z-10 size-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
          type="file"
          accept="image/*,.heic,.heif"
          multiple
          disabled={disabled}
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            try {
              if (files.length) onAddFiles(files);
            } finally {
              event.target.value = "";
            }
          }}
        />
        <label htmlFor={inputId} className={`pointer-events-none inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-primary/25 bg-primary/5 px-4 text-sm font-semibold text-primary peer-focus-visible:ring-2 peer-focus-visible:ring-primary peer-focus-visible:ring-offset-2 ${disabled ? "opacity-40" : "peer-hover:bg-primary/10"}`}>
          <ImagePlus aria-hidden="true" className="size-4" />{photos.length ? "写真を追加" : "写真を選ぶ"}
        </label>
      </div>
      <p id={helpId} className="text-xs leading-relaxed text-stone-500">
        写真はあとから追加できます。回転・切り抜きは「編集」、順番は矢印かつまみのドラッグで変更できます。
        {photos.length > 0 && <span className="mt-1 block font-medium text-stone-600">{hasExistingPhotos ? "選んだ写真は登録済み写真の後ろに追加されます。" : "1枚目の写真が表紙になります。"}</span>}
      </p>
      {photos.length > 0 && (
        <ol ref={listRef} aria-label="登録する写真の順番" className="grid grid-cols-1 gap-3 min-[375px]:grid-cols-2 lg:grid-cols-3">
          {photos.map((photo, index) => (
            <li key={photo.id} data-photo-draft-id={photo.id} className={`min-w-0 rounded-2xl border bg-white p-2 ${draggingId === photo.id ? "border-primary ring-2 ring-primary/20" : dropTargetId === photo.id ? "border-primary border-dashed bg-primary/5 ring-2 ring-primary/20" : "border-stone-200"}`}>
              <div className="mb-1 flex items-center justify-between gap-1">
                <span className={`rounded-full px-2 py-1 text-[11px] font-semibold ${index === 0 && !hasExistingPhotos ? "bg-primary/10 text-primary" : "bg-stone-100 text-stone-600"}`}>{index === 0 ? hasExistingPhotos ? "追加分の1枚目" : "1 · 表紙" : `${index + 1}枚目`}</span>
                <button
                  type="button"
                  disabled={disabled || photos.length < 2}
                  aria-label={`${photo.original.name}の順番をドラッグで変更`}
                  title="ドラッグして順番を変更"
                  className={`${actionClass} touch-none cursor-grab active:cursor-grabbing`}
                  onPointerDown={(event) => startDrag(event, photo.id)}
                  onPointerMove={dragOver}
                  onPointerUp={(event) => finishDrag(event)}
                  onPointerCancel={(event) => finishDrag(event, true)}
                  onLostPointerCapture={(event) => finishDrag(event, true)}
                ><GripVertical aria-hidden="true" className="size-5" /></button>
              </div>
              <DraftPreview photo={photo} />
              <p className="mt-2 truncate px-1 text-xs text-stone-600" title={photo.original.name}>{photo.original.name}</p>
              <div className="mt-1 flex items-center justify-between gap-1">
                <button type="button" disabled={disabled} aria-label={`${photo.original.name}を編集`} className={actionClass} onClick={() => setEditingId(photo.id)}><Pencil className="size-3.5" aria-hidden="true" />編集</button>
                <button type="button" disabled={disabled} aria-label={`${photo.original.name}を選択から削除`} className={`${actionClass} hover:text-red-600`} onClick={() => { onChange(photos.filter((item) => item.id !== photo.id)); setStatus(`${photo.original.name}を選択から削除しました。`); }}><Trash2 className="size-3.5" aria-hidden="true" />削除</button>
              </div>
              <div className="flex items-center justify-between gap-1 border-t border-stone-100 pt-1">
                <button type="button" disabled={disabled || index === 0} aria-label={`${photo.original.name}を前へ移動`} className={actionClass} onClick={() => move(photo.id, index - 1)}><ArrowLeft className="size-4" aria-hidden="true" /><span className="hidden sm:inline">前へ</span></button>
                <button type="button" disabled={disabled || index === photos.length - 1} aria-label={`${photo.original.name}を後ろへ移動`} className={actionClass} onClick={() => move(photo.id, index + 1)}><span className="hidden sm:inline">後ろへ</span><ArrowRight className="size-4" aria-hidden="true" /></button>
              </div>
              {index > 0 && <button type="button" disabled={disabled} aria-label={`${photo.original.name}を${hasExistingPhotos ? "追加分の先頭" : "表紙"}にする`} className={`${actionClass} mt-1 w-full text-primary`} onClick={() => move(photo.id, 0)}><Star className="size-3.5 shrink-0" aria-hidden="true" />{hasExistingPhotos ? "追加分の先頭にする" : "表紙にする"}</button>}
            </li>
          ))}
        </ol>
      )}
      <p role="status" aria-live="polite" aria-atomic="true" className="min-h-4 text-xs text-stone-500">{status || (photos.length ? `${photos.length}枚を選択中` : "")}</p>
      {editing && !disabled && <PhotoEditor key={editing.id} file={editing.original} initialEdit={editing.edit} onClose={() => setEditingId(null)} onApply={(file, edit) => { onChange(photos.map((photo) => photo.id === editing.id ? { ...photo, file, edit } : photo)); setStatus(`${editing.original.name}の編集を適用しました。`); setEditingId(null); }} />}
    </div>
  );
}

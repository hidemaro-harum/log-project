"use client";

import { useEffect, useId, useRef, useState, type PointerEvent } from "react";
import { createPortal } from "react-dom";
import { LoaderCircle, RotateCcw, RotateCw, Undo2, X } from "lucide-react";
import { useModalDialog } from "@/hooks/use-modal-dialog";
import {
  DEFAULT_PHOTO_EDIT,
  drawPhotoEdit,
  getPhotoEditGeometry,
  renderPhotoEdit,
  type PhotoEdit,
} from "@/lib/photo-edit";

type PhotoEditorProps = {
  file: File;
  initialEdit?: PhotoEdit;
  onApply: (file: File, edit: PhotoEdit) => void;
  onClose: () => void;
};

const buttonClass =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-stone-200 bg-white px-3 text-sm font-medium text-stone-700 transition-colors hover:bg-stone-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40";

const aspects: { value: PhotoEdit["aspect"]; label: string; hint: string }[] = [
  { value: "original", label: "元の比率", hint: "元" },
  { value: "square", label: "正方形", hint: "1:1" },
  { value: "portrait", label: "縦長", hint: "3:4" },
  { value: "landscape", label: "横長", hint: "4:3" },
];

export function PhotoEditor({ file, initialEdit, onApply, onClose }: PhotoEditorProps) {
  const titleId = useId();
  const descriptionId = useId();
  const { dialogRef, activeRef, onCancel } = useModalDialog(onClose);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const panRef = useRef<{
    pointerId: number;
    clientX: number;
    clientY: number;
    edit: PhotoEdit;
    xScale: number;
    yScale: number;
  } | null>(null);
  const [edit, setEdit] = useState<PhotoEdit>(() => ({ ...DEFAULT_PHOTO_EDIT, ...initialEdit }));
  const [loaded, setLoaded] = useState<{ file: File; image: HTMLImageElement } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [panning, setPanning] = useState(false);
  const image = loaded?.file === file ? loaded.image : null;

  useEffect(() => {
    let cancelled = false;
    const url = URL.createObjectURL(file);
    const nextImage = new Image();
    nextImage.onload = () => {
      if (!cancelled) {
        setLoaded({ file, image: nextImage });
        setError(null);
      }
    };
    nextImage.onerror = () => {
      if (!cancelled) setError("写真を読み込めませんでした。JPEG・PNGなどの写真でお試しください。");
    };
    nextImage.src = url;
    return () => {
      cancelled = true;
      nextImage.onload = null;
      nextImage.onerror = null;
      nextImage.removeAttribute("src");
      URL.revokeObjectURL(url);
    };
  }, [file]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !image) return;
    try {
      drawPhotoEdit(canvas, image, image.naturalWidth, image.naturalHeight, edit, 1024);
      setError(null);
    } catch {
      setError("写真のプレビューを表示できませんでした。別の写真でお試しください。");
    }
  }, [image, edit]);

  const geometry = image ? getPhotoEditGeometry(image.naturalWidth, image.naturalHeight, edit) : null;
  const canPanX = Boolean(geometry && geometry.rotatedWidth - geometry.crop.width > 0.5);
  const canPanY = Boolean(geometry && geometry.rotatedHeight - geometry.crop.height > 0.5);

  function beginPan(event: PointerEvent<HTMLCanvasElement>) {
    if (applying || !geometry || (!canPanX && !canPanY) || !event.isPrimary || event.button !== 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    panRef.current = {
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      edit: { ...edit },
      xScale: canPanX ? geometry.crop.width / rect.width / (geometry.rotatedWidth - geometry.crop.width) : 0,
      yScale: canPanY ? geometry.crop.height / rect.height / (geometry.rotatedHeight - geometry.crop.height) : 0,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setPanning(true);
  }

  function movePan(event: PointerEvent<HTMLCanvasElement>) {
    const pan = panRef.current;
    if (!pan || pan.pointerId !== event.pointerId) return;
    const clamp = (value: number) => Math.min(1, Math.max(0, value));
    setEdit({
      ...pan.edit,
      x: clamp(pan.edit.x - (event.clientX - pan.clientX) * pan.xScale),
      y: clamp(pan.edit.y - (event.clientY - pan.clientY) * pan.yScale),
    });
  }

  function finishPan(event: PointerEvent<HTMLCanvasElement>, cancelled = false) {
    const pan = panRef.current;
    if (!pan || pan.pointerId !== event.pointerId) return;
    panRef.current = null;
    if (cancelled) setEdit(pan.edit);
    setPanning(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  async function apply() {
    if (!image || applying) return;
    setApplying(true);
    setError(null);
    try {
      const isOriginal = (Object.keys(DEFAULT_PHOTO_EDIT) as (keyof PhotoEdit)[]).every((key) => edit[key] === DEFAULT_PHOTO_EDIT[key]);
      const result = isOriginal ? file : await renderPhotoEdit(file, edit);
      if (activeRef.current) onApply(result, { ...edit });
    } catch {
      if (activeRef.current) setError("写真の編集を適用できませんでした。もう一度お試しください。");
    } finally {
      if (activeRef.current) setApplying(false);
    }
  }

  if (typeof document === "undefined") return null;

  return createPortal(
    <dialog
      ref={dialogRef}
      aria-describedby={descriptionId}
      aria-labelledby={titleId}
      className="fixed inset-0 m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-4xl overflow-hidden open:flex open:flex-col rounded-2xl border-0 bg-white p-0 text-stone-800 shadow-2xl backdrop:bg-black/60 backdrop:backdrop-blur-sm"
      onCancel={onCancel}
    >
      <div className="flex shrink-0 items-center justify-between gap-4 border-b border-stone-100 px-5 py-3">
        <h2 id={titleId} className="text-lg font-bold">写真を編集</h2>
        <button type="button" aria-label="写真の編集を閉じる" className={buttonClass} onClick={onClose}>
          <X className="size-5" aria-hidden="true" />
        </button>
      </div>
      <div className="grid min-h-0 gap-5 overflow-y-auto p-5 md:grid-cols-[1.15fr_1fr]">
        <div className="min-w-0 space-y-2">
          <div className="relative flex min-h-52 items-center justify-center overflow-hidden rounded-xl bg-stone-100 p-2 md:min-h-80">
            {!image && !error && <p role="status" className="text-sm text-stone-500">写真を読み込み中…</p>}
            <canvas
              ref={canvasRef}
              aria-label="保存される写真のプレビュー。切り抜き位置はスライダーでも調整できます"
              role="img"
              className={`${image ? "block" : "hidden"} touch-none ${panning ? "cursor-grabbing" : canPanX || canPanY ? "cursor-grab" : ""}`}
              style={{ width: "auto", height: "auto", maxWidth: "100%", maxHeight: "42dvh" }}
              onPointerDown={beginPan}
              onPointerMove={movePan}
              onPointerUp={(event) => finishPan(event)}
              onPointerCancel={(event) => finishPan(event, true)}
              onLostPointerCapture={(event) => finishPan(event, true)}
            />
          </div>
          <p id={descriptionId} className="text-xs leading-relaxed text-stone-500">枠内の写真が保存されます。写真をドラッグして位置を調整できます。</p>
          <p className="truncate text-xs text-stone-400" title={file.name}>{file.name}</p>
        </div>
        <div className="space-y-5">
          <fieldset disabled={applying || !image} className="space-y-5 disabled:opacity-50">
            <div className="space-y-2">
              <p className="text-xs font-semibold text-stone-600">回転</p>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" className={buttonClass} onClick={() => setEdit((current) => ({ ...current, rotation: (current.rotation + 270) % 360, x: 0.5, y: 0.5 }))}>
                  <RotateCcw className="size-4" aria-hidden="true" />左に90°
                </button>
                <button type="button" className={buttonClass} onClick={() => setEdit((current) => ({ ...current, rotation: (current.rotation + 90) % 360, x: 0.5, y: 0.5 }))}>
                  <RotateCw className="size-4" aria-hidden="true" />右に90°
                </button>
              </div>
            </div>
            <fieldset>
              <legend className="mb-2 text-xs font-semibold text-stone-600">切り抜きの比率</legend>
              <div className="grid grid-cols-2 gap-2">
                {aspects.map((aspect) => (
                  <label key={aspect.value} className={`relative flex min-h-11 cursor-pointer items-center justify-between gap-2 rounded-xl border px-3 text-sm ${edit.aspect === aspect.value ? "border-primary bg-primary/5 font-semibold text-primary" : "border-stone-200 text-stone-600"}`}>
                    <input
                      type="radio"
                      name={`${titleId}-aspect`}
                      value={aspect.value}
                      checked={edit.aspect === aspect.value}
                      className="peer sr-only"
                      onChange={() => setEdit((current) => ({ ...current, aspect: aspect.value, x: 0.5, y: 0.5 }))}
                    />
                    <span>{aspect.label}</span><span className="text-xs opacity-70">{aspect.hint}</span>
                    <span aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-xl peer-focus-visible:ring-2 peer-focus-visible:ring-primary peer-focus-visible:ring-offset-2" />
                  </label>
                ))}
              </div>
            </fieldset>
            <label className="block text-xs font-semibold text-stone-600">
              <span className="flex justify-between"><span>拡大</span><span className="tabular-nums">{edit.zoom.toFixed(2)}倍</span></span>
              <input type="range" min="1" max="3" step="0.01" value={edit.zoom} className="h-11 w-full accent-primary" onChange={(event) => setEdit((current) => ({ ...current, zoom: Number(event.target.value) }))} />
            </label>
            <div className="grid grid-cols-2 gap-4">
              <label className="block text-xs font-semibold text-stone-600">
                切り抜き位置（左右）
                <input type="range" min="0" max="1" step="0.01" value={edit.x} disabled={!canPanX} className="h-11 w-full accent-primary disabled:opacity-30" onChange={(event) => setEdit((current) => ({ ...current, x: Number(event.target.value) }))} />
              </label>
              <label className="block text-xs font-semibold text-stone-600">
                切り抜き位置（上下）
                <input type="range" min="0" max="1" step="0.01" value={edit.y} disabled={!canPanY} className="h-11 w-full accent-primary disabled:opacity-30" onChange={(event) => setEdit((current) => ({ ...current, y: Number(event.target.value) }))} />
              </label>
            </div>
            <button type="button" className={buttonClass} onClick={() => setEdit({ ...DEFAULT_PHOTO_EDIT })}>
              <Undo2 className="size-4" aria-hidden="true" />元の写真に戻す
            </button>
          </fieldset>
          {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        </div>
      </div>
      <div className="flex shrink-0 justify-end gap-2 border-t border-stone-100 px-5 py-4">
        <button type="button" className={buttonClass} onClick={onClose}>キャンセル</button>
        <button type="button" disabled={applying || !image} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-primary px-5 text-sm font-semibold text-white hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:opacity-40" onClick={apply}>
          {applying && <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />}
          {applying ? "適用中…" : "編集を適用"}
        </button>
      </div>
    </dialog>,
    document.body,
  );
}

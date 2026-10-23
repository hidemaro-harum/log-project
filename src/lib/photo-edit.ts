export type PhotoEdit = {
  rotation: number;
  aspect: "original" | "square" | "portrait" | "landscape";
  zoom: number;
  x: number;
  y: number;
};

export const DEFAULT_PHOTO_EDIT = {
  rotation: 0,
  aspect: "original",
  zoom: 1,
  x: 0.5,
  y: 0.5,
} satisfies PhotoEdit;

export type PhotoEditGeometry = {
  rotatedWidth: number;
  rotatedHeight: number;
  crop: { x: number; y: number; width: number; height: number };
};

function validDimension(value: number) {
  return Number.isSafeInteger(value) && value > 0;
}

function normalizeRotation(rotation: number) {
  if (!Number.isSafeInteger(rotation) || !Number.isInteger(rotation / 90)) {
    throw new Error("写真の回転角度は90度単位で指定してください。");
  }
  return ((rotation % 360) + 360) % 360;
}

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) throw new Error("写真の編集設定が不正です。");
  return Math.max(min, Math.min(max, value));
}

/** Crop coordinates are measured in the image after its clockwise rotation. */
export function getPhotoEditGeometry(
  width: number,
  height: number,
  edit: PhotoEdit,
): PhotoEditGeometry {
  if (!validDimension(width) || !validDimension(height)) {
    throw new Error("画像サイズが不正です。");
  }

  const rotation = normalizeRotation(edit.rotation);
  const swapDimensions = rotation === 90 || rotation === 270;
  const rotatedWidth = swapDimensions ? height : width;
  const rotatedHeight = swapDimensions ? width : height;
  const zoom = clamp(edit.zoom, 1, 3);
  const x = clamp(edit.x, 0, 1);
  const y = clamp(edit.y, 0, 1);
  let aspect: number;

  switch (edit.aspect) {
    case "original":
      aspect = rotatedWidth / rotatedHeight;
      break;
    case "square":
      aspect = 1;
      break;
    case "portrait":
      aspect = 3 / 4;
      break;
    case "landscape":
      aspect = 4 / 3;
      break;
    default:
      throw new Error("写真の切り抜き比率が不正です。");
  }

  // The largest crop with the requested ratio, reduced by the selected zoom.
  const cropWidth = (edit.aspect === "original"
    ? rotatedWidth
    : Math.min(rotatedWidth, rotatedHeight * aspect)) / zoom;
  const cropHeight = (edit.aspect === "original"
    ? rotatedHeight
    : Math.min(rotatedHeight, rotatedWidth / aspect)) / zoom;
  return {
    rotatedWidth,
    rotatedHeight,
    crop: {
      x: (rotatedWidth - cropWidth) * x,
      y: (rotatedHeight - cropHeight) * y,
      width: cropWidth,
      height: cropHeight,
    },
  };
}

/** Shared by the editor preview and export; no full-resolution canvas is needed. */
export function drawPhotoEdit(
  canvas: HTMLCanvasElement,
  image: CanvasImageSource,
  width: number,
  height: number,
  edit: PhotoEdit,
  maxEdge = 2048,
): void {
  if (!validDimension(maxEdge)) throw new Error("画像サイズが不正です。");
  const { rotatedWidth, rotatedHeight, crop } = getPhotoEditGeometry(width, height, edit);
  // Even callers requesting a larger preview cannot allocate an oversized canvas.
  const scale = Math.min(1, Math.min(maxEdge, 2048) / Math.max(crop.width, crop.height));
  canvas.width = Math.max(1, Math.round(crop.width * scale));
  canvas.height = Math.max(1, Math.round(crop.height * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("写真の編集処理を開始できませんでした。");

  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.scale(canvas.width / crop.width, canvas.height / crop.height);
  context.translate(-crop.x, -crop.y);
  context.translate(rotatedWidth / 2, rotatedHeight / 2);
  context.rotate((normalizeRotation(edit.rotation) * Math.PI) / 180);
  context.drawImage(image, -width / 2, -height / 2, width, height);
}

export async function renderPhotoEdit(file: File, edit: PhotoEdit): Promise<File> {
  if (file.type && !file.type.startsWith("image/")) {
    throw new Error(`${file.name} は画像ファイルではありません。`);
  }

  const url = URL.createObjectURL(file);
  try {
    // HTMLImageElement decoding applies the source's EXIF orientation before
    // exposing natural dimensions; the same image path is used by the preview.
    const image = new Image();
    image.decoding = "async";
    image.src = url;
    try {
      await image.decode();
    } catch {
      throw new Error(`${file.name} を読み込めませんでした。JPEG・PNG・WebP画像を選択してください。`);
    }

    const canvas = document.createElement("canvas");
    drawPhotoEdit(canvas, image, image.naturalWidth, image.naturalHeight, edit);
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((result) => {
        if (result) resolve(result);
        else reject(new Error("編集した写真を保存できませんでした。"));
      }, "image/png");
    });
    const stem = file.name.replace(/\.[^.]+$/, "") || "photo";
    return new File([blob], `${stem}.edited.png`, {
      type: "image/png",
      lastModified: file.lastModified,
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

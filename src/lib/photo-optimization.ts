export const PHOTO_MAX_EDGE = 1024;
export const PHOTO_WEBP_QUALITY = 0.62;
export const PHOTO_CACHE_CONTROL_SECONDS = "31536000";
export const OPTIMIZED_PHOTO_SUFFIX = ".optimized.webp";

export type PhotoOptimizationResult = {
  file: File;
  originalBytes: number;
  optimizedBytes: number;
  savedBytes: number;
};

export function getContainedImageSize(width: number, height: number, maxEdge = PHOTO_MAX_EDGE) {
  if (width <= 0 || height <= 0 || maxEdge <= 0) {
    throw new Error("画像サイズが不正です。");
  }

  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export function getOptimizedPhotoName(fileName: string) {
  const withoutExtension = fileName.replace(/\.[^.]+$/, "") || "photo";
  return `${withoutExtension}${OPTIMIZED_PHOTO_SUFFIX}`;
}

export function getOptimizedStoragePath(storagePath: string) {
  const slashIndex = storagePath.lastIndexOf("/");
  const directory = slashIndex >= 0 ? storagePath.slice(0, slashIndex + 1) : "";
  const fileName = slashIndex >= 0 ? storagePath.slice(slashIndex + 1) : storagePath;
  return `${directory}${getOptimizedPhotoName(fileName)}`;
}

export function isOptimizedStoragePath(storagePath: string) {
  return storagePath.toLowerCase().endsWith(OPTIMIZED_PHOTO_SUFFIX);
}

export async function optimizePhotoFile(
  file: File,
  options: { maxEdge?: number; quality?: number; force?: boolean } = {},
): Promise<PhotoOptimizationResult> {
  if (!file.type.startsWith("image/")) {
    throw new Error(`${file.name} は画像ファイルではありません。`);
  }

  const maxEdge = options.maxEdge ?? PHOTO_MAX_EDGE;
  const quality = options.quality ?? PHOTO_WEBP_QUALITY;
  const image = await loadImage(file);

  try {
    const size = getContainedImageSize(image.naturalWidth, image.naturalHeight, maxEdge);
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("画像の圧縮処理を開始できませんでした。");

    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(image, 0, 0, size.width, size.height);

    const blob = await canvasToBlob(canvas, "image/webp", quality);
    const shouldUseOptimized = options.force || blob.size < file.size;
    const optimizedFile = shouldUseOptimized
      ? new File([blob], getOptimizedPhotoName(file.name), {
          type: blob.type,
          lastModified: file.lastModified,
        })
      : file;

    return {
      file: optimizedFile,
      originalBytes: file.size,
      optimizedBytes: optimizedFile.size,
      savedBytes: Math.max(0, file.size - optimizedFile.size),
    };
  } finally {
    URL.revokeObjectURL(image.src);
  }
}

async function loadImage(file: File) {
  const image = new Image();
  image.decoding = "async";
  image.src = URL.createObjectURL(file);

  try {
    await image.decode();
    return image;
  } catch {
    URL.revokeObjectURL(image.src);
    throw new Error(`${file.name} を読み込めませんでした。JPEG・PNG・WebP画像を選択してください。`);
  }
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("画像を圧縮できませんでした。"));
    }, type, quality);
  });
}

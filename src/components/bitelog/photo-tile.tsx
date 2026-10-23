"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { ImageOff } from "lucide-react";
import type { Photo } from "@/types/database";
import { getSignedPhotoUrl } from "@/lib/photo-urls";

type PhotoTileProps = {
  className?: string;
  photo: Photo;
  size?: "thumb" | "gallery";
  eager?: boolean;
  fit?: "cover" | "contain";
  imagePosition?: string;
  sizes?: string;
};

export function PhotoTile({
  className = "aspect-square size-full",
  photo,
  size = "gallery",
  eager = false,
  fit = "cover",
  imagePosition = "center",
  sizes,
}: PhotoTileProps) {
  const [source, setSource] = useState<{
    path: string;
    url: string | null;
  } | null>(null);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getSignedPhotoUrl(photo.storage_path).then((url) => {
      if (!cancelled) setSource({ path: photo.storage_path, url });
    });
    return () => {
      cancelled = true;
    };
  }, [photo.storage_path]);

  const current = source?.path === photo.storage_path ? source : null;
  if (!current)
    return (
      <div
        className={`shimmer rounded-2xl ${className}`}
        role="img"
        aria-label="写真を読み込み中"
      />
    );
  if (!current.url || failedUrl === current.url) {
    return (
      <div
        className={`flex flex-col items-center justify-center gap-2 rounded-2xl bg-stone-100 text-stone-500 ${className}`}
        role="img"
        aria-label="写真を表示できません"
      >
        <ImageOff className="size-6" aria-hidden="true" />
        <span className="text-xs">写真を表示できません</span>
      </div>
    );
  }

  return (
    <div
      className={`relative overflow-hidden rounded-2xl ${fit === "contain" ? "bg-transparent" : "bg-stone-50"} ${className}`}
    >
      <Image
        alt={photo.caption || "食事の写真"}
        className={fit === "contain" ? "object-contain" : "object-cover"}
        fill
        loading={eager ? "eager" : "lazy"}
        priority={eager}
        sizes={
          sizes ??
          (size === "thumb"
            ? "88px"
            : eager
              ? "(max-width: 1024px) 100vw, 720px"
              : "(max-width: 768px) 50vw, 384px")
        }
        src={current.url}
        style={{ objectPosition: imagePosition }}
        onError={() => setFailedUrl(current.url)}
      />
    </div>
  );
}

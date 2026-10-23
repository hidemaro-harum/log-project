"use client";

import { useMemo, useState, useEffect } from "react";
import {
  ArrowUpRight,
  Camera,
  ChevronLeft,
  ChevronRight,
  Compass,
  Utensils,
} from "lucide-react";
import type { Restaurant } from "@/types/database";
import { sortPhotos } from "@/lib/photo-order";
import { Button } from "@/components/ui/button";
import { PhotoTile } from "./photo-tile";
import { formatShortDate } from "@/lib/display-format";

export function Dashboard({
  restaurants,
  stats,
  onAdd,
  onOpen,
  onOpenMap,
}: {
  restaurants: Restaurant[];
  stats: { total: number; visited: number; wishlist: number; photos: number };
  onAdd: () => void;
  onOpen: (restaurant: Restaurant) => void;
  onOpenMap: () => void;
}) {
  const memories = useMemo(() => {
    const visits = restaurants
      .flatMap((restaurant) =>
        (restaurant.visits ?? []).map((visit) => ({
          key: visit.id,
          restaurant,
          date: visit.visited_at,
          createdAt: visit.created_at,
          photo:
            sortPhotos(
              restaurant.photos?.filter((photo) => photo.visit_id === visit.id),
            )[0] ?? sortPhotos(restaurant.photos)[0],
        })),
      )
      .sort(
        (a, b) =>
          b.date.localeCompare(a.date) ||
          b.createdAt.localeCompare(a.createdAt),
      )
      .slice(0, 6);

    if (visits.length) return visits;

    return restaurants
      .flatMap((restaurant) =>
        sortPhotos(restaurant.photos).map((photo) => ({
          key: photo.id,
          restaurant,
          date: photo.created_at,
          createdAt: photo.created_at,
          photo,
        })),
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 6);
  }, [restaurants]);
  const [spotlightIndex, setSpotlightIndex] = useState(0);

  useEffect(() => {
    if (spotlightIndex >= memories.length) setSpotlightIndex(0);
  }, [memories.length, spotlightIndex]);

  const memory = memories[spotlightIndex] ?? memories[0];
  const spotlight = memory?.restaurant;
  const spotlightPhoto = memory?.photo;
  const spotlightDate = memory?.date;

  return (
    <section aria-label="食事の振り返り" className="mx-auto mb-8 max-w-6xl">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-stone-800 sm:text-3xl">
            おいしい記憶、増やしていこう。
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-stone-600">
            あのお店も、次の一皿も。あなたの食事ノート。
          </p>
        </div>
        <Button
          className="hidden shrink-0 rounded-xl sm:inline-flex md:hidden"
          onClick={onAdd}
        >
          <Camera className="size-4" />
          記録する
        </Button>
      </div>
      <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
        <div className="relative overflow-hidden rounded-2xl bg-[#e8eee7]">
          <div className="relative aspect-[16/9] w-full max-h-[320px] min-h-[200px] overflow-hidden">
            {spotlightPhoto ? (
              <PhotoTile
                className="absolute inset-0 size-full rounded-none"
                photo={spotlightPhoto}
                eager
                imagePosition="center 38%"
              />
            ) : (
              <div className="flex size-full flex-col items-center justify-center gap-3 pb-20 text-primary/60">
                <Utensils className="size-12 stroke-[1.2]" />
                <p className="text-sm">今日の一皿を、未来の楽しみに。</p>
              </div>
            )}
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/80 via-black/5 to-transparent" />
            <span className="absolute left-4 top-4 rounded-full bg-white/95 px-3 py-1.5 text-xs font-medium text-stone-700">
              {spotlightDate
                ? `最近の訪問 ${formatShortDate(spotlightDate)}`
                : "あなたの食事ノート"}
            </span>
            <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 p-5 text-white">
              <div className="min-w-0">
                <h2 className="truncate text-xl font-bold sm:text-2xl">
                  {spotlight ? spotlight.name : "最初の一皿を残しましょう"}
                </h2>
                <p className="mt-1 text-xs text-white/85">
                  {spotlight
                    ? [spotlight.area, spotlight.genre]
                        .filter(Boolean)
                        .join(" / ")
                    : "写真とひとことから始められます"}
                </p>
              </div>
              {spotlight ? (
                <button
                  aria-label={`${spotlight.name}の思い出を見る`}
                  className="grid size-11 shrink-0 place-items-center rounded-full bg-white text-primary"
                  type="button"
                  onClick={() => onOpen(spotlight)}
                >
                  <ArrowUpRight className="size-5" />
                </button>
              ) : (
                <Button
                  className="shrink-0 rounded-xl bg-white text-primary hover:bg-stone-100"
                  onClick={onAdd}
                >
                  記録する
                </Button>
              )}
            </div>
          </div>
          {memories.length > 1 && (
            <div className="flex items-center justify-between bg-white px-4 py-1.5">
              <p className="text-xs text-stone-600">
                最近の思い出{" "}
                <span className="ml-2 tabular-nums">
                  {spotlightIndex + 1} / {memories.length}
                </span>
              </p>
              <div className="flex gap-1">
                <button
                  type="button"
                  aria-label="前の思い出"
                  className="grid size-10 place-items-center rounded-lg text-stone-600 hover:bg-stone-100"
                  onClick={() =>
                    setSpotlightIndex(
                      (spotlightIndex - 1 + memories.length) % memories.length,
                    )
                  }
                >
                  <ChevronLeft className="size-4" />
                </button>
                <button
                  type="button"
                  aria-label="次の思い出"
                  className="grid size-10 place-items-center rounded-lg text-stone-600 hover:bg-stone-100"
                  onClick={() =>
                    setSpotlightIndex((spotlightIndex + 1) % memories.length)
                  }
                >
                  <ChevronRight className="size-4" />
                </button>
              </div>
            </div>
          )}
        </div>
        <div className="flex flex-col justify-between rounded-2xl border border-stone-200 bg-white p-5 sm:p-6">
          <div>
            <h2 className="text-base font-bold text-stone-800">
              これまでの食の記録
            </h2>
            <dl className="mt-4 grid grid-cols-2 gap-x-5 gap-y-4">
              {(
                [
                  ["行ったお店", stats.visited, "店"],
                  ["行きたいお店", stats.wishlist, "店"],
                  ["残した写真", stats.photos, "枚"],
                  ["すべてのお店", stats.total, "店"],
                ] as const
              ).map(([label, value, unit]) => (
                <div key={label} className="border-b border-stone-100 pb-3">
                  <dt className="text-xs text-stone-600">{label}</dt>
                  <dd className="mt-1 text-2xl font-semibold tabular-nums text-stone-800">
                    {value}
                    <span className="ml-1.5 text-xs font-normal text-stone-500">
                      {unit}
                    </span>
                  </dd>
                </div>
              ))}
            </dl>
          </div>
          <button
            className="mt-5 flex min-h-12 items-center justify-between gap-3 rounded-xl bg-secondary px-4 py-3 text-left text-primary transition-colors hover:bg-primary/15"
            type="button"
            onClick={onOpenMap}
          >
            <span className="inline-flex items-center gap-2 text-sm font-semibold">
              <Compass className="size-5" />
              地図で記録を振り返る
            </span>
            <ArrowUpRight className="size-4" />
          </button>
        </div>
      </div>
    </section>
  );
}

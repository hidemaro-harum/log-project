"use client";

import {
  Clock3,
  Heart,
  MapPin,
  Plus,
  Search,
  SlidersHorizontal,
  Star,
  Utensils,
} from "lucide-react";
import type { Restaurant, RestaurantStatus } from "@/types/database";
import { formatShortDate } from "@/lib/display-format";
import type { SortMode } from "@/lib/restaurant-sort";
import { Button } from "@/components/ui/button";
import { PhotoTile } from "./photo-tile";

export function RestaurantCard({
  restaurant,
  onClick,
}: {
  restaurant: Restaurant;
  index?: number;
  onClick: () => void;
}) {
  const photo = restaurant.photos?.[0];
  const latestDate =
    restaurant.latest_visit_at ??
    restaurant.visits?.reduce<string | null>(
      (latest, visit) =>
        !latest || visit.visited_at > latest ? visit.visited_at : latest,
      null,
    );
  const dateLabel = latestDate ? formatShortDate(latestDate) : null;

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`${restaurant.name}の記録を見る`}
      className="group flex min-w-0 flex-col overflow-hidden rounded-2xl border border-stone-200 bg-white text-left transition-colors hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-4"
    >
      <div className="relative aspect-[4/3] w-full shrink-0 overflow-hidden bg-stone-100">
        {photo ? (
          <PhotoTile className="size-full rounded-none" photo={photo} />
        ) : (
          <div className="flex size-full flex-col items-center justify-center gap-2 bg-[#edf1ed] text-primary/60">
            <Utensils className="size-9 stroke-[1.3]" aria-hidden="true" />
            <span className="text-xs">写真はこれから</span>
          </div>
        )}
        <span
          className={`absolute left-2.5 top-2.5 rounded-full px-2.5 py-1 text-[11px] font-semibold shadow-sm ${restaurant.status === "visited" ? "bg-white/95 text-primary" : "bg-[#fff6df] text-[#795b20]"}`}
        >
          {restaurant.status === "visited" ? "行った" : "行きたい"}
        </span>
        {restaurant.wants_to_revisit && (
          <span
            className="absolute right-2.5 top-2.5 grid size-8 place-items-center rounded-full bg-white/95 text-rose-600"
            aria-label="また行きたい"
          >
            <Heart className="size-4 fill-current" aria-hidden="true" />
          </span>
        )}
      </div>
      <div className="w-full space-y-2.5 p-3 sm:p-4">
        <div className="flex items-start justify-between gap-2">
          <h2 className="line-clamp-2 text-sm font-bold leading-relaxed text-stone-800 sm:text-base">
            {restaurant.name}
          </h2>
          {restaurant.rating != null && (
            <span
              className="flex shrink-0 items-center gap-1 pt-1 text-xs font-semibold text-stone-700"
              aria-label={`評価 ${restaurant.rating}点`}
            >
              <Star
                className="size-3.5 fill-amber-400 text-amber-500"
                aria-hidden="true"
              />
              {restaurant.rating.toFixed(1)}
            </span>
          )}
        </div>
        <p className="flex items-center gap-1 text-xs text-stone-600">
          <MapPin className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="truncate">{restaurant.area || "エリア未設定"}</span>
        </p>
        <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 border-t border-stone-100 pt-2.5 text-[11px] text-stone-500">
          <span className="truncate">
            {restaurant.genre || "ジャンル未設定"}
          </span>
          <span className="inline-flex items-center gap-1">
            <Clock3 className="size-3" aria-hidden="true" />
            {dateLabel ??
              (restaurant.status === "wishlist"
                ? "これからの楽しみ"
                : "訪問日未設定")}
          </span>
        </div>
      </div>
    </button>
  );
}

export function ListControls({
  sortMode,
  status,
  count,
  query,
  onSortModeChange,
  onStatusChange,
  onQueryChange,
}: {
  sortMode: SortMode;
  status: "all" | RestaurantStatus;
  count: number;
  query: string;
  onSortModeChange: (value: SortMode) => void;
  onStatusChange: (value: "all" | RestaurantStatus) => void;
  onQueryChange: (value: string) => void;
}) {
  return (
    <section aria-label="お店を探す" className="mx-auto max-w-6xl space-y-4">
      <div className="flex items-baseline gap-3">
        <h2 className="text-xl font-bold tracking-tight text-stone-800">
          お店の記録
        </h2>
        <p role="status" className="text-sm tabular-nums text-stone-500">
          {count}件{query.trim() && "の検索結果"}
        </p>
      </div>
      <div className="relative sm:hidden">
        <Search
          className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-stone-500"
          aria-hidden="true"
        />
        <input
          type="search"
          aria-label="お店を検索"
          placeholder="店名・エリア・ジャンル・タグ"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          className="h-12 w-full rounded-xl border border-stone-200 bg-white pl-10 pr-3 text-sm"
        />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <div
          role="group"
          aria-label="訪問状況で絞り込む"
          className="flex rounded-xl bg-stone-200/60 p-1"
        >
          {(
            [
              ["all", "すべて"],
              ["visited", "行った"],
              ["wishlist", "行きたい"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              aria-pressed={status === value}
              className={`min-h-10 rounded-lg px-4 text-xs font-semibold transition-colors ${status === value ? "bg-white text-primary shadow-sm" : "text-stone-600 hover:bg-white/50"}`}
              type="button"
              onClick={() => onStatusChange(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="relative ml-auto">
          <SlidersHorizontal
            className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-stone-500"
            aria-hidden="true"
          />
          <select
            aria-label="並び替え"
            className="h-11 cursor-pointer rounded-xl border border-stone-200 bg-white pl-9 pr-7 text-xs font-medium text-stone-700"
            value={sortMode}
            onChange={(event) =>
              onSortModeChange(event.target.value as SortMode)
            }
          >
            <option value="newest">最新の更新順</option>
            <option value="rating">評価の高い順</option>
            <option value="visitDate">訪問日順</option>
          </select>
        </div>
      </div>
    </section>
  );
}

export function EmptyState({
  hasRecords,
  filtered,
  onAdd,
  onReset,
}: {
  hasRecords: boolean;
  filtered: boolean;
  onAdd: () => void;
  onReset: () => void;
}) {
  return (
    <div className="mx-auto my-6 flex max-w-6xl flex-col items-center gap-4 rounded-2xl border border-dashed border-stone-300 bg-white/60 px-5 py-14 text-center">
      <div className="grid size-14 place-items-center rounded-full bg-secondary text-primary">
        {hasRecords ? (
          <Search className="size-6" />
        ) : (
          <Utensils className="size-6" />
        )}
      </div>
      <div className="space-y-2">
        <h2 className="text-base font-bold text-stone-800">
          {hasRecords
            ? "条件に合うお店がありません"
            : "最初の一皿から、記録を始めよう"}
        </h2>
        <p className="max-w-sm text-sm leading-relaxed text-stone-600">
          {hasRecords
            ? "検索する言葉や「行った・行きたい」の条件を変えてみてください。"
            : "食べた料理も、次に行きたいお店も。あなたのペースで残せます。"}
        </p>
      </div>
      {hasRecords && filtered ? (
        <Button variant="outline" onClick={onReset}>
          検索・絞り込みをクリア
        </Button>
      ) : (
        <Button onClick={onAdd}>
          <Plus className="size-4" />
          お店を記録する
        </Button>
      )}
    </div>
  );
}

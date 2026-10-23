"use client";

import { MapPin } from "lucide-react";
import type { PlaceSuggestion } from "@/lib/place-suggestions";

export type PlaceLookupState = {
  status: "idle" | "loading" | "ready" | "empty" | "unavailable" | "error";
  message: string;
  suggestions: PlaceSuggestion[];
};

export function PlaceSuggestionPanel({
  lookup,
  onSelect,
  disabled = false,
  id,
}: {
  lookup: PlaceLookupState;
  onSelect: (suggestion: PlaceSuggestion) => void;
  disabled?: boolean;
  id?: string;
}) {
  const isError = lookup.status === "error";
  const isUnavailable = lookup.status === "unavailable" || lookup.status === "empty";

  return (
    <div className="mt-3 space-y-3 rounded-xl border border-stone-200 bg-white p-3" id={id}>
      <p
        aria-atomic="true"
        className={`flex items-start gap-2 text-xs font-medium leading-relaxed ${
          isError ? "text-red-700" : isUnavailable ? "text-amber-800" : "text-stone-600"
        }`}
        role="status"
      >
        {lookup.status === "loading" ? (
          <span aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 animate-spin rounded-full border border-primary/20 border-t-primary" />
        ) : (
          <MapPin aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
        )}
        <span>{lookup.message}</span>
      </p>

      {lookup.suggestions.length > 0 && (
        <>
          <ul aria-label="飲食店の候補" className="space-y-2">
            {lookup.suggestions.map((suggestion) => (
              <li key={suggestion.id}>
                <button
                  className="min-h-11 w-full rounded-xl border border-stone-200 bg-stone-50/70 px-3 py-3 text-left transition-colors hover:border-primary/40 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={disabled}
                  type="button"
                  onClick={() => onSelect(suggestion)}
                >
                  <span className="flex items-start justify-between gap-3">
                    <span className="min-w-0 space-y-1">
                      <span className="block text-sm font-bold leading-relaxed text-stone-800">{suggestion.name}</span>
                      <span className="block text-xs leading-relaxed text-stone-600">
                        {suggestion.address || "住所未取得"}
                      </span>
                    </span>
                    <span className="shrink-0 rounded-lg bg-white px-2 py-1 text-[11px] font-semibold text-stone-600">
                      {formatDistance(suggestion.distanceMeters)}
                    </span>
                  </span>
                  {suggestion.genre && (
                    <span className="mt-2 inline-block rounded-md bg-white px-2 py-1 text-[11px] text-stone-600">
                      {suggestion.genre}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
          <p className="text-right text-[11px] text-stone-500">店舗情報: Google Maps</p>
        </>
      )}
    </div>
  );
}

function formatDistance(distanceMeters: number | null) {
  if (distanceMeters === null || !Number.isFinite(distanceMeters) || distanceMeters < 0) return "距離不明";
  if (distanceMeters < 1000) return `${Math.round(distanceMeters)} m`;
  return `${(distanceMeters / 1000).toFixed(1)} km`;
}

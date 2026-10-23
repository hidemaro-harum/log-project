"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { LocateFixed } from "lucide-react";
import { Input } from "@/components/ui/input";
import { getBrowserClient } from "@/lib/browser-client";
import type { PlaceSuggestion } from "@/lib/place-suggestions";
import { PlaceSuggestionPanel, type PlaceLookupState } from "./place-suggestion-panel";

type Coordinates = { latitude: number; longitude: number };
type CachedLocation = { coordinates: Coordinates; expiresAt: number };

class LocationUnavailableError extends Error {}

// Permission failures remain quiet until the user explicitly retries. Sharing
// the pending request also avoids repeated permission prompts while typing.
let cachedLocation: CachedLocation | null = null;
let pendingLocation: Promise<Coordinates> | null = null;
let locationFailure: LocationUnavailableError | null = null;

function getCurrentLocation(retry: boolean): Promise<Coordinates> {
  if (pendingLocation) return pendingLocation;
  if (!retry && cachedLocation && cachedLocation.expiresAt > Date.now()) {
    return Promise.resolve(cachedLocation.coordinates);
  }
  if (!retry && locationFailure) return Promise.reject(locationFailure);
  if (retry) {
    cachedLocation = null;
    locationFailure = null;
  }
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    locationFailure = new LocationUnavailableError("このブラウザでは現在地を取得できません。手入力で保存できます。");
    return Promise.reject(locationFailure);
  }

  pendingLocation = new Promise<Coordinates>((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => resolve({ latitude: coords.latitude, longitude: coords.longitude }),
      (error) => {
        const message = error.code === 1
          ? "現在地へのアクセスが許可されていません。位置情報を許可してから再検索するか、手入力で保存できます。"
          : error.code === 3
            ? "現在地の取得に時間がかかっています。再検索するか、手入力で保存できます。"
            : "現在地を取得できませんでした。再検索するか、手入力で保存できます。";
        reject(new LocationUnavailableError(message));
      },
      { enableHighAccuracy: false, timeout: 8_000, maximumAge: 60_000 },
    );
  }).then((coordinates) => {
    cachedLocation = { coordinates, expiresAt: Date.now() + 60_000 };
    locationFailure = null;
    return coordinates;
  }).catch((error: unknown) => {
    locationFailure = error instanceof LocationUnavailableError
      ? error
      : new LocationUnavailableError("現在地を取得できませんでした。再検索するか、手入力で保存できます。");
    throw locationFailure;
  }).finally(() => {
    pendingLocation = null;
  });

  return pendingLocation;
}

const idleLookup: PlaceLookupState = { status: "idle", message: "", suggestions: [] };

export type RestaurantNameSearchProps = {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  onSelect: (suggestion: PlaceSuggestion) => void;
  disabled?: boolean;
  resetKey?: number;
};

export function RestaurantNameSearch({
  id,
  value,
  onChange,
  onSelect,
  disabled = false,
  resetKey,
}: RestaurantNameSearchProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const [lookup, setLookup] = useState<PlaceLookupState>(idleLookup);
  const mountedRef = useRef(false);
  const composingRef = useRef(false);
  const compositionEndedAtRef = useRef(0);
  const typedValueRef = useRef<string | null>(null);
  const requestIdRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const currentPropsRef = useRef({ value, disabled, resetKey });
  currentPropsRef.current = { value, disabled, resetKey };

  const cancelSearch = useCallback(() => {
    requestIdRef.current += 1;
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = null;
    controllerRef.current?.abort();
    controllerRef.current = null;
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      cancelSearch();
    };
  }, [cancelSearch]);

  useEffect(() => {
    // A photo candidate, a changed address, or another parent action can reset
    // this search even when it happens to keep the same restaurant name.
    cancelSearch();
    typedValueRef.current = null;
    setLookup(idleLookup);
  }, [cancelSearch, resetKey]);

  useEffect(() => {
    if (disabled || (typedValueRef.current !== null && value !== typedValueRef.current)) {
      cancelSearch();
      typedValueRef.current = null;
      setLookup(idleLookup);
    }
  }, [cancelSearch, disabled, value]);

  function scheduleSearch(rawValue: string, retryLocation = false) {
    cancelSearch();
    setLookup(idleLookup);
    typedValueRef.current = rawValue;
    const query = rawValue.trim();
    if (disabled || composingRef.current || query.length < 2) return;

    const requestId = requestIdRef.current;
    const requestedResetKey = resetKey;
    const controller = new AbortController();
    controllerRef.current = controller;
    const isCurrent = () => mountedRef.current
      && requestIdRef.current === requestId
      && !controller.signal.aborted
      && !composingRef.current
      && !currentPropsRef.current.disabled
      && currentPropsRef.current.value === rawValue
      && currentPropsRef.current.resetKey === requestedResetKey;

    async function search() {
      if (!isCurrent()) return;
      setLookup({ status: "loading", message: "現在地を確認しています…", suggestions: [] });
      try {
        const client = getBrowserClient();
        if (!client) {
          setLookup({ status: "unavailable", message: "店舗候補の検索を利用できません。手入力で保存できます。", suggestions: [] });
          return;
        }
        const { data, error } = await client.auth.getSession();
        if (!isCurrent()) return;
        if (error || !data.session?.access_token) {
          setLookup({ status: "unavailable", message: "店舗候補の検索には再ログインが必要です。店名はそのまま入力できます。", suggestions: [] });
          return;
        }

        const coordinates = await getCurrentLocation(retryLocation);
        if (!isCurrent()) return;
        setLookup({ status: "loading", message: "現在地の近くから飲食店を探しています…", suggestions: [] });
        const params = new URLSearchParams({
          query,
          lat: String(coordinates.latitude),
          lng: String(coordinates.longitude),
        });
        const response = await fetch(`/api/places/search?${params}`, {
          headers: { Authorization: `Bearer ${data.session.access_token}` },
          signal: controller.signal,
        });
        if (!isCurrent()) return;
        const payload = await response.json() as { suggestions?: PlaceSuggestion[] };
        if (!isCurrent()) return;
        if (!response.ok) {
          setLookup({ status: "error", message: "候補を取得できませんでした。再検索するか、手入力で保存できます。", suggestions: [] });
          return;
        }
        const suggestions = Array.isArray(payload.suggestions) ? payload.suggestions : [];
        setLookup({
          status: suggestions.length ? "ready" : "empty",
          message: suggestions.length
            ? "お店を選ぶと、店名・住所・ジャンルを入力できます。"
            : "現在地の近くに一致する飲食店が見つかりませんでした。手入力で保存できます。",
          suggestions,
        });
      } catch (error) {
        if (!isCurrent()) return;
        setLookup({
          status: error instanceof LocationUnavailableError ? "unavailable" : "error",
          message: error instanceof LocationUnavailableError
            ? error.message
            : "候補を取得できませんでした。再検索するか、手入力で保存できます。",
          suggestions: [],
        });
      }
    }

    // Only this user-event path schedules work; incoming controlled values
    // never start searches, including initial edit values and photo autofill.
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      void search();
    }, retryLocation ? 0 : 600);
  }

  function selectSuggestion(suggestion: PlaceSuggestion) {
    if (disabled) return;
    cancelSearch();
    typedValueRef.current = null;
    setLookup(idleLookup);
    onSelect(suggestion);
  }

  return (
    <div className="min-w-0 space-y-2">
      <Input
        aria-describedby={`${inputId}-hint`}
        autoComplete="off"
        className="h-11 rounded-xl border-stone-200/60 bg-stone-50/50"
        disabled={disabled}
        id={inputId}
        placeholder="店名を入力"
        required
        value={value}
        onChange={(event) => {
          const nextValue = event.currentTarget.value;
          onChange(nextValue);
          scheduleSearch(nextValue);
        }}
        onCompositionStart={() => {
          composingRef.current = true;
          cancelSearch();
          setLookup(idleLookup);
        }}
        onCompositionEnd={(event) => {
          composingRef.current = false;
          compositionEndedAtRef.current = Date.now();
          const nextValue = event.currentTarget.value;
          onChange(nextValue);
          scheduleSearch(nextValue);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (composingRef.current || event.nativeEvent.isComposing || event.keyCode === 229 || Date.now() - compositionEndedAtRef.current < 100)) {
            event.preventDefault();
            event.stopPropagation();
          }
        }}
      />
      <p className="text-xs leading-relaxed text-stone-500" id={`${inputId}-hint`}>
        2文字以上で現在地の近く（約3km）の飲食店を探します。手入力でも保存できます。
      </p>
      <button
        className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-xs font-semibold text-primary underline-offset-4 hover:bg-primary/5 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-40"
        disabled={disabled || value.trim().length < 2 || lookup.status === "loading"}
        type="button"
        onClick={() => scheduleSearch(value, true)}
      >
        <LocateFixed aria-hidden="true" className="size-4" />
        現在地で再検索
      </button>
      {lookup.status !== "idle" && (
        <PlaceSuggestionPanel disabled={disabled} lookup={lookup} onSelect={selectSuggestion} />
      )}
    </div>
  );
}

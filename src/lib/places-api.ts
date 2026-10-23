import { createClient } from "@supabase/supabase-js";

export async function authenticatePlaceRequest(request: Request) {
  const token = request.headers.get("authorization")?.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (!token) return { error: Response.json({ error: "ログインが必要です。" }, { status: 401 }) };

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    return { error: Response.json({ error: "認証サービスが設定されていません。" }, { status: 503 }) };
  }

  try {
    const client = createClient(url, key, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const { data, error } = await client.auth.getUser(token);
    if (error && (!error.status || error.status >= 500)) {
      return { error: Response.json({ error: "ログイン情報を確認できませんでした。" }, { status: 503 }) };
    }
    if (error || !data.user) {
      return { error: Response.json({ error: "ログインが必要です。" }, { status: 401 }) };
    }
    return { client, userId: data.user.id };
  } catch {
    return { error: Response.json({ error: "ログイン情報を確認できませんでした。" }, { status: 503 }) };
  }
}

// This is an instance-local burst limit. A shared store is needed for a global quota.
export function createPlaceRateLimiter(limit: number, windowMs: number, now = Date.now) {
  const windows = new Map<string, { count: number; resetAt: number }>();
  let nextCleanup = 0;
  return (userId: string) => {
    const timestamp = now();
    if (timestamp >= nextCleanup) {
      for (const [id, window] of windows) {
        if (window.resetAt <= timestamp) windows.delete(id);
      }
      nextCleanup = timestamp + windowMs;
    }
    const current = windows.get(userId);
    if (!current || current.resetAt <= timestamp) {
      windows.set(userId, { count: 1, resetAt: timestamp + windowMs });
      return null;
    }
    if (current.count >= limit) {
      return Response.json({ error: "処理回数が多いため、少し待ってから再度お試しください。" }, {
        status: 429,
        headers: { "Retry-After": String(Math.ceil((current.resetAt - timestamp) / 1_000)) },
      });
    }
    current.count += 1;
    return null;
  };
}

export function parseCoordinate(value: string | null, min: number, max: number) {
  if (value === null || !value.trim()) return null;
  const coordinate = Number(value);
  return Number.isFinite(coordinate) && coordinate >= min && coordinate <= max ? coordinate : null;
}

export function parseRadiusMeters(value: string | null) {
  if (value === null || !value.trim()) return undefined;
  const radius = Number(value);
  return Number.isFinite(radius) ? Math.min(Math.max(radius, 50), 500) : undefined;
}

export function parseRestaurantRequest(body: unknown) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const { restaurantId, applyBest } = body as Record<string, unknown>;
  if (typeof restaurantId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(restaurantId)) return null;
  if (applyBest !== undefined && typeof applyBest !== "boolean") return null;
  return { restaurantId, applyBest: applyBest === true };
}

export async function fetchPlaceJson<T extends object>(
  placeRequest: { url: string; init: RequestInit },
  label: string,
): Promise<{ data: T; error?: never } | { error: Response; data?: never }> {
  try {
    const response = await fetch(placeRequest.url, {
      ...placeRequest.init,
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) throw new Error("Place lookup failed");
    const data: unknown = await response.json();
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Invalid Places response");
    return { data: data as T };
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    return { error: Response.json({ error: `${label}${timedOut ? "がタイムアウトしました。" : "に失敗しました。"}` }, { status: timedOut ? 504 : 502 }) };
  }
}

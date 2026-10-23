"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import {
  ArrowLeft,
  ArrowRight,
  BookHeart,
  CalendarDays,
  Camera,
  FolderOpen,
  GripVertical,
  Heart,
  Home as HomeIcon,
  Image as ImageIcon,
  ImagePlus,
  KeyRound,
  Map as MapIcon,
  MapPin,
  Plus,
  RefreshCw,
  Settings,
  Star,
  Sparkles,
  Trash2,
  Utensils,
  Upload,
  UserRound,
} from "lucide-react";
import { getBrowserClient } from "@/lib/browser-client";
import { sortPhotos, getNextPhotoSortOrder } from "@/lib/photo-order";
import { clearPhotoUrlCache } from "@/lib/photo-urls";
import { PhotoTile } from "@/components/bitelog/photo-tile";
import { PhotoPreview } from "@/components/bitelog/photo-preview";
import { PhotoAddDialog } from "@/components/bitelog/photo-add-dialog";
import { PhotoPicker, createPhotoDrafts, type PhotoDraft } from "@/components/bitelog/photo-picker";
import { RestaurantNameSearch } from "@/components/bitelog/restaurant-name-search";
import { PlaceSuggestionPanel, type PlaceLookupState } from "@/components/bitelog/place-suggestion-panel";
import { getRestaurantPlaceSelection } from "@/lib/restaurant-place-selection";
import { BrandMark, IconButton } from "@/components/bitelog/brand";
import { AuthScreen } from "@/components/bitelog/auth-screen";
import { AppHeader } from "@/components/bitelog/app-header";
import { Dashboard } from "@/components/bitelog/dashboard";
import { RestaurantCard, ListControls, EmptyState } from "@/components/bitelog/restaurant-list";
import { Field, FormShell, MessageBanner, Stars, StarPicker, type Message } from "@/components/bitelog/form-primitives";
import { formatLongDate, getLocalDateInputValue } from "@/lib/display-format";
import { filterRestaurants } from "@/lib/restaurant-search";
import { getFriendlyAuthError, getPasswordValidation, getRedirectUrl } from "@/lib/auth";
import { getPhotoCoordinates, getPhotoTakenDate } from "@/lib/photo-location";
import { sanitizeStorageFileName } from "@/lib/photo-upload";
import { addRestaurantPhotos } from "@/lib/restaurant-photo-add";
import { createPhotoUploadDependencies } from "@/lib/browser-photo-upload";
import { createFormSaveSession } from "@/lib/form-save-session";
import {
  PHOTO_CACHE_CONTROL_SECONDS,
  optimizePhotoFile,
} from "@/lib/photo-optimization";
import { deleteRestaurantWithAssets } from "@/lib/restaurant-delete";
import {
  findDuplicateRestaurantCandidates,
  findRegistrationMatch,
  getDuplicateRestaurantCleanupPlan,
  type DuplicateRestaurantCandidate,
} from "@/lib/restaurant-dedupe";
import { sortRestaurants, type SortMode } from "@/lib/restaurant-sort";
import {
  getMogurecoImageImportSummary,
  parseMogurecoCsv,
  type MogurecoImageImportSummary,
  type MogurecoImportRecord,
} from "@/lib/mogureco-import";
import type { PlaceSuggestion } from "@/lib/place-suggestions";
import {
  getPrefectureCounts,
  getRestaurantPrefectureCode,
  PREFECTURE_BY_CODE,
} from "@/lib/japan-prefectures";
import type { Photo, Restaurant, RestaurantStatus, Visit } from "@/types/database";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const InteractiveFoodMap = dynamic(() => import("@/components/interactive-food-map"), {
  ssr: false,
  loading: () => <div className="grid h-[480px] place-items-center bg-stone-100 text-xs font-semibold text-stone-400 sm:h-[590px]">地図を読み込んでいます…</div>,
});

type View = "list" | "map" | "quick" | "new" | "edit" | "detail" | "visit" | "account" | "import";
type AuthMode = "login" | "setup";
type BiteLogHistoryState = {
  bitelog: true;
  depth: number;
  view: View;
  selectedId: string | null;
  status: "all" | RestaurantStatus;
};


const supabase = getBrowserClient();
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://log-project-psi.vercel.app";

function getSupabase() {
  if (!supabase) {
    throw new Error("Supabase is not configured.");
  }

  return supabase;
}

async function optimizeUploadFiles(files: File[]) {
  const optimized: File[] = [];
  for (const file of files) {
    optimized.push((await optimizePhotoFile(file, { force: true })).file);
  }
  return optimized;
}

export default function Home() {
  const [userId, setUserId] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string>("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [authMode, setAuthMode] = useState<AuthMode>("login");
  const [isPasswordRecovery, setIsPasswordRecovery] = useState(false);
  const [loading, setLoading] = useState(true);
  const [authBusy, setAuthBusy] = useState(false);
  const [cleanupBusy, setCleanupBusy] = useState(false);
  const [genreBusy, setGenreBusy] = useState(false);
  const [genreProgress, setGenreProgress] = useState({ done: 0, total: 0, updated: 0 });
  const [mergeBusy, setMergeBusy] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);
  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"all" | RestaurantStatus>("all");
  const [sortMode, setSortMode] = useState<SortMode>("newest");
  const [view, setView] = useState<View>("list");
  const [selected, setSelected] = useState<Restaurant | null>(null);
  const currentScreenRef = useRef<{ view: View; selectedId: string | null }>({ view, selectedId: selected?.id ?? null });
  const restaurantsRef = useRef<Restaurant[]>([]);
  const activeUserIdRef = useRef<string | null>(null);
  const loadRequestRef = useRef(0);
  const [dataState, setDataState] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    restaurantsRef.current = restaurants;
  }, [restaurants]);

  useEffect(() => {
    currentScreenRef.current = { view, selectedId: selected?.id ?? null };
  }, [view, selected?.id]);

  useEffect(() => {
    window.history.replaceState(
      { bitelog: true, depth: 0, view: "list", selectedId: null, status: "all" } satisfies BiteLogHistoryState,
      "",
    );

    const handlePopState = (event: PopStateEvent) => {
      const state = event.state as BiteLogHistoryState | null;
      if (!state?.bitelog) return;
      const restaurant = state.selectedId ? restaurantsRef.current.find((item) => item.id === state.selectedId) ?? null : null;
      const needsRestaurant = ["detail", "edit", "visit"].includes(state.view);
      setView(needsRestaurant && !restaurant ? "list" : state.view);
      setStatus(state.status);
      setSelected(restaurant);
      window.scrollTo({ top: 0, behavior: "auto" });
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  useEffect(() => {
    if (!supabase) return;

    const params = new URLSearchParams(window.location.hash.slice(1));
    const authError = params.get("error_description");
    const recoveryType = params.get("type");
    if (authError) {
      setMessage({ text: authError, type: "error" });
    }
    if (recoveryType === "recovery") {
      setIsPasswordRecovery(true);
      setView("account");
    }

    let active = true;
    function applySession(user: { id: string; email?: string } | undefined) {
      if (!active) return;
      const nextId = user?.id ?? null;
      if (activeUserIdRef.current !== nextId) {
        const previousId = activeUserIdRef.current;
        activeUserIdRef.current = nextId;
        loadRequestRef.current += 1;
        restaurantsRef.current = [];
        clearPhotoUrlCache();
        setRestaurants([]);
        setSelected(null);
        setQuery("");
        setStatus("all");
        setDataState("loading");
        if (previousId || !nextId) {
          setView("list");
          window.history.replaceState({ bitelog: true, depth: 0, view: "list", selectedId: null, status: "all" } satisfies BiteLogHistoryState, "");
          setIsPasswordRecovery(false);
          setNewPassword("");
        }
      }
      setUserId(nextId);
      setUserEmail(user?.email ?? "");
      setLoading(false);
    }

    supabase.auth.getSession().then(({ data, error }) => {
      if (!active) return;
      if (error) setMessage({ text: getFriendlyAuthError(error.message), type: "error" });
      applySession(data.session?.user);
    }).catch(() => {
      if (!active) return;
      setMessage({ text: "ログイン情報を取得できませんでした。通信を確認して再読み込みしてください。", type: "error" });
      setLoading(false);
    });

    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      applySession(session?.user);
      if (active && event === "PASSWORD_RECOVERY") {
        setIsPasswordRecovery(true);
        setView("account");
        setMessage({ text: "新しいパスワードを設定してください。", type: "success" });
      }
    });

    return () => { active = false; data.subscription.unsubscribe(); };
  }, []);

  const loadRestaurants = useCallback(async () => {
    const ownerId = activeUserIdRef.current;
    if (!ownerId) return null;
    const requestId = ++loadRequestRef.current;
    const isCurrent = () => requestId === loadRequestRef.current && ownerId === activeUserIdRef.current;
    setDataState("loading");
    try {
      const { data, error } = await getSupabase()
        .from("restaurants")
        .select("*, tags(*), visits(*), photos(*)")
        .eq("user_id", ownerId)
        .order("updated_at", { ascending: false });
      if (!isCurrent()) return null;
      if (error) throw error;
      const next = ((data ?? []) as Restaurant[]).map((restaurant) => ({
        ...restaurant,
        photos: sortPhotos(restaurant.photos),
      }));
      restaurantsRef.current = next;
      setRestaurants(next);
      setDataState("ready");
      return next;
    } catch {
      if (!isCurrent()) return null;
      setDataState("error");
      return restaurantsRef.current;
    }
  }, []);

  useEffect(() => {
    if (userId) void loadRestaurants();
    return () => { loadRequestRef.current += 1; };
  }, [loadRestaurants, userId]);

  const stats = useMemo(() => {
    const visited = restaurants.filter((restaurant) => restaurant.status === "visited").length;
    const wishlist = restaurants.filter((restaurant) => restaurant.status === "wishlist").length;
    const photos = restaurants.reduce((sum, restaurant) => sum + (restaurant.photos?.length ?? 0), 0);
    return { total: restaurants.length, visited, wishlist, photos };
  }, [restaurants]);

  const duplicateCandidates = useMemo(() => view === "account" ? findDuplicateRestaurantCandidates(restaurants) : [], [restaurants, view]);

  const filtered = useMemo(() => sortRestaurants(filterRestaurants(restaurants, query, status), sortMode), [restaurants, query, status, sortMode]);

  function navigate(
    nextView: View,
    options: { restaurant?: Restaurant | null; nextStatus?: "all" | RestaurantStatus; replace?: boolean } = {},
  ) {
    const nextStatus = options.nextStatus ?? status;
    const keepsRestaurant = nextView === "detail" || nextView === "edit" || nextView === "visit";
    const nextSelected = keepsRestaurant ? options.restaurant ?? selected : null;
    const current = window.history.state as BiteLogHistoryState | null;
    const nextState: BiteLogHistoryState = {
      bitelog: true,
      depth: options.replace ? current?.depth ?? 0 : (current?.depth ?? 0) + 1,
      view: nextView,
      selectedId: nextSelected?.id ?? null,
      status: nextStatus,
    };

    if (options.replace) window.history.replaceState(nextState, "");
    else window.history.pushState(nextState, "");
    setStatus(nextStatus);
    setSelected(nextSelected);
    setView(nextView);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function goBack(fallbackView: View = "list") {
    const current = window.history.state as BiteLogHistoryState | null;
    if (current?.bitelog && current.depth > 0) {
      window.history.back();
      return;
    }
    navigate(fallbackView, { restaurant: selected, replace: true });
  }

  function returnToHome(nextStatus: "all" | RestaurantStatus = "all") {
    navigate("list", { nextStatus });
  }

  function changeListStatus(nextStatus: "all" | RestaurantStatus) {
    setStatus(nextStatus);
    const current = window.history.state as BiteLogHistoryState | null;
    if (current?.bitelog) {
      window.history.replaceState({ ...current, status: nextStatus }, "");
    }
  }

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || !email || !password) return;

    setAuthBusy(true);
    setMessage(null);
    const { data, error } = await getSupabase().auth.signInWithPassword({ email: email.trim(), password });
    setAuthBusy(false);

    if (error) {
      setMessage({ text: getFriendlyAuthError(error.message), type: "error" });
      return;
    }

    setPassword("");
    setUserId(data.user?.id ?? null);
    setUserEmail(data.user?.email ?? "");
    setMessage({ text: "ログインしました。", type: "success" });
  }

  async function sendPasswordSetup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || !email) return;

    setAuthBusy(true);
    setMessage(null);
    const { error } = await getSupabase().auth.resetPasswordForEmail(email.trim(), {
      redirectTo: getRedirectUrl(siteUrl),
    });
    setAuthBusy(false);

    if (error) {
      setMessage({ text: getFriendlyAuthError(error.message), type: "error" });
      return;
    }

    setMessage({ text: "パスワード設定用のメールを送信しました。", type: "success" });
  }

  async function updatePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const validation = getPasswordValidation(newPassword);
    if (!validation.valid) {
      setMessage({ text: validation.message, type: "error" });
      return;
    }

    setAuthBusy(true);
    setMessage(null);
    const { error } = await getSupabase().auth.updateUser({ password: newPassword });
    setAuthBusy(false);

    if (error) {
      setMessage({ text: getFriendlyAuthError(error.message), type: "error" });
      return;
    }

    setNewPassword("");
    setIsPasswordRecovery(false);
    setMessage({ text: "パスワードを更新しました。", type: "success" });
    navigate("list", { replace: true, nextStatus: "all" });
  }

  async function signOut() {
    const { error } = await getSupabase().auth.signOut();
    if (error) {
      setMessage({ text: getFriendlyAuthError(error.message), type: "error" });
      return;
    }
    clearPhotoUrlCache();
    setUserId(null);
    setUserEmail("");
    navigate("list", { replace: true, nextStatus: "all" });
    setMessage(null);
  }

  async function cleanupDuplicateRestaurants() {
    const client = getSupabase();
    const { data: user } = await client.auth.getUser();
    const currentUserId = user.user?.id;
    if (!currentUserId) return;

    const plans = getDuplicateRestaurantCleanupPlan(restaurants);
    const deleteCount = plans.reduce((sum, plan) => sum + plan.deleteIds.length, 0);
    if (!deleteCount) {
      setMessage({ text: "写真なしの重複店舗は見つかりませんでした。", type: "neutral" });
      return;
    }

    setCleanupBusy(true);
    setMessage(null);

    for (const plan of plans) {
      const { error: visitError } = await client
        .from("visits")
        .update({ restaurant_id: plan.keeperId })
        .in("restaurant_id", plan.deleteIds);
      if (visitError) {
        setCleanupBusy(false);
        setMessage({ text: visitError.message, type: "error" });
        return;
      }

      const { data: tagRows, error: tagLoadError } = await client
        .from("restaurant_tags")
        .select("tag_id")
        .in("restaurant_id", plan.deleteIds);
      if (tagLoadError) {
        setCleanupBusy(false);
        setMessage({ text: tagLoadError.message, type: "error" });
        return;
      }

      const tagIds = [...new Set((tagRows ?? []).map((row) => row.tag_id).filter(Boolean))];
      if (tagIds.length) {
        const { error: tagUpsertError } = await client
          .from("restaurant_tags")
          .upsert(
            tagIds.map((tagId) => ({ restaurant_id: plan.keeperId, tag_id: tagId, user_id: currentUserId })),
            { onConflict: "restaurant_id,tag_id" },
          );
        if (tagUpsertError) {
          setCleanupBusy(false);
          setMessage({ text: tagUpsertError.message, type: "error" });
          return;
        }
      }

      const { error: deleteError } = await client
        .from("restaurants")
        .delete()
        .in("id", plan.deleteIds);
      if (deleteError) {
        setCleanupBusy(false);
        setMessage({ text: deleteError.message, type: "error" });
        return;
      }
    }

    setCleanupBusy(false);
    setMessage({ text: `${deleteCount}件の写真なし重複店舗を削除しました。`, type: "success" });
    await loadRestaurants();
  }

  async function enrichMissingGenres() {
    const targets = restaurants.filter((restaurant) => !restaurant.genre?.trim());
    if (!targets.length) {
      setMessage({ text: "ジャンル未設定の店舗はありません。", type: "neutral" });
      return;
    }
    const { data: session } = await getSupabase().auth.getSession();
    const accessToken = session.session?.access_token;
    if (!accessToken) {
      setMessage({ text: "ログイン情報を確認できませんでした。", type: "error" });
      return;
    }

    setGenreBusy(true);
    setGenreProgress({ done: 0, total: targets.length, updated: 0 });
    let updated = 0;
    for (let index = 0; index < targets.length; index += 5) {
      const batch = targets.slice(index, index + 5);
      const results = await Promise.all(batch.map(async (restaurant) => {
        for (let attempt = 0; attempt < 3; attempt += 1) {
          try {
            const response = await fetch("/api/places/enrich-genre", {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
              body: JSON.stringify({ restaurantId: restaurant.id }),
            });
            if (response.ok) return ((await response.json()) as { applied?: boolean }).applied === true;
            if (response.status < 500 && response.status !== 429) return false;
          } catch {
            // Retry transient failures below.
          }
          await new Promise((resolve) => window.setTimeout(resolve, 450 * (attempt + 1)));
        }
        return false;
      }));
      updated += results.filter(Boolean).length;
      setGenreProgress({ done: Math.min(index + batch.length, targets.length), total: targets.length, updated });
    }
    setGenreBusy(false);
    const unresolved = targets.length - updated;
    setMessage({
      text: `${updated}件のジャンルを補完しました。${unresolved ? `${unresolved}件は判定できませんでした。` : "すべて反映できました。"}`,
      type: updated ? "success" : "neutral",
    });
    await loadRestaurants();
  }

  async function mergeDuplicateCandidate(candidate: DuplicateRestaurantCandidate) {
    const keeper = restaurants.find((restaurant) => restaurant.id === candidate.keeper.id);
    const duplicate = restaurants.find((restaurant) => restaurant.id === candidate.duplicate.id);
    if (!keeper || !duplicate) return;
    if (!window.confirm(`「${duplicate.name}」を「${keeper.name}」へ統合します。写真・訪問履歴・タグは保持されます。よろしいですか？`)) return;

    setMergeBusy(true);
    const { error } = await getSupabase().rpc("merge_own_restaurants", {
      p_keeper_id: keeper.id,
      p_duplicate_id: duplicate.id,
    });
    setMergeBusy(false);
    if (error) {
      setMessage({ text: error.message, type: "error" });
      return;
    }
    setMessage({ text: `${duplicate.name}を統合しました。写真と訪問履歴は${keeper.name}にまとまりました。`, type: "success" });
    await loadRestaurants();
  }

  async function deleteRestaurant(restaurant: Restaurant) {
    setDeleteBusy(true);
    setMessage(null);

    try {
      await deleteRestaurantWithAssets(getSupabase(), restaurant);
      navigate("list", { replace: true });
      setMessage({ text: `${restaurant.name}を削除しました。`, type: "success" });
      await loadRestaurants();
    } catch (error) {
      setMessage({ text: error instanceof Error ? error.message : "店舗を削除できませんでした。", type: "error" });
    } finally {
      setDeleteBusy(false);
    }
  }

  async function refreshApp() {
    const next = await loadRestaurants();
    if (!next) return;
    setSelected((current) => current ? next.find((restaurant) => restaurant.id === current.id) ?? current : null);
  }

  function isCurrentScreen(expectedView: View, restaurantId: string | null = null) {
    // Next.js also owns history.state; use the rendered screen for async save guards.
    const current = currentScreenRef.current;
    return activeUserIdRef.current === userId && current.view === expectedView && current.selectedId === restaurantId;
  }

  if (!supabase) {
    return (
      <Shell>
        <Card className="space-y-3">
          <div className="flex items-center gap-3">
            <BrandMark className="size-10 rounded-xl" />
            <h1 className="text-2xl font-bold">BiteLog</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            Supabase の公開環境変数が未設定です。Vercel に NEXT_PUBLIC_SUPABASE_URL と NEXT_PUBLIC_SUPABASE_ANON_KEY を設定してください。
          </p>
        </Card>
      </Shell>
    );
  }

  if (loading) {
    return (
      <Shell>
        <div className="grid min-h-[60vh] place-items-center">
          <div className="flex flex-col items-center gap-3 animate-in">
            <div className="size-10 rounded-full border-2 border-primary/20 border-t-primary animate-spin" />
            <span className="text-sm text-muted-foreground font-light tracking-wide">読み込み中...</span>
          </div>
        </div>
      </Shell>
    );
  }

  if (!userId) {
    return (
      <AuthScreen
        authBusy={authBusy}
        authMode={authMode}
        email={email}
        message={message}
        password={password}
        onEmailChange={setEmail}
        onLogin={login}
        onModeChange={setAuthMode}
        onPasswordChange={setPassword}
        onSetup={sendPasswordSetup}
      />
    );
  }

  return (
    <Shell onRefresh={refreshApp}>
      <AppHeader
        email={userEmail}
        query={query}
        onAdd={() => navigate("quick")}
        onAccount={() => navigate("account")}
        onImport={() => navigate("import")}
        onHome={() => returnToHome("all")}
        onQueryChange={(value) => {
          setQuery(value);
          if (view !== "list") navigate("list");
        }}
        onSignOut={signOut}
      />

      {message && <div className="mx-auto max-w-6xl animate-in"><MessageBanner message={message} /></div>}

      {view === "list" && (
        <div className="animate-fade">
          {(restaurants.length > 0 || dataState === "ready") && <Dashboard restaurants={restaurants} stats={stats} onAdd={() => navigate("quick")} onOpen={(restaurant) => navigate("detail", { restaurant })} onOpenMap={() => navigate("map")} />}
          <ListControls
            count={filtered.length}
            query={query}
            onQueryChange={setQuery}
            sortMode={sortMode}
            status={status}
            onSortModeChange={setSortMode}
            onStatusChange={changeListStatus}
          />
          {dataState === "error" && <div className="mx-auto mt-5 flex max-w-6xl flex-wrap items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 p-4"><p role="alert" className="text-sm text-red-800">記録を読み込めませんでした。通信を確認して再読み込みしてください。</p><Button variant="outline" onClick={() => void loadRestaurants()}><RefreshCw className="size-4" />再読み込み</Button></div>}
          {dataState === "loading" && <p role="status" className="mx-auto mt-5 max-w-6xl text-sm text-stone-600">記録を読み込んでいます…</p>}
          <section aria-busy={dataState === "loading"} aria-label="お店の一覧" className="mx-auto mt-5 max-w-6xl grid grid-cols-2 gap-3 lg:grid-cols-3">
            {filtered.map((restaurant, i) => (
              <RestaurantCard
                key={restaurant.id}
                restaurant={restaurant}
                index={i}
                onClick={() => {
                  navigate("detail", { restaurant });
                }}
              />
            ))}
          </section>
          {dataState === "ready" && !filtered.length && <EmptyState hasRecords={restaurants.length > 0} filtered={Boolean(query.trim()) || status !== "all"} onAdd={() => navigate("new")} onReset={() => { setQuery(""); changeListStatus("all"); }} />}
        </div>
      )}

      {view === "map" && (
        <div className="animate-in">
          <FoodMap
            restaurants={restaurants}
            onBack={() => goBack("list")}
            onOpen={(restaurant) => navigate("detail", { restaurant })}
            onLocationsUpdated={() => void loadRestaurants()}
          />
        </div>
      )}

      {view === "quick" && (
        <div className="animate-in">
          <RestaurantForm
            quick
            restaurants={restaurants}
            onBack={() => goBack("list")}
            onSaved={(notice) => {
              if (activeUserIdRef.current !== userId) return;
              if (!isCurrentScreen("quick")) {
                void refreshApp();
                return;
              }
              navigate("list", { replace: true });
              if (notice) setMessage({ text: notice, type: "success" });
              void loadRestaurants();
            }}
          />
        </div>
      )}

      {view === "new" && (
        <div className="animate-in">
          <RestaurantForm
            restaurants={restaurants}
            onBack={() => goBack("list")}
            onSaved={(notice) => {
              if (activeUserIdRef.current !== userId) return;
              if (!isCurrentScreen("new")) {
                void refreshApp();
                return;
              }
              navigate("list", { replace: true });
              if (notice) setMessage({ text: notice, type: "success" });
              void loadRestaurants();
            }}
          />
        </div>
      )}

      {view === "edit" && selected && (
        <div className="animate-in">
          <RestaurantForm
            restaurant={selected}
            restaurants={restaurants}
            onBack={() => goBack("detail")}
            onSaved={() => {
              if (activeUserIdRef.current !== userId) return;
              if (!isCurrentScreen("edit", selected.id)) {
                void refreshApp();
                return;
              }
              navigate("detail", { restaurant: selected, replace: true });
              void loadRestaurants().then((next) => {
                if (!next) return;
                setSelected((current) => current?.id === selected.id ? next.find((restaurant) => restaurant.id === current.id) ?? current : current);
              });
            }}
          />
        </div>
      )}

      {view === "import" && (
        <div className="animate-in">
          <MogurecoImportPanel
            restaurants={restaurants}
            onBack={() => goBack("list")}
            onImported={() => void loadRestaurants()}
          />
        </div>
      )}

      {view === "detail" && selected && (
        <div className="animate-in">
          <RestaurantDetail
            deleteBusy={deleteBusy}
            restaurant={selected}
            onAddVisit={() => navigate("visit", { restaurant: selected })}
            onEdit={() => navigate("edit", { restaurant: selected })}
            onBack={() => goBack("list")}
            onDelete={() => void deleteRestaurant(selected)}
            onPhotosChanged={(photos) => {
              const updated = { ...selected, photos };
              setSelected(updated);
              setRestaurants((current) => current.map((restaurant) => restaurant.id === updated.id ? updated : restaurant));
            }}
          />
        </div>
      )}

      {view === "visit" && selected && (
        <div className="animate-in">
          <VisitForm
            restaurant={selected}
            onBack={() => goBack("detail")}
            onSaved={async () => {
              if (activeUserIdRef.current !== userId) return;
              if (!isCurrentScreen("visit", selected.id)) {
                void refreshApp();
                return;
              }
              const next = await loadRestaurants();
              if (!next || !isCurrentScreen("visit", selected.id)) return;
              const current = next.find((restaurant) => restaurant.id === selected.id);
              navigate("detail", { restaurant: current ?? selected, replace: true });
            }}
          />
        </div>
      )}

      {view === "account" && (
        <div className="animate-in">
          <AccountPanel
            authBusy={authBusy}
            cleanupBusy={cleanupBusy}
            duplicateCandidates={duplicateCandidates}
            email={userEmail}
            genreBusy={genreBusy}
            genreProgress={genreProgress}
            isPasswordRecovery={isPasswordRecovery}
            mergeBusy={mergeBusy}
            missingGenreCount={restaurants.filter((restaurant) => !restaurant.genre?.trim()).length}
            newPassword={newPassword}
            onBack={() => goBack("list")}
            onCleanupDuplicates={cleanupDuplicateRestaurants}
            onEnrichGenres={() => void enrichMissingGenres()}
            onMergeDuplicate={(candidate) => void mergeDuplicateCandidate(candidate)}
            onNewPasswordChange={setNewPassword}
            onSubmit={updatePassword}
          />
        </div>
      )}

      <MobileNavigation
        activeStatus={status}
        view={view}
        onHome={() => returnToHome("all")}
        onVisited={() => returnToHome("visited")}
        onWishlist={() => returnToHome("wishlist")}
        onAdd={() => navigate("quick")}
        onAccount={() => navigate("account")}
      />
    </Shell>
  );
}

/* ========================================
   Shell & Layout
   ======================================== */

function Shell({ children, onRefresh }: { children: React.ReactNode; onRefresh?: () => Promise<void> }) {
  const [pullDistance, setPullDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const touchStartYRef = useRef<number | null>(null);
  const canPullRef = useRef(false);
  const threshold = 76;

  function handleTouchStart(event: React.TouchEvent<HTMLElement>) {
    if (!onRefresh || refreshing || event.touches.length !== 1) return;
    const target = event.target as HTMLElement;
    if (target.closest(".leaflet-container, input, textarea, select, [data-no-pull-refresh]")) return;
    canPullRef.current = window.scrollY <= 0;
    touchStartYRef.current = canPullRef.current ? event.touches[0].clientY : null;
  }

  function handleTouchMove(event: React.TouchEvent<HTMLElement>) {
    if (!canPullRef.current || touchStartYRef.current === null || event.touches.length !== 1) return;
    const distance = event.touches[0].clientY - touchStartYRef.current;
    if (distance <= 0) {
      setPullDistance(0);
      return;
    }
    setPullDistance(Math.min(112, distance * 0.52));
  }

  async function handleTouchEnd() {
    const shouldRefresh = pullDistance >= threshold;
    touchStartYRef.current = null;
    canPullRef.current = false;
    if (!shouldRefresh || !onRefresh) {
      setPullDistance(0);
      return;
    }
    setRefreshing(true);
    setPullDistance(54);
    try {
      await onRefresh();
    } finally {
      setRefreshing(false);
      setPullDistance(0);
    }
  }

  return (
    <main className="min-h-screen px-4 pb-36 pt-4 text-foreground md:px-8 md:pb-10 md:pt-6" onTouchStart={handleTouchStart} onTouchMove={handleTouchMove} onTouchEnd={() => void handleTouchEnd()} onTouchCancel={() => { touchStartYRef.current = null; canPullRef.current = false; setPullDistance(0); }}>
      {onRefresh && <div aria-live="polite" className="pointer-events-none fixed inset-x-0 top-[calc(env(safe-area-inset-top)+0.5rem)] z-[70] flex justify-center transition-transform duration-200" style={{ opacity: pullDistance ? 1 : 0, transform: `translateY(${Math.max(-48, pullDistance - 54)}px)` }}><div className="flex items-center gap-2 rounded-full border border-white/80 bg-white/95 px-3.5 py-2 text-[10px] font-bold text-primary shadow-lg backdrop-blur"><RefreshCw className={`size-3.5 ${refreshing ? "animate-spin" : pullDistance >= threshold ? "rotate-180" : ""}`} />{refreshing ? "更新しています…" : pullDistance >= threshold ? "離して更新" : "下に引いて更新"}</div></div>}
      {children}
    </main>
  );
}

function MobileNavigation({
  activeStatus,
  view,
  onHome,
  onVisited,
  onWishlist,
  onAdd,
  onAccount,
}: {
  activeStatus: "all" | RestaurantStatus;
  view: View;
  onHome: () => void;
  onVisited: () => void;
  onWishlist: () => void;
  onAdd: () => void;
  onAccount: () => void;
}) {
  const itemClass = (active: boolean) => `flex min-h-16 min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-2xl text-[10px] font-semibold transition active:bg-stone-100 ${active ? "text-primary" : "text-stone-400"}`;
  return (
    <nav aria-label="メインナビゲーション" className="fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+14px)] z-50 rounded-[1.65rem] border border-white/80 bg-white/95 px-1.5 py-1 shadow-[0_16px_42px_-14px_rgba(20,45,34,0.38)] backdrop-blur-xl md:hidden">
      <div className="mx-auto flex max-w-lg items-center">
        <button aria-current={view === "list" && activeStatus === "all" ? "page" : undefined} className={itemClass(view === "list" && activeStatus === "all")} type="button" onClick={onHome}><HomeIcon className="size-5" /><span>ホーム</span></button>
        <button aria-current={view === "list" && activeStatus === "wishlist" ? "page" : undefined} className={itemClass(view === "list" && activeStatus === "wishlist")} type="button" onClick={onWishlist}><Heart className="size-5" /><span>行きたい</span></button>
        <button aria-label="食事を記録する" className="group -mt-6 flex w-[74px] shrink-0 flex-col items-center gap-1 text-[10px] font-bold text-primary" type="button" onClick={onAdd}>
          <span className="grid size-14 place-items-center rounded-full border-[5px] border-white bg-primary text-white shadow-lg shadow-primary/25 transition group-active:scale-95"><Plus className="size-6" /></span>
          <span>記録する</span>
        </button>
        <button aria-current={view === "list" && activeStatus === "visited" ? "page" : undefined} className={itemClass(view === "list" && activeStatus === "visited")} type="button" onClick={onVisited}><BookHeart className="size-5" /><span>行った</span></button>
        <button aria-current={view === "account" ? "page" : undefined} className={itemClass(view === "account")} type="button" onClick={onAccount}><UserRound className="size-5" /><span>自分</span></button>
      </div>
    </nav>
  );
}

/* Food map */

function FoodMap({
  restaurants,
  onBack,
  onOpen,
  onLocationsUpdated,
}: {
  restaurants: Restaurant[];
  onBack: () => void;
  onOpen: (restaurant: Restaurant) => void;
  onLocationsUpdated: () => void;
}) {
  const visited = useMemo(() => restaurants.filter((restaurant) => restaurant.status === "visited"), [restaurants]);
  const counts = useMemo(() => getPrefectureCounts(visited), [visited]);
  const [selectedCode, setSelectedCode] = useState<number | null>(null);
  const [resolving, setResolving] = useState(false);
  const [resolveMessage, setResolveMessage] = useState<string | null>(null);
  const [resolveProgress, setResolveProgress] = useState({ completed: 0, total: 0, updated: 0, unresolved: 0 });
  const selectedPrefecture = selectedCode ? PREFECTURE_BY_CODE.get(selectedCode) : null;
  const selectedRestaurants = useMemo(() => visited
    .filter((restaurant) => getRestaurantPrefectureCode(restaurant) === selectedCode)
    .sort((a, b) => (b.latest_visit_at ?? b.updated_at).localeCompare(a.latest_visit_at ?? a.updated_at)), [selectedCode, visited]);
  const exactLocationCount = visited.filter((restaurant) => restaurant.latitude != null && restaurant.longitude != null).length;
  const missingLocations = visited.filter((restaurant) => restaurant.latitude == null || restaurant.longitude == null);
  const topPrefecture = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];

  async function resolveMissing() {
    const targets = missingLocations;
    if (!targets.length) {
      setResolveMessage("位置を補完できる店舗はありません。");
      return;
    }
    setResolving(true);
    setResolveProgress({ completed: 0, total: targets.length, updated: 0, unresolved: 0 });
    setResolveMessage(`${targets.length}件すべての位置を確認しています。この画面を開いたままお待ちください。`);
    const { data: session } = await getSupabase().auth.getSession();
    const accessToken = session.session?.access_token;
    let updated = 0;
    let unresolved = 0;
    if (accessToken) {
      for (let index = 0; index < targets.length; index += 5) {
        const batch = targets.slice(index, index + 5);
        const results = await Promise.all(batch.map(async (restaurant) => {
          for (let attempt = 0; attempt < 3; attempt += 1) {
            try {
              const response = await fetch("/api/places/resolve", {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
                body: JSON.stringify({ restaurantId: restaurant.id, applyBest: true }),
              });
              if (response.ok) {
                const payload = await response.json() as { applied?: boolean };
                return payload.applied === true;
              }
              if (response.status < 500 && response.status !== 429) return false;
            } catch {
              // Retry transient network failures below.
            }
            await new Promise((resolve) => window.setTimeout(resolve, 450 * (attempt + 1)));
          }
          return false;
        }));
        updated += results.filter(Boolean).length;
        unresolved += results.filter((result) => !result).length;
        const completed = Math.min(index + batch.length, targets.length);
        setResolveProgress({ completed, total: targets.length, updated, unresolved });
        if (completed < targets.length) {
          setResolveMessage(`${completed} / ${targets.length}件を確認しました。見つかった位置を順次反映しています。`);
        }
      }
    } else {
      unresolved = targets.length;
    }
    setResolving(false);
    setResolveMessage(updated ? `${updated}件の位置を追加しました。${unresolved ? `${unresolved}件は位置を特定できなかったため、住所の確認が必要です。` : "すべての店舗を地図に反映しました。"}` : "位置候補を取得できませんでした。住所を詳しくすると見つけやすくなります。");
    if (updated) onLocationsUpdated();
  }

  return (
    <section className="mx-auto max-w-6xl">
      <div className="mb-5 flex items-center gap-3">
        <IconButton label="戻る" onClick={onBack}><ArrowLeft className="size-5" /></IconButton>
        <div><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary/55">Food journey</p><h1 className="text-xl font-extrabold tracking-tight text-stone-800">日本を食べ歩く</h1></div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.45fr_0.55fr]">
        <Card className="overflow-hidden rounded-[2rem] border-white/80 bg-[linear-gradient(155deg,#f9fbf7,#edf4ee)] p-3 shadow-[0_24px_55px_-40px_rgba(25,70,50,0.55)] sm:p-5">
          <div className="mb-4 flex items-end justify-between gap-4">
            <div><p className="text-3xl font-black tabular-nums text-primary">{counts.size}<span className="ml-1 text-sm font-bold text-stone-400">/ 47都道府県</span></p><p className="mt-1 text-xs text-stone-500">ピンチ・ダブルタップで市町村まで拡大できます。</p></div>
            <div className="rounded-2xl bg-white/80 px-3 py-2 text-right shadow-sm"><p className="text-[9px] font-bold text-stone-400">記録した店</p><p className="text-lg font-black text-stone-800">{visited.length}<span className="ml-1 text-[10px]">店</span></p></div>
          </div>
          <div className="relative overflow-hidden rounded-[1.45rem] border border-white bg-stone-100">
            <InteractiveFoodMap restaurants={visited} selectedRestaurants={selectedRestaurants} onOpen={onOpen} />
            <div className="pointer-events-none absolute bottom-7 left-2 z-[500] rounded-xl bg-white/90 px-2.5 py-1.5 text-[9px] font-semibold text-stone-600 shadow-sm backdrop-blur">＋ / −、ピンチ、ダブルタップで拡大</div>
          </div>
        </Card>

        <div className="space-y-3">
          <Card className="rounded-[1.5rem] border-white/80 bg-white/85 p-5">
            <div className="flex items-center gap-3"><span className="grid size-10 place-items-center rounded-2xl bg-primary/10 text-primary"><MapIcon className="size-5" /></span><div><p className="text-[10px] font-bold text-stone-400">もっとも歩いた場所</p><p className="font-extrabold text-stone-800">{topPrefecture ? `${PREFECTURE_BY_CODE.get(topPrefecture[0])?.name} · ${topPrefecture[1]}店` : "まだ記録がありません"}</p></div></div>
          </Card>
          <Card className="rounded-[1.5rem] border-white/80 bg-white/85 p-5">
            <div className="flex items-start gap-3"><span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-accent/10 text-accent"><Sparkles className="size-5" /></span><div><p className="font-bold text-stone-800">全店舗の位置を反映</p><p className="mt-1 text-[11px] leading-relaxed text-stone-500">位置取得済み {exactLocationCount}店。未取得の全店舗を一度に確認します。</p></div></div>
            {resolving && <div className="mt-4"><div className="h-2 overflow-hidden rounded-full bg-stone-100"><div className="h-full rounded-full bg-primary transition-[width] duration-300" style={{ width: `${resolveProgress.total ? (resolveProgress.completed / resolveProgress.total) * 100 : 0}%` }} /></div><p className="mt-1.5 text-right text-[10px] font-bold tabular-nums text-primary">{resolveProgress.completed} / {resolveProgress.total}件</p></div>}
            <Button className="mt-4 w-full rounded-xl" disabled={resolving || !missingLocations.length} variant="outline" onClick={() => void resolveMissing()}>{resolving ? "全店舗を確認中…" : `未取得${missingLocations.length}店をすべて反映`}</Button>
            {resolveMessage && <p className="mt-2 text-[10px] leading-relaxed text-stone-500">{resolveMessage}</p>}
          </Card>
        </div>
      </div>

      <section className="mt-5">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3"><div><p className="text-[10px] font-bold uppercase tracking-[0.15em] text-stone-400">Area filter</p><h2 className="text-lg font-extrabold text-stone-800">{selectedPrefecture?.name ?? "全国"}</h2></div><select aria-label="都道府県で絞り込む" className="h-9 rounded-xl border-0 bg-white px-3 text-xs font-bold text-stone-600 shadow-sm outline-none" value={selectedCode ?? ""} onChange={(event) => setSelectedCode(event.target.value ? Number(event.target.value) : null)}><option value="">全国</option>{[...counts.entries()].sort((a, b) => a[0] - b[0]).map(([code, count]) => <option key={code} value={code}>{PREFECTURE_BY_CODE.get(code)?.name}（{count}店）</option>)}</select></div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
          {(selectedCode ? selectedRestaurants : visited).map((restaurant, index) => <RestaurantCard key={restaurant.id} restaurant={restaurant} index={index} onClick={() => onOpen(restaurant)} />)}
        </div>
        {selectedCode && !selectedRestaurants.length && <div className="rounded-[1.5rem] border border-dashed border-stone-200 bg-white/50 px-5 py-10 text-center"><MapPin className="mx-auto size-6 text-stone-300" /><p className="mt-2 text-sm font-bold text-stone-500">まだこの場所の記録はありません</p></div>}
      </section>
    </section>
  );
}

function StatusBadge({ status }: { status: RestaurantStatus }) {
  return (
    <Badge
      className={`shrink-0 text-[10px] font-medium px-2 py-0.5 rounded-lg border-0 shadow-none ${
        status === "visited"
          ? "bg-primary/10 text-primary"
          : "bg-accent/10 text-accent"
      }`}
    >
      {status === "visited" ? "行った" : "行きたい"}
    </Badge>
  );
}

/* ========================================
   Restaurant Detail
   ======================================== */

function RestaurantDetail({
  deleteBusy,
  restaurant,
  onBack,
  onAddVisit,
  onEdit,
  onDelete,
  onPhotosChanged,
}: {
  deleteBusy: boolean;
  restaurant: Restaurant;
  onBack: () => void;
  onAddVisit: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onPhotosChanged: (photos: Photo[]) => void;
}) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [photos, setPhotos] = useState(() => sortPhotos(restaurant.photos));
  const [draggingPhotoId, setDraggingPhotoId] = useState<string | null>(null);
  const [photoOrderMessage, setPhotoOrderMessage] = useState<string | null>(null);
  const [savingPhotoOrder, setSavingPhotoOrder] = useState(false);
  const [previewPhotoId, setPreviewPhotoId] = useState<string | null>(null);
  const [addingPhotos, setAddingPhotos] = useState(false);
  const photosRef = useRef(photos);
  const dragStartPhotosRef = useRef<Photo[]>([]);
  const photoListRef = useRef<HTMLDivElement>(null);
  const savingPhotoOrderRef = useRef(false);
  const draggingPhotoRef = useRef<string | null>(null);
  const previewPhoto = photos.find((photo) => photo.id === previewPhotoId) ?? null;
  const sortedVisits = [...(restaurant.visits ?? [])].sort((a, b) => b.visited_at.localeCompare(a.visited_at));

  useEffect(() => {
    const next = sortPhotos(restaurant.photos);
    setPhotos(next);
    photosRef.current = next;
  }, [restaurant.id, restaurant.photos]);

  function updateLocalPhotoOrder(next: Photo[]) {
    const normalized = next.map((photo, index) => ({ ...photo, sort_order: index }));
    photosRef.current = normalized;
    setPhotos(normalized);
    onPhotosChanged(normalized);
    return normalized;
  }

  function movePhoto(activeId: string, overId: string) {
    if (activeId === overId) return;
    const current = photosRef.current;
    const from = current.findIndex((photo) => photo.id === activeId);
    const to = current.findIndex((photo) => photo.id === overId);
    if (from < 0 || to < 0) return;
    const next = [...current];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    updateLocalPhotoOrder(next);
  }

  async function persistPhotoOrder(previous: Photo[]) {
    const next = photosRef.current;
    if (savingPhotoOrderRef.current || next.every((photo, index) => photo.id === previous[index]?.id)) return;
    savingPhotoOrderRef.current = true;
    setSavingPhotoOrder(true);
    setPhotoOrderMessage("並び順を保存しています…");
    try {
      const { error } = await getSupabase().from("photos").upsert(
        next.map((photo, index) => ({ ...photo, sort_order: index })),
        { onConflict: "id" },
      );
      if (error) throw error;
      setPhotoOrderMessage("並び順を保存しました。先頭の写真が表紙です。");
    } catch {
      updateLocalPhotoOrder(previous);
      setPhotoOrderMessage("並び順を保存できませんでした。元の順番に戻しました。もう一度お試しください。");
    } finally {
      savingPhotoOrderRef.current = false;
      setSavingPhotoOrder(false);
    }
  }

  function handlePhotoPointerDown(event: React.PointerEvent<HTMLButtonElement>, photoId: string) {
    if (savingPhotoOrderRef.current || !event.isPrimary || event.button !== 0) return;
    dragStartPhotosRef.current = photosRef.current;
    draggingPhotoRef.current = photoId;
    setDraggingPhotoId(photoId);
    photoListRef.current?.setPointerCapture(event.pointerId);
  }

  function handlePhotoPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const activeId = draggingPhotoRef.current;
    if (!activeId) return;
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-photo-id]");
    const overId = target?.dataset.photoId;
    if (overId) movePhoto(activeId, overId);
  }

  function handlePhotoPointerEnd(event: React.PointerEvent<HTMLDivElement>, cancelled = false) {
    if (!draggingPhotoRef.current) return;
    draggingPhotoRef.current = null;
    setDraggingPhotoId(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (cancelled) updateLocalPhotoOrder(dragStartPhotosRef.current);
    else void persistPhotoOrder(dragStartPhotosRef.current);
  }

  function movePhotoByButton(photoId: string, destination: number) {
    if (savingPhotoOrderRef.current || draggingPhotoRef.current) return;
    const previous = photosRef.current;
    const target = previous[destination];
    if (!target || target.id === photoId) return;
    movePhoto(photoId, target.id);
    void persistPhotoOrder(previous);
  }

  return (
    <section className="mx-auto max-w-5xl space-y-4">
      <header className="flex items-start gap-3 rounded-[1.4rem] border border-white/80 bg-white/85 p-3.5 shadow-[0_16px_35px_-30px_rgba(25,60,45,0.65)] backdrop-blur-xl sm:p-5">
        <button aria-label="戻る" className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-xl bg-stone-100/70 text-stone-500 transition active:scale-95" type="button" onClick={onBack}><ArrowLeft className="size-4" /></button>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5"><StatusBadge status={restaurant.status} />{restaurant.wants_to_revisit && <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2.5 py-1 text-[10px] font-bold text-rose-600"><Heart className="size-3 fill-current" />また行きたい</span>}</div>
          <h1 className="mt-2 text-xl font-black leading-tight tracking-tight text-stone-800 sm:text-3xl">{restaurant.name}</h1>
          <p className="mt-1.5 flex items-start gap-1.5 text-[11px] leading-relaxed text-stone-500 sm:text-xs"><MapPin className="mt-0.5 size-3.5 shrink-0 text-primary" /><span>{restaurant.area || "エリア未設定"}{restaurant.genre && ` · ${restaurant.genre}`}</span></p>
          <div className="mt-3 flex flex-wrap items-center gap-2"><Stars rating={restaurant.rating} /><span className="text-[10px] font-semibold text-stone-400">訪問 {restaurant.visit_count ?? restaurant.visits?.length ?? 0}回</span></div>
        </div>
        <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
          <Button aria-label="訪問を記録" className="size-10 rounded-xl p-0 sm:h-10 sm:w-auto sm:px-3" size="sm" onClick={onAddVisit}><Plus className="size-4" /><span className="hidden sm:inline">訪問を記録</span></Button>
          <Button aria-label="店舗を編集" className="size-10 rounded-xl p-0 sm:h-10 sm:w-auto sm:px-3" size="sm" variant="outline" onClick={onEdit}><Settings className="size-3.5" /><span className="hidden sm:inline">編集</span></Button>
        </div>
      </header>

      <section className="rounded-[1.4rem] border border-white/80 bg-white/85 p-4 shadow-sm sm:p-5">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-primary/55">Photo memories</p><h2 className="text-sm font-extrabold text-stone-800">写真 <span className="text-stone-400">{photos.length}枚</span></h2></div>
          <Button className="min-h-11 rounded-xl" disabled={savingPhotoOrder || deleteBusy} onClick={() => setAddingPhotos(true)}>
            <ImagePlus className="size-4" />写真を追加
          </Button>
        </div>
        {photos.length > 1 && <p className="mb-3 text-xs text-stone-500">前へ・後ろへ、またはつまみをドラッグして並べ替え</p>}
        {photos.length > 0 ? (
          <div ref={photoListRef} className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5" aria-label="登録済みの写真" onPointerMove={handlePhotoPointerMove} onPointerUp={(event) => handlePhotoPointerEnd(event)} onPointerCancel={(event) => handlePhotoPointerEnd(event, true)} onLostPointerCapture={(event) => handlePhotoPointerEnd(event, true)}>
            {photos.map((photo, i) => (
              <div key={photo.id} data-photo-id={photo.id} className={`min-w-0 overflow-hidden rounded-2xl border bg-white transition ${draggingPhotoId === photo.id ? "opacity-60 ring-2 ring-primary" : i === 0 ? "border-primary/40" : "border-stone-200"}`}>
                <button aria-label={`${i + 1}枚目の写真を大きく表示`} className="block aspect-[4/3] w-full bg-stone-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary" type="button" onClick={() => setPreviewPhotoId(photo.id)}><PhotoTile className="size-full rounded-none" photo={photo} fit="contain" size="thumb" eager={i < 4} /></button>
                <div className="space-y-1 p-2">
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-xs font-semibold text-stone-600">{i + 1}枚目{i === 0 && <span className="ml-1 text-primary">・表紙</span>}</span>
                    <button aria-label={`${i + 1}枚目の写真をドラッグして並べ替え`} className="grid size-11 shrink-0 touch-none cursor-grab place-items-center rounded-lg text-stone-500 hover:bg-stone-100 active:cursor-grabbing disabled:opacity-40" disabled={savingPhotoOrder || photos.length < 2} type="button" onPointerDown={(event) => handlePhotoPointerDown(event, photo.id)}><GripVertical className="size-5" /></button>
                  </div>
                  <div className="grid grid-cols-2 gap-1">
                    <button aria-label={`${i + 1}枚目の写真を前へ`} className="flex min-h-11 items-center justify-center gap-1 rounded-lg border border-stone-200 text-xs hover:bg-stone-50 disabled:opacity-30" disabled={savingPhotoOrder || i === 0} type="button" onClick={() => movePhotoByButton(photo.id, i - 1)}><ArrowLeft className="size-3" />前へ</button>
                    <button aria-label={`${i + 1}枚目の写真を後ろへ`} className="flex min-h-11 items-center justify-center gap-1 rounded-lg border border-stone-200 text-xs hover:bg-stone-50 disabled:opacity-30" disabled={savingPhotoOrder || i === photos.length - 1} type="button" onClick={() => movePhotoByButton(photo.id, i + 1)}><ArrowRight className="size-3" />後ろへ</button>
                  </div>
                  <button aria-label={`${i + 1}枚目の写真を表紙にする`} className="flex min-h-11 w-full items-center justify-center gap-1 rounded-lg text-xs font-semibold text-primary hover:bg-primary/5 disabled:opacity-40" disabled={savingPhotoOrder || i === 0} type="button" onClick={() => movePhotoByButton(photo.id, 0)}><Star className="size-3.5" />{i === 0 ? "表紙に設定中" : "表紙にする"}</button>
                </div>
              </div>
            ))}
          </div>
        ) : <div className="flex items-center gap-3 rounded-2xl bg-stone-50/80 p-4 text-stone-400"><span className="grid size-10 place-items-center rounded-xl bg-white"><Camera className="size-4" /></span><p className="text-xs">写真はまだありません。「写真を追加」から登録できます。</p></div>}
        {photoOrderMessage && <p className={`mt-1 text-[10px] ${photoOrderMessage.includes("できません") ? "text-red-600" : "text-primary"}`} role="status">{photoOrderMessage}</p>}
      </section>

      <div className="space-y-4">
        <div className="space-y-4">
          {/* 基本情報 */}
          <Card className="space-y-4 border border-stone-200/40 shadow-sm rounded-2xl p-5 bg-white/90">
            <div className="flex items-center justify-between gap-4">
              <div><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-stone-400">About this place</p><h2 className="mt-0.5 text-sm font-extrabold text-stone-800">メモと詳細</h2></div>
              <div className="flex shrink-0 justify-end">
                <Button
                  size="sm"
                  onClick={() => setConfirmingDelete(true)}
                  className="size-9 rounded-xl border border-red-100 bg-red-50 p-0 text-red-500 shadow-none hover:bg-red-100"
                  aria-label="店舗を削除"
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            </div>

            {confirmingDelete && (
              <div className="rounded-xl border border-red-100 bg-red-50/80 p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="space-y-1">
                    <p className="text-sm font-semibold text-red-700">この店舗を削除しますか？</p>
                    <p className="text-xs leading-relaxed text-red-500">
                      訪問記録、写真の登録情報、タグ紐づけも削除されます。この操作は元に戻せません。
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Button
                      size="sm"
                      type="button"
                      disabled={deleteBusy}
                      onClick={() => setConfirmingDelete(false)}
                      className="rounded-xl bg-white text-stone-600 shadow-none hover:bg-stone-50"
                    >
                      キャンセル
                    </Button>
                    <Button
                      size="sm"
                      type="button"
                      disabled={deleteBusy}
                      onClick={onDelete}
                      className="rounded-xl bg-red-600 text-white shadow-sm hover:bg-red-700"
                    >
                      <Trash2 className="size-3.5" />
                      {deleteBusy ? "削除中..." : "削除する"}
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {restaurant.memo && (
              <div className="rounded-xl bg-stone-50/80 p-4">
                <p className="text-sm leading-relaxed text-stone-600 font-light whitespace-pre-wrap">{restaurant.memo}</p>
              </div>
            )}

            {(restaurant.price_range || restaurant.crowd_level || restaurant.occasions?.length) && (
              <div className="flex flex-wrap gap-1.5 text-[11px]">
                {restaurant.price_range && <span className="rounded-lg bg-stone-100 px-2.5 py-1 text-stone-600">{({ budget: "気軽", standard: "ふだん", special: "特別な日" } as const)[restaurant.price_range]}</span>}
                {restaurant.crowd_level && <span className="rounded-lg bg-stone-100 px-2.5 py-1 text-stone-600">{({ quiet: "静か", normal: "ふつう", busy: "にぎやか" } as const)[restaurant.crowd_level]}</span>}
                {restaurant.occasions?.map((occasion) => <span key={occasion} className="rounded-lg bg-primary/10 px-2.5 py-1 text-primary">{occasion}</span>)}
              </div>
            )}

            <p className="text-xs text-stone-400">訪問 {restaurant.visit_count ?? restaurant.visits?.length ?? 0} 回 · 平均 {restaurant.average_rating ?? restaurant.rating ?? "-"}</p>

            {(restaurant.tags?.length ?? 0) > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {restaurant.tags?.map((tag) => (
                  <span
                    key={tag.id}
                    className="inline-block rounded-lg bg-stone-100/80 px-2.5 py-1 text-[11px] text-stone-500 font-light"
                  >
                    #{tag.name}
                  </span>
                ))}
              </div>
            )}
          </Card>

          {/* タイムライン */}
          <section className="space-y-4 border border-stone-200/40 shadow-sm rounded-2xl bg-white/90 p-5">
            <h3 className="text-xs font-bold text-stone-500 tracking-widest uppercase pb-2 border-b border-stone-100/80">
              訪問タイムライン
            </h3>
            {sortedVisits.length > 0 ? (
              <div className="relative border-l-[1.5px] border-stone-200/60 pl-6 ml-2 py-1 space-y-5">
                {sortedVisits.map((visit: Visit, i: number) => {
                  const visitPhotos = photos.filter((photo) => photo.visit_id === visit.id);
                  return (
                  <div key={visit.id} className={`relative animate-in delay-${Math.min(i + 1, 8)}`}>
                    <span className="absolute -left-[27px] top-1 flex h-3 w-3 items-center justify-center rounded-full bg-white border-[1.5px] border-primary">
                      <span className="h-1.5 w-1.5 rounded-full bg-primary timeline-dot" />
                    </span>
                    <div className="overflow-hidden rounded-2xl border border-stone-100 bg-stone-50/55">
                      <div className="grid grid-cols-[72px_1fr] gap-3 p-3 sm:grid-cols-[88px_1fr]">
                        <div className="overflow-hidden rounded-xl bg-stone-100">{visitPhotos[0] ? <PhotoTile className="aspect-square size-full rounded-none" photo={visitPhotos[0]} size="thumb" /> : <div className="grid aspect-square size-full place-items-center text-stone-300"><Utensils className="size-4" /></div>}</div>
                        <div className="min-w-0 space-y-1.5 py-0.5">
                        <p className="flex items-center gap-1.5 text-[10px] font-bold tracking-wider text-stone-400"><CalendarDays className="size-3" />{formatLongDate(visit.visited_at)}</p>
                        <div className="flex items-start justify-between gap-2"><h4 className="text-base font-bold text-stone-800">{visit.dish_name || "食事の記録"}</h4><Stars rating={visit.rating} /></div>
                        {visit.memo && <p className="line-clamp-2 text-xs leading-relaxed text-stone-500 font-light">{visit.memo}</p>}
                        {visitPhotos.length > 1 && <p className="text-[10px] text-stone-400">写真 {visitPhotos.length}枚</p>}
                        </div>
                      </div>
                    </div>
                  </div>
                )})}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-10 text-stone-300">
                <Utensils className="size-5 mb-2 opacity-50" />
                <p className="text-xs font-light">訪問記録がまだありません。</p>
              </div>
            )}
          </section>
        </div>

      </div>
      {previewPhoto && <PhotoPreview photo={previewPhoto} onClose={() => setPreviewPhotoId(null)} />}
      {addingPhotos && (
        <PhotoAddDialog
          restaurant={restaurant}
          photos={photos}
          onClose={() => setAddingPhotos(false)}
          onAdded={(added) => {
            const merged = new Map(photosRef.current.map((photo) => [photo.id, photo]));
            for (const photo of added) merged.set(photo.id, photo);
            const next = sortPhotos([...merged.values()]);
            photosRef.current = next;
            setPhotos(next);
            onPhotosChanged(next);
            setPhotoOrderMessage(`${added.length}枚の写真を追加しました。`);
          }}
        />
      )}
    </section>
  );
}

/* ========================================
   Restaurant Form
   ======================================== */

function RestaurantForm({ onBack, onSaved, restaurant: editingRestaurant, restaurants, quick = false }: { onBack: () => void; onSaved: (notice?: string) => void; restaurant?: Restaurant; restaurants: Restaurant[]; quick?: boolean }) {
  const [form, setForm] = useState({
    name: editingRestaurant?.name ?? "",
    area: editingRestaurant?.area ?? "",
    genre: editingRestaurant?.genre ?? "",
    status: editingRestaurant?.status ?? "visited" as RestaurantStatus,
    rating: editingRestaurant?.rating?.toString() ?? "",
    memo: editingRestaurant?.memo ?? "",
    tags: editingRestaurant?.tags?.map((tag) => tag.name).join(" ") ?? "",
    visited_at: getLocalDateInputValue(),
    dish_name: "",
    visitMemo: "",
    caption: "",
    wants_to_revisit: editingRestaurant?.wants_to_revisit ?? false,
    price_range: editingRestaurant?.price_range ?? "",
    occasions: editingRestaurant?.occasions ?? [] as string[],
    crowd_level: editingRestaurant?.crowd_level ?? "",
  });
  const [photoDrafts, setPhotoDrafts] = useState<PhotoDraft[]>([]);
  const busyRef = useRef(false);
  const activeRef = useRef(true);
  const saveStartedRef = useRef(false);
  const saveOwnerRef = useRef<string | null>(null);
  const nextPhotoOrderRef = useRef<number | null>(null);
  const [saveSession] = useState(createFormSaveSession);
  const [saveLocked, setSaveLocked] = useState(false);

  const [selectedPlace, setSelectedPlace] = useState<PlaceSuggestion | null>(null);
  const [nameSearchResetKey, setNameSearchResetKey] = useState(0);
  const photoFilesRequestRef = useRef(0);
  const photoLookupRequestRef = useRef(0);
  const photoLookupAbortRef = useRef<AbortController | null>(null);

  function cancelPhotoLookup() {
    photoLookupRequestRef.current += 1;
    photoLookupAbortRef.current?.abort();
    photoLookupAbortRef.current = null;
  }

  useEffect(() => {
    activeRef.current = true;
    return () => {
      activeRef.current = false;
      photoFilesRequestRef.current += 1;
      photoLookupRequestRef.current += 1;
      photoLookupAbortRef.current?.abort();
    };
  }, []);

  const [placeLookup, setPlaceLookup] = useState<PlaceLookupState>({
    status: "idle",
    message: "",
    suggestions: [],
  });
  const [busy, setBusy] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(!quick);
  const [photoDateNotice, setPhotoDateNotice] = useState<string | null>(null);
  const [message, setMessage] = useState<Message | null>(null);

  function updatePhotoDrafts(next: PhotoDraft[]) {
    if (photoDrafts.some((photo) => !next.some((item) => item.id === photo.id))) {
      photoFilesRequestRef.current += 1;
      cancelPhotoLookup();
      setPlaceLookup({ status: "idle", message: "", suggestions: [] });
      setPhotoDateNotice(null);
    }
    setPhotoDrafts(next);
  }

  async function handlePhotoFiles(nextFiles: File[]) {
    if (!nextFiles.length) return;
    const filesRequest = ++photoFilesRequestRef.current;
    cancelPhotoLookup();
    const lookupRequest = photoLookupRequestRef.current;
    setNameSearchResetKey((current) => current + 1);
    const additions = createPhotoDrafts(nextFiles);
    setPhotoDrafts((current) => [...current, ...additions]);
    setPlaceLookup({ status: "idle", message: "", suggestions: [] });
    setPhotoDateNotice(null);

    try {
      const dates = (await Promise.all([...photoDrafts.map((photo) => photo.original), ...nextFiles].map((file) => getPhotoTakenDate(file)))).filter((date): date is string => Boolean(date));
      if (filesRequest !== photoFilesRequestRef.current) return;
      const earliestDate = dates.sort()[0];
      if (earliestDate) {
        setForm((current) => ({ ...current, visited_at: earliestDate }));
        const hasMultipleDates = new Set(dates).size > 1;
        setPhotoDateNotice(hasMultipleDates
          ? `複数の撮影日があるため、最も古い ${formatLongDate(earliestDate)} を訪問日に反映しました。`
          : `写真の撮影日 ${formatLongDate(earliestDate)} を訪問日に反映しました。`);
      } else {
        setPhotoDateNotice("写真から撮影日を取得できなかったため、訪問日は変更していません。");
      }
    } catch {
      if (filesRequest !== photoFilesRequestRef.current) return;
      setPhotoDateNotice("写真から撮影日を取得できなかったため、訪問日は変更していません。");
    }

    if (lookupRequest !== photoLookupRequestRef.current) return;
    const controller = new AbortController();
    photoLookupAbortRef.current = controller;
    const isCurrent = () => !controller.signal.aborted && lookupRequest === photoLookupRequestRef.current;
    setPlaceLookup({ status: "loading", message: "写真の位置情報を確認しています。", suggestions: [] });

    try {
      const coordinates = await getPhotoCoordinates(nextFiles[0]);
      if (!isCurrent()) return;
      if (!coordinates) {
        setPlaceLookup({
          status: "unavailable",
          message: "選択した写真に位置情報がありません。店名を入力すると現在地周辺の飲食店を探せます。",
          suggestions: [],
        });
        return;
      }

      setPlaceLookup({ status: "loading", message: "写真の位置情報から近くの飲食店を検索しています。", suggestions: [] });
      const params = new URLSearchParams({ lat: String(coordinates.latitude), lng: String(coordinates.longitude) });
      const { data: sessionData } = await getSupabase().auth.getSession();
      if (!isCurrent()) return;
      const accessToken = sessionData.session?.access_token;
      if (!accessToken) throw new Error("ログイン情報を確認できませんでした。再ログインしてください。");
      const response = await fetch(`/api/places/nearby?${params.toString()}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: controller.signal,
      });
      if (!isCurrent()) return;
      const payload = (await response.json()) as { error?: string; suggestions?: PlaceSuggestion[] };
      if (!isCurrent()) return;
      if (!response.ok) throw new Error(payload.error ?? "店舗候補を検索できませんでした。");

      const suggestions = payload.suggestions ?? [];
      setPlaceLookup({
        status: suggestions.length ? "ready" : "empty",
        message: suggestions.length
          ? "写真の近くにある飲食店の候補を選択できます。"
          : "写真の近くに飲食店の候補が見つかりませんでした。店名からも検索できます。",
        suggestions,
      });
    } catch (error) {
      if (!isCurrent()) return;
      setPlaceLookup({
        status: "error",
        message: error instanceof Error ? error.message : "店舗候補を検索できませんでした。",
        suggestions: [],
      });
    }
  }

  function changeRestaurantIdentity(field: "name" | "area", value: string) {
    cancelPhotoLookup();
    setPlaceLookup({ status: "idle", message: "", suggestions: [] });
    setSelectedPlace(null);
    if (field === "area") setNameSearchResetKey((current) => current + 1);
    setForm((current) => ({ ...current, [field]: value }));
  }

  function applyPlaceSuggestion(suggestion: PlaceSuggestion, fromPhoto = false) {
    cancelPhotoLookup();
    if (fromPhoto) setNameSearchResetKey((current) => current + 1);
    setSelectedPlace(suggestion);
    setForm((current) => ({ ...current, area: suggestion.address, genre: suggestion.genre || current.genre, name: suggestion.name }));
    setPlaceLookup({
      status: fromPhoto ? "ready" : "idle",
      message: fromPhoto ? `${suggestion.name} を入力しました。` : "",
      suggestions: [],
    });
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busyRef.current || !form.name.trim()) return;
    busyRef.current = true;
    setBusy(true);
    setMessage(null);
    cancelPhotoLookup();
    photoFilesRequestRef.current += 1;
    setNameSearchResetKey((current) => current + 1);

    try {
      const client = getSupabase();
      const { data: user, error: authError } = await client.auth.getUser();
      const userId = user.user?.id;
      if (authError || !userId || (saveOwnerRef.current && saveOwnerRef.current !== userId)) {
        throw new Error("ログイン状態を確認できませんでした。再ログインしてお試しください。");
      }
      if (!activeRef.current) return;
      const uploadFiles = await optimizeUploadFiles(photoDrafts.map((photo) => photo.file));
      if (!activeRef.current) return;
      saveOwnerRef.current = userId;
      saveStartedRef.current = true;
      setSaveLocked(true);

      const restaurantPayload = {
        user_id: userId,
        name: form.name,
        area: form.area || null,
        genre: form.genre || null,
        genre_source: form.genre
          ? selectedPlace?.genre === form.genre
            ? "google_places"
            : editingRestaurant?.genre === form.genre
              ? editingRestaurant.genre_source ?? "manual"
              : "manual"
          : null,
        genre_confidence: form.genre
          ? selectedPlace?.genre === form.genre
            ? "high"
            : editingRestaurant?.genre === form.genre
              ? editingRestaurant.genre_confidence ?? "high"
              : "high"
          : null,
        genre_raw: selectedPlace?.genre === form.genre ? selectedPlace.genre : editingRestaurant?.genre_raw ?? null,
        status: form.status,
        rating: form.rating ? Number(form.rating) : null,
        memo: form.memo || null,
        wants_to_revisit: form.wants_to_revisit,
        price_range: form.price_range || null,
        occasions: form.occasions,
        crowd_level: form.crowd_level || null,
        ...getRestaurantPlaceSelection({
          currentName: form.name,
          currentArea: form.area,
          selectedPlace,
          original: editingRestaurant,
        }),
      };
      async function updateExisting(existing: Restaurant) {
        const hasSelectedPlace = Boolean(selectedPlace && restaurantPayload.google_place_id === selectedPlace.id);
        const area = hasSelectedPlace ? restaurantPayload.area : existing.area || restaurantPayload.area;
        const location = hasSelectedPlace
          ? getRestaurantPlaceSelection({ currentName: form.name, currentArea: form.area, selectedPlace })
          : getRestaurantPlaceSelection({ currentName: existing.name, currentArea: area, selectedPlace: null, original: existing });
        const { data, error } = await client.from("restaurants").update({
          ...restaurantPayload,
          name: existing.name,
          area,
          genre: existing.genre || restaurantPayload.genre,
          genre_source: existing.genre_source || restaurantPayload.genre_source,
          genre_confidence: existing.genre_confidence || restaurantPayload.genre_confidence,
          genre_raw: existing.genre_raw || restaurantPayload.genre_raw,
          memo: existing.memo || restaurantPayload.memo,
          status: existing.status === "visited" || restaurantPayload.status === "visited" ? "visited" : "wishlist",
          rating: restaurantPayload.rating ?? existing.rating,
          wants_to_revisit: Boolean(existing.wants_to_revisit || restaurantPayload.wants_to_revisit),
          price_range: existing.price_range || restaurantPayload.price_range,
          occasions: [...new Set([...(existing.occasions ?? []), ...restaurantPayload.occasions])],
          crowd_level: existing.crowd_level || restaurantPayload.crowd_level,
          ...location,
          updated_at: new Date().toISOString(),
        }).eq("id", existing.id).select().single();
        return { data: data as Restaurant | null, error };
      }

      const parent = await saveSession.once("restaurant", async () => {
        let restaurant: Restaurant | null = null;
        let saveError: string | null = null;
        let mergedIntoExisting = false;
        let matchedExisting: Restaurant | null = null;

        if (editingRestaurant) {
          const result = await client.from("restaurants").update({ ...restaurantPayload, updated_at: new Date().toISOString() }).eq("id", editingRestaurant.id).select().single();
          restaurant = result.data as Restaurant | null;
          saveError = result.error?.message ?? null;
        } else {
          const match = findRegistrationMatch(restaurants, {
            name: form.name,
            area: form.area || null,
            googlePlaceId: restaurantPayload.google_place_id,
          });
          matchedExisting = match ? restaurants.find((item) => item.id === match.id) ?? null : null;
          if (matchedExisting) {
            const result = await updateExisting(matchedExisting);
            restaurant = result.data;
            saveError = result.error?.message ?? null;
            mergedIntoExisting = !result.error;
          } else {
            const result = await client.from("restaurants").upsert({
              id: saveSession.id("restaurant"),
              ...restaurantPayload,
            }, { onConflict: "id" }).select().single();
            restaurant = result.data as Restaurant | null;
            saveError = result.error?.message ?? null;

            if (result.error?.code === "23505" && restaurantPayload.google_place_id && activeRef.current) {
              const existingResult = await client.from("restaurants").select("*, tags(*), visits(*), photos(*)").eq("google_place_id", restaurantPayload.google_place_id).maybeSingle();
              matchedExisting = existingResult.data as Restaurant | null;
              if (matchedExisting) {
                const retry = await updateExisting(matchedExisting);
                restaurant = retry.data;
                saveError = retry.error?.message ?? null;
                mergedIntoExisting = !retry.error;
              }
            }
          }
        }
        if (saveError || !restaurant) throw new Error(saveError ?? "店舗を保存できませんでした。");
        return { restaurant, matchedExisting, mergedIntoExisting };
      });
      if (!activeRef.current) return;
      const { restaurant, matchedExisting, mergedIntoExisting } = parent;
      nextPhotoOrderRef.current ??= getNextPhotoSortOrder(editingRestaurant?.photos ?? matchedExisting?.photos);

      await saveSession.once("tags", async () => {
        const tagNames = form.tags.split(/[、,\s]+/).filter(Boolean);
        for (const name of tagNames) {
          if (!activeRef.current) throw new Error("保存を中断しました。");
          const { data: tag, error: tagError } = await client.from("tags")
            .upsert({ user_id: userId, name }, { onConflict: "user_id,name" }).select().single();
          if (tagError || !tag) throw new Error(tagError?.message ?? "タグを保存できませんでした。");
          if (!activeRef.current) throw new Error("保存を中断しました。");
          const { error: linkError } = await client.from("restaurant_tags")
            .upsert({ restaurant_id: restaurant.id, tag_id: tag.id, user_id: userId }, { onConflict: "restaurant_id,tag_id" });
          if (linkError) throw new Error(linkError.message);
        }
      });
      if (!activeRef.current) return;

      const visit = await saveSession.once("visit", async () => {
        const shouldCreateVisit = !editingRestaurant && (form.status === "visited" || photoDrafts.length > 0 || form.dish_name || form.visitMemo);
        if (!shouldCreateVisit) return null;
        const sameDayVisit = mergedIntoExisting ? matchedExisting?.visits?.find((item) => item.visited_at === form.visited_at) : null;
        if (sameDayVisit) {
          const { error } = await client.from("visits").update({
            dish_name: sameDayVisit.dish_name || form.dish_name || null,
            memo: sameDayVisit.memo || form.visitMemo || null,
            rating: sameDayVisit.rating ?? (form.rating ? Number(form.rating) : null),
          }).eq("id", sameDayVisit.id);
          if (error) throw new Error(error.message);
          return sameDayVisit;
        }
        const { data: savedVisit, error } = await client.from("visits").upsert({
          id: saveSession.id("visit"),
          user_id: userId,
          restaurant_id: restaurant.id,
          visited_at: form.visited_at,
          dish_name: form.dish_name || null,
          rating: form.rating ? Number(form.rating) : null,
          memo: form.visitMemo || null,
        }, { onConflict: "id" }).select().single();
        if (error || !savedVisit) throw new Error(error?.message ?? "初回訪問を保存できませんでした。");
        return savedVisit as Visit;
      });
      if (!activeRef.current) return;

      const result = await addRestaurantPhotos({
        candidates: photoDrafts.map((photo, index) => ({ id: photo.id, file: uploadFiles[index] })),
        userId,
        restaurantId: restaurant.id,
        visitId: visit?.id ?? null,
        caption: form.caption,
        startSortOrder: nextPhotoOrderRef.current,
      }, createPhotoUploadDependencies(client, { prepared: true, isActive: () => activeRef.current }));
      if (!activeRef.current) return;
      nextPhotoOrderRef.current = result.nextSortOrder;
      const remaining = new Set(result.remainingIds);
      setPhotoDrafts((current) => current.filter((photo) => remaining.has(photo.id)));
      if (result.error) throw result.error;
      onSaved(mergedIntoExisting ? `「${restaurant.name}」は登録済みのため、今回の写真と訪問記録を既存店舗へ統合しました。` : undefined);
    } catch (error) {
      if (activeRef.current) setMessage({
        text: `${saveStartedRef.current ? "保存結果の確認が終わっていません。内容を保ったまま「保存を再試行」を押してください。確認できた店舗・訪問・写真は重複しません。 " : ""}${error instanceof Error ? error.message : "保存できませんでした。もう一度お試しください。"}`,
        type: "error",
      });
    } finally {
      busyRef.current = false;
      if (activeRef.current) setBusy(false);
    }
  }

  return (
    <FormShell title={editingRestaurant ? "店舗を編集" : quick ? "今日の一皿を記録" : "店舗を追加"} onBack={() => { if (!busyRef.current) { if (saveStartedRef.current) onSaved(); else onBack(); } }}>
      <Card className="border border-stone-200/40 bg-white/90 rounded-2xl p-4 shadow-sm sm:p-6">
        <form className="grid gap-5 md:grid-cols-2" onSubmit={save}>
          <fieldset disabled={busy || saveLocked} className="contents">
            {quick && <div className="md:col-span-2 rounded-2xl bg-[linear-gradient(120deg,#173b31,#2f6655)] p-5 text-white"><h2 className="text-xl font-bold">今日のおいしいを残そう。</h2><p className="mt-2 text-sm leading-relaxed text-white/85">写真・店名・評価だけでも保存できます。細かな情報はあとから追加できます。</p></div>}
            <Field className="md:col-span-2" label={editingRestaurant ? "写真を追加" : "写真からはじめる"}>
              <div className="rounded-2xl border border-dashed border-primary/30 bg-primary/[0.035] p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-bold text-stone-800">写真を選ぶと、近くの飲食店を自動で探します</p>
                    <p className="mt-1 text-xs leading-relaxed text-stone-500">位置情報付きの写真なら、レストラン・カフェなどの候補から店名・住所・ジャンルを入力できます。</p>
                  </div>
                </div>
                <div className="mt-3">
                  <PhotoPicker
                    photos={photoDrafts}
                    onChange={updatePhotoDrafts}
                    onAddFiles={(selectedFiles) => void handlePhotoFiles(selectedFiles)}
                    disabled={busy || saveLocked}
                    hasExistingPhotos={Boolean(editingRestaurant?.photos?.length)}
                  />
                </div>
                {photoDateNotice && <p className="mt-3 flex items-start gap-2 rounded-xl bg-emerald-50/70 p-3 text-xs leading-relaxed text-emerald-800"><CalendarDays className="mt-0.5 size-3.5 shrink-0" />{photoDateNotice}</p>}
                {placeLookup.status !== "idle" && <PlaceSuggestionPanel lookup={placeLookup} disabled={busy || saveLocked} onSelect={(suggestion) => applyPlaceSuggestion(suggestion, true)} />}
              </div>
            </Field>
            {showAdvanced && <Field className="md:col-span-2" label="写真のキャプション">
              <Input className="h-11 rounded-xl bg-stone-50/50 border-stone-200/60" placeholder="例: 絶品のチャーシュー" value={form.caption} onChange={(event) => setForm({ ...form, caption: event.target.value })} />
            </Field>}
            <div className="min-w-0 space-y-2">
              <Label className="flex items-center gap-2 text-xs font-semibold text-stone-600" htmlFor="restaurant-name">
                店名<span className="text-[10px] font-medium text-stone-500">必須</span>
              </Label>
              <RestaurantNameSearch
                id="restaurant-name"
                value={form.name}
                disabled={busy || saveLocked}
                resetKey={nameSearchResetKey}
                onChange={(value) => changeRestaurantIdentity("name", value)}
                onSelect={applyPlaceSuggestion}
              />
            </div>
            {showAdvanced && <Field label="分類">
              <div className="relative">
                <select
                  className="h-11 w-full rounded-xl border border-stone-200/60 bg-stone-50/50 px-3 text-sm outline-none appearance-none cursor-pointer pr-10 font-medium text-stone-700 transition-all duration-200"
                  value={form.status}
                  onChange={(event) => setForm({ ...form, status: event.target.value as RestaurantStatus })}
                >
                  <option value="visited">行った店</option>
                  <option value="wishlist">行きたい店</option>
                </select>
                <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-stone-400 text-[10px]">▼</span>
              </div>
            </Field>}
            <Field label="エリア">
              <Input className="h-11 rounded-xl bg-stone-50/50 border-stone-200/60" placeholder="例: 渋谷、恵比寿" value={form.area} disabled={busy || saveLocked} onChange={(event) => changeRestaurantIdentity("area", event.target.value)} />
            </Field>
            {showAdvanced && <Field label="ジャンル">
              <Input className="h-11 rounded-xl bg-stone-50/50 border-stone-200/60" placeholder="例: 和食、イタリアン" value={form.genre} onChange={(event) => setForm({ ...form, genre: event.target.value })} />
            </Field>}
            <Field label="評価">
              <StarPicker value={form.rating} onChange={(rating) => setForm({ ...form, rating })} />
            </Field>
            {showAdvanced && <Field label="タグ">
              <Input className="h-11 rounded-xl bg-stone-50/50 border-stone-200/60" placeholder="スペース区切り (例: ラーメン 渋谷)" value={form.tags} onChange={(event) => setForm({ ...form, tags: event.target.value })} />
            </Field>}
            {showAdvanced && <Field className="md:col-span-2" label="お店についてのメモ">
              <Textarea className="rounded-xl bg-stone-50/50 border-stone-200/60 min-h-[100px]" placeholder="店内の雰囲気、予算、おすすめメニューなど..." value={form.memo} onChange={(event) => setForm({ ...form, memo: event.target.value })} />
            </Field>}
            {showAdvanced && <Field label="また行きたい？">
              <label className="flex h-11 cursor-pointer items-center gap-3 rounded-xl border border-stone-200/60 bg-stone-50/50 px-3 text-sm text-stone-700">
                <input
                  checked={form.wants_to_revisit}
                  className="size-4 accent-primary"
                  type="checkbox"
                  onChange={(event) => setForm({ ...form, wants_to_revisit: event.target.checked })}
                />
                また行きたい店として保存する
              </label>
            </Field>}
            {showAdvanced && <Field label="予算感">
              <select className="h-11 w-full rounded-xl border border-stone-200/60 bg-stone-50/50 px-3 text-sm" value={form.price_range} onChange={(event) => setForm({ ...form, price_range: event.target.value })}>
                <option value="">未設定</option><option value="budget">気軽</option><option value="standard">ふだん</option><option value="special">特別な日</option>
              </select>
            </Field>}
            {showAdvanced && <Field label="混雑">
              <select className="h-11 w-full rounded-xl border border-stone-200/60 bg-stone-50/50 px-3 text-sm" value={form.crowd_level} onChange={(event) => setForm({ ...form, crowd_level: event.target.value })}>
                <option value="">未設定</option><option value="quiet">静か</option><option value="normal">ふつう</option><option value="busy">にぎやか</option>
              </select>
            </Field>}
            {showAdvanced && <Field className="md:col-span-2" label="おすすめの場面">
              <div className="flex flex-wrap gap-2 rounded-xl border border-stone-200/60 bg-stone-50/50 p-3">
                {["ひとり", "デート", "友人と", "家族と", "仕事"].map((occasion) => {
                  const selected = form.occasions.includes(occasion);
                  return <button key={occasion} aria-pressed={selected} className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${selected ? "bg-primary text-primary-foreground" : "bg-white text-stone-500 hover:bg-stone-100"}`} type="button" onClick={() => setForm({ ...form, occasions: selected ? form.occasions.filter((item) => item !== occasion) : [...form.occasions, occasion] })}>{occasion}</button>;
                })}
              </div>
            </Field>}
            <Field label="初回訪問日">
              <Input className="h-11 rounded-xl bg-stone-50/50 border-stone-200/60 font-medium cursor-pointer" type="date" value={form.visited_at} onChange={(event) => setForm({ ...form, visited_at: event.target.value })} />
            </Field>
            <Field label="食べた料理">
              <Input className="h-11 rounded-xl bg-stone-50/50 border-stone-200/60" placeholder="例: 特製醤油ラーメン" value={form.dish_name} onChange={(event) => setForm({ ...form, dish_name: event.target.value })} />
            </Field>
            <Field className="md:col-span-2" label="初回訪問メモ">
              <Textarea className="rounded-xl bg-stone-50/50 border-stone-200/60 min-h-[100px]" placeholder="料理の味、サービス、混雑状況など..." value={form.visitMemo} onChange={(event) => setForm({ ...form, visitMemo: event.target.value })} />
            </Field>
            {quick && !showAdvanced && <button className="md:col-span-2 mx-auto text-xs font-semibold text-primary underline-offset-4 hover:underline" type="button" onClick={() => setShowAdvanced(true)}>ジャンル・タグ・予算なども入力する</button>}
          </fieldset>
          <Button className="md:col-span-2 h-11 font-bold rounded-xl shadow-sm press-effect" disabled={busy} type="submit">
            <Camera className="size-4" />
            {busy ? "保存しています..." : saveLocked ? "保存を再試行" : quick ? "この記憶を保存する" : "店舗と写真を保存する"}
          </Button>
          {message && <div className="md:col-span-2"><MessageBanner message={message} /></div>}
        </form>
      </Card>
    </FormShell>
  );
}

/* ========================================
   Visit Form
   ======================================== */

function VisitForm({ restaurant, onBack, onSaved }: { restaurant: Restaurant; onBack: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ visited_at: getLocalDateInputValue(), dish_name: "", rating: "", memo: "", caption: "" });
  const [photoDrafts, setPhotoDrafts] = useState<PhotoDraft[]>([]);
  const busyRef = useRef(false);
  const activeRef = useRef(true);
  const saveStartedRef = useRef(false);
  const saveOwnerRef = useRef<string | null>(null);
  const nextPhotoOrderRef = useRef<number | null>(null);
  const [saveSession] = useState(createFormSaveSession);
  const [saveLocked, setSaveLocked] = useState(false);

  const [photoDateNotice, setPhotoDateNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);
  const photoFilesRequestRef = useRef(0);
  useEffect(() => {
    activeRef.current = true;
    return () => {
      activeRef.current = false;
      photoFilesRequestRef.current += 1;
    };
  }, []);

  function updatePhotoDrafts(next: PhotoDraft[]) {
    if (photoDrafts.some((photo) => !next.some((item) => item.id === photo.id))) {
      photoFilesRequestRef.current += 1;
      setPhotoDateNotice(null);
    }
    setPhotoDrafts(next);
  }

  async function handlePhotoFiles(nextFiles: File[]) {
    if (!nextFiles.length) return;
    const request = ++photoFilesRequestRef.current;
    const additions = createPhotoDrafts(nextFiles);
    setPhotoDrafts((current) => [...current, ...additions]);
    setPhotoDateNotice(null);

    try {
      const dates = (await Promise.all([...photoDrafts.map((photo) => photo.original), ...nextFiles].map((file) => getPhotoTakenDate(file)))).filter((date): date is string => Boolean(date));
      if (request !== photoFilesRequestRef.current) return;
      const earliestDate = dates.sort()[0];
      if (earliestDate) {
        setForm((current) => ({ ...current, visited_at: earliestDate }));
        const hasMultipleDates = new Set(dates).size > 1;
        setPhotoDateNotice(hasMultipleDates
          ? `複数の撮影日があるため、最も古い ${formatLongDate(earliestDate)} を訪問日に反映しました。`
          : `写真の撮影日 ${formatLongDate(earliestDate)} を訪問日に反映しました。`);
      } else {
        setPhotoDateNotice("写真から撮影日を取得できなかったため、訪問日は変更していません。");
      }
    } catch {
      if (request !== photoFilesRequestRef.current) return;
      setPhotoDateNotice("写真から撮影日を取得できなかったため、訪問日は変更していません。");
    }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setMessage(null);
    photoFilesRequestRef.current += 1;

    try {
      const client = getSupabase();
      const { data: user, error: authError } = await client.auth.getUser();
      const userId = user.user?.id;
      if (authError || !userId || userId !== restaurant.user_id || (saveOwnerRef.current && saveOwnerRef.current !== userId)) {
        throw new Error("ログイン状態を確認できませんでした。再ログインしてお試しください。");
      }
      if (!activeRef.current) return;
      const uploadFiles = await optimizeUploadFiles(photoDrafts.map((photo) => photo.file));
      if (!activeRef.current) return;
      saveOwnerRef.current = userId;
      saveStartedRef.current = true;
      setSaveLocked(true);
      nextPhotoOrderRef.current ??= getNextPhotoSortOrder(restaurant.photos);

      const visit = await saveSession.once("visit", async () => {
        const { data, error } = await client.from("visits").upsert({
          id: saveSession.id("visit"),
          user_id: userId,
          restaurant_id: restaurant.id,
          visited_at: form.visited_at,
          dish_name: form.dish_name || null,
          rating: form.rating ? Number(form.rating) : null,
          memo: form.memo || null,
        }, { onConflict: "id" }).select().single();
        if (error || !data) throw new Error(error?.message ?? "訪問記録を保存できませんでした。");
        return data as Visit;
      });
      if (!activeRef.current) return;
      await saveSession.once("restaurant-status", async () => {
        const { error } = await client.from("restaurants").update({ status: "visited", updated_at: new Date().toISOString() }).eq("id", restaurant.id);
        if (error) throw new Error(error.message);
      });
      if (!activeRef.current) return;

      const result = await addRestaurantPhotos({
        candidates: photoDrafts.map((photo, index) => ({ id: photo.id, file: uploadFiles[index] })),
        userId,
        restaurantId: restaurant.id,
        visitId: visit.id,
        caption: form.caption,
        startSortOrder: nextPhotoOrderRef.current,
      }, createPhotoUploadDependencies(client, { prepared: true, isActive: () => activeRef.current }));
      if (!activeRef.current) return;
      nextPhotoOrderRef.current = result.nextSortOrder;
      const remaining = new Set(result.remainingIds);
      setPhotoDrafts((current) => current.filter((photo) => remaining.has(photo.id)));
      if (result.error) throw result.error;
      onSaved();
    } catch (error) {
      if (activeRef.current) setMessage({
        text: `${saveStartedRef.current ? "保存結果の確認が終わっていません。内容を保ったまま「保存を再試行」を押してください。確認できた訪問・写真は重複しません。 " : ""}${error instanceof Error ? error.message : "保存できませんでした。もう一度お試しください。"}`,
        type: "error",
      });
    } finally {
      busyRef.current = false;
      if (activeRef.current) setBusy(false);
    }
  }

  return (
    <FormShell title="訪問記録を追加" onBack={() => { if (!busyRef.current) { if (saveStartedRef.current) onSaved(); else onBack(); } }}>
      <Card className="border border-stone-200/40 bg-white/90 rounded-2xl p-4 shadow-sm sm:p-6">
        <form className="grid gap-5 md:grid-cols-2" onSubmit={save}>
          <fieldset disabled={busy || saveLocked} className="contents">
            <Field label="訪問日">
              <Input className="h-11 rounded-xl bg-stone-50/50 border-stone-200/60 font-medium cursor-pointer" type="date" value={form.visited_at} onChange={(event) => setForm({ ...form, visited_at: event.target.value })} />
            </Field>
            <Field label="食べた料理">
              <Input className="h-11 rounded-xl bg-stone-50/50 border-stone-200/60" placeholder="例: 特製醤油ラーメン" value={form.dish_name} onChange={(event) => setForm({ ...form, dish_name: event.target.value })} />
            </Field>
            <Field label="評価">
              <StarPicker value={form.rating} onChange={(rating) => setForm({ ...form, rating })} />
            </Field>
            <Field className="md:col-span-2" label="写真">
              <PhotoPicker
                photos={photoDrafts}
                onChange={updatePhotoDrafts}
                onAddFiles={(selectedFiles) => void handlePhotoFiles(selectedFiles)}
                disabled={busy || saveLocked}
                hasExistingPhotos={Boolean(restaurant.photos?.length)}
              />
              {photoDateNotice && <p className="mt-2 flex items-start gap-2 rounded-xl bg-emerald-50/70 p-3 text-xs leading-relaxed text-emerald-800"><CalendarDays className="mt-0.5 size-3.5 shrink-0" />{photoDateNotice}</p>}
            </Field>
            <Field className="md:col-span-2" label="感想・訪問メモ">
              <Textarea className="rounded-xl bg-stone-50/50 border-stone-200/60 min-h-[100px]" placeholder="料理の味、サービス、混雑状況など..." value={form.memo} onChange={(event) => setForm({ ...form, memo: event.target.value })} />
            </Field>
            <Field className="md:col-span-2" label="写真のキャプション">
              <Input className="h-11 rounded-xl bg-stone-50/50 border-stone-200/60" placeholder="例: 絶品のチャーシュー" value={form.caption} onChange={(event) => setForm({ ...form, caption: event.target.value })} />
            </Field>
          </fieldset>
          <Button className="md:col-span-2 h-11 font-bold rounded-xl shadow-sm press-effect" disabled={busy} type="submit">
            <Camera className="size-4" />
            {busy ? "保存しています..." : saveLocked ? "保存を再試行" : "訪問記録を保存する"}
          </Button>
          {message && <div className="md:col-span-2"><MessageBanner message={message} /></div>}
        </form>
      </Card>
    </FormShell>
  );
}

/* ========================================
   Account Panel
   ======================================== */

function AccountPanel({
  authBusy,
  cleanupBusy,
  duplicateCandidates,
  email,
  genreBusy,
  genreProgress,
  isPasswordRecovery,
  mergeBusy,
  missingGenreCount,
  newPassword,
  onBack,
  onCleanupDuplicates,
  onEnrichGenres,
  onMergeDuplicate,
  onNewPasswordChange,
  onSubmit,
}: {
  authBusy: boolean;
  cleanupBusy: boolean;
  duplicateCandidates: DuplicateRestaurantCandidate[];
  email: string;
  genreBusy: boolean;
  genreProgress: { done: number; total: number; updated: number };
  isPasswordRecovery: boolean;
  mergeBusy: boolean;
  missingGenreCount: number;
  newPassword: string;
  onBack: () => void;
  onCleanupDuplicates: () => void;
  onEnrichGenres: () => void;
  onMergeDuplicate: (candidate: DuplicateRestaurantCandidate) => void;
  onNewPasswordChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <FormShell title="アカウント設定" onBack={onBack}>
      <Card className="mx-auto max-w-xl space-y-5 border border-stone-200/40 bg-white/90 rounded-2xl p-4 shadow-sm sm:p-6">
        <div>
          <p className="text-[10px] font-semibold text-stone-400 tracking-wider uppercase">サインイン中</p>
          <p className="font-semibold text-stone-800 text-sm mt-0.5">{email}</p>
        </div>
        <form className="space-y-5 pt-3 border-t border-stone-100/80" onSubmit={onSubmit}>
          <Field label={isPasswordRecovery ? "新しいパスワード" : "パスワードの変更"}>
            <Input className="h-11 rounded-xl bg-stone-50/50 border-stone-200/60" autoComplete="new-password" placeholder="新しいパスワード" type="password" value={newPassword} onChange={(event) => onNewPasswordChange(event.target.value)} />
          </Field>
          <Button className="h-11 rounded-xl press-effect w-full sm:w-auto" disabled={authBusy} type="submit">
            <KeyRound className="size-4" />
            パスワードを更新
          </Button>
        </form>
        <div className="space-y-3 border-t border-stone-100/80 pt-5">
          <div className="flex items-start gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-accent/10 text-accent"><Sparkles className="size-5" /></span>
            <div><p className="text-sm font-bold text-stone-800">ジャンルを一括補完</p><p className="mt-1 text-xs leading-5 text-stone-500">既存ジャンルは上書きせず、Googleの店舗情報と店名から未設定{missingGenreCount}件を推定します。</p></div>
          </div>
          {genreBusy && <div><div className="h-2 overflow-hidden rounded-full bg-stone-100"><div className="h-full rounded-full bg-accent transition-[width] duration-300" style={{ width: `${genreProgress.total ? (genreProgress.done / genreProgress.total) * 100 : 0}%` }} /></div><p className="mt-1.5 text-right text-[10px] font-bold tabular-nums text-accent">{genreProgress.done} / {genreProgress.total}件 · 補完{genreProgress.updated}件</p></div>}
          <Button className="h-11 rounded-xl press-effect w-full sm:w-auto" disabled={genreBusy || missingGenreCount === 0} type="button" variant="outline" onClick={onEnrichGenres}>
            <Sparkles className="size-4" />
            {genreBusy ? "ジャンルを判定中…" : `未設定${missingGenreCount}件をすべて補完`}
          </Button>
        </div>
        <div className="space-y-3 border-t border-stone-100/80 pt-5">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-stone-400">データ整理</p>
            <p className="mt-1 text-sm font-bold text-stone-800">重複候補 {duplicateCandidates.length}組</p>
            <p className="mt-1 text-xs leading-5 text-stone-500">統合しても両方の写真・訪問履歴・タグは残ります。候補ごとに内容を確認してから実行できます。</p>
          </div>
          {duplicateCandidates.length > 0 && <div className="space-y-2">{duplicateCandidates.slice(0, 20).map((candidate) => (
            <div key={`${candidate.keeper.id}-${candidate.duplicate.id}`} className="rounded-2xl border border-stone-200/70 bg-stone-50/70 p-3">
              <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate text-sm font-bold text-stone-800">{candidate.keeper.name}</p><p className="truncate text-[10px] text-stone-400">{candidate.keeper.area || "住所未設定"}</p></div><Badge className={candidate.confidence === "high" ? "border-0 bg-primary/10 text-primary" : "border-0 bg-amber-100 text-amber-700"}>{candidate.confidence === "high" ? "高確度" : "要確認"}</Badge></div>
              <div className="my-2 flex items-center gap-2 text-[10px] text-stone-400"><span className="h-px flex-1 bg-stone-200" /><span>{candidate.reason}</span><span className="h-px flex-1 bg-stone-200" /></div>
              <p className="truncate text-xs font-semibold text-stone-600">統合する側: {candidate.duplicate.name} · 写真{candidate.duplicate.photos?.length ?? 0}枚</p>
              <Button className="mt-3 h-9 w-full rounded-xl" disabled={mergeBusy} size="sm" type="button" variant="outline" onClick={() => onMergeDuplicate(candidate)}>この2件を統合</Button>
            </div>
          ))}</div>}
          <Button className="h-11 rounded-xl press-effect w-full sm:w-auto" disabled={cleanupBusy} type="button" variant="outline" onClick={onCleanupDuplicates}>
            <Trash2 className="size-4" />
            写真なしの完全一致だけ自動整理
          </Button>
        </div>
      </Card>
    </FormShell>
  );
}

/* ========================================
   CSV Import Panel
   ======================================== */

function MogurecoImportPanel({
  restaurants,
  onBack,
  onImported,
}: {
  restaurants: Restaurant[];
  onBack: () => void;
  onImported: () => void;
}) {
  const [records, setRecords] = useState<MogurecoImportRecord[]>([]);
  const [imageSummary, setImageSummary] = useState<MogurecoImageImportSummary<File> | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [fileName, setFileName] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState("");
  const [uploadProgress, setUploadProgress] = useState({ done: 0, total: 0 });

  async function readCsv(file: File | undefined) {
    setResult("");
    setRecords([]);
    setErrors([]);
    setFileName(file?.name ?? "");
    if (!file) return;

    const parsed = parseMogurecoCsv(await file.text());
    setRecords(parsed.records);
    setErrors(parsed.errors);
  }

  function readImageFolder(files: FileList | null) {
    setResult("");
    setUploadProgress({ done: 0, total: 0 });
    setImageSummary(files?.length ? getMogurecoImageImportSummary(Array.from(files)) : null);
  }

  async function importRecords() {
    const client = getSupabase();
    const { data: user } = await client.auth.getUser();
    const userId = user.user?.id;
    if (!userId || (!records.length && !imageSummary?.files.length)) return;

    setBusy(true);
    setResult("");
    setUploadProgress({ done: 0, total: imageSummary?.files.length ?? 0 });

    const existing = new Map(restaurants.map((restaurant) => [restaurantKey(restaurant.name, restaurant.area), restaurant]));
    const byName = new Map(restaurants.map((restaurant) => [normalizeRestaurantName(restaurant.name), restaurant]));
    let imported = 0;
    let skippedVisits = 0;
    let uploadedPhotos = 0;
    let skippedPhotos = 0;

    for (const record of records) {
      const key = restaurantKey(record.name, record.address);
      let restaurant = existing.get(key);

      if (!restaurant) {
        const { data, error } = await client
          .from("restaurants")
          .insert({
            user_id: userId,
            name: record.name,
            area: record.address || null,
            genre: null,
            genre_source: null,
            genre_confidence: null,
            genre_raw: null,
            status: "visited",
            rating: record.rating,
            memo: record.memo || null,
          })
          .select("*, tags(*), visits(*), photos(*)")
          .single();

        if (error) {
          setErrors((current) => [...current, `${record.name}: ${error.message}`]);
          continue;
        }

        restaurant = data as Restaurant;
        existing.set(key, restaurant);
        byName.set(normalizeRestaurantName(restaurant.name), restaurant);
      } else {
        await client
          .from("restaurants")
          .update({
            status: "visited",
            rating: record.rating,
            memo: record.memo || restaurant.memo,
            updated_at: new Date().toISOString(),
          })
          .eq("id", restaurant.id);
        byName.set(normalizeRestaurantName(restaurant.name), restaurant);
      }

      const alreadyVisited = record.visitedAt ? restaurant.visits?.some((visit) => visit.visited_at === record.visitedAt) : false;
      if (record.visitedAt && !alreadyVisited) {
        const { data: visit, error } = await client
          .from("visits")
          .insert({
            user_id: userId,
            restaurant_id: restaurant.id,
            visited_at: record.visitedAt,
            dish_name: null,
            rating: record.rating,
            memo: record.memo || null,
          })
          .select()
          .single();

        if (error) {
          setErrors((current) => [...current, `${record.name}: ${error.message}`]);
          continue;
        }

        restaurant.visits = [...(restaurant.visits ?? []), visit as Visit];
      } else if (alreadyVisited) {
        skippedVisits += 1;
      }

      for (const name of [...new Set(record.tags)]) {
        const { data: tag } = await client
          .from("tags")
          .upsert({ user_id: userId, name }, { onConflict: "user_id,name" })
          .select()
          .single();
        if (tag) {
          await client
            .from("restaurant_tags")
            .upsert({ restaurant_id: restaurant.id, tag_id: tag.id, user_id: userId }, { onConflict: "restaurant_id,tag_id" });
        }
      }

      imported += 1;
    }

    if (imageSummary?.files.length) {
      for (const imageFile of imageSummary.files) {
        const restaurant = byName.get(normalizeRestaurantName(imageFile.restaurantName));
        if (!restaurant) {
          skippedPhotos += 1;
          setUploadProgress((current) => ({ ...current, done: current.done + 1 }));
          continue;
        }

        const visitId = imageFile.visitedAt
          ? restaurant.visits?.find((visit) => visit.visited_at === imageFile.visitedAt)?.id ?? null
          : null;
        let optimizedFile: File;
        try {
          optimizedFile = (await optimizePhotoFile(imageFile.file, { force: true })).file;
        } catch (error) {
          skippedPhotos += 1;
          setErrors((current) => [...current, `${imageFile.relativePath}: ${error instanceof Error ? error.message : "画像を圧縮できませんでした。"}`]);
          setUploadProgress((current) => ({ ...current, done: current.done + 1 }));
          continue;
        }

        const storagePath = `${userId}/${restaurant.id}/bitelog/${crypto.randomUUID()}-${sanitizeStorageFileName(optimizedFile.name)}`;
        const { error: uploadError } = await client.storage.from("food-photos").upload(storagePath, optimizedFile, {
          cacheControl: PHOTO_CACHE_CONTROL_SECONDS,
          contentType: optimizedFile.type,
          upsert: false,
        });

        if (uploadError) {
          skippedPhotos += 1;
          setErrors((current) => [...current, `${imageFile.relativePath}: ${uploadError.message}`]);
          setUploadProgress((current) => ({ ...current, done: current.done + 1 }));
          continue;
        }

        const { error: photoError } = await client.from("photos").insert({
          user_id: userId,
          restaurant_id: restaurant.id,
          visit_id: visitId,
          storage_path: storagePath,
          caption: imageFile.file.name,
        });

        if (photoError) {
          // The row may have committed before its response was lost. Keep the
          // object so an acknowledged-late photo never points to deleted data.
          skippedPhotos += 1;
          setErrors((current) => [...current, `${imageFile.relativePath}: 保存結果を確認できませんでした。一覧で写真を確認してください。${photoError.message}`]);
        } else {
          uploadedPhotos += 1;
        }
        setUploadProgress((current) => ({ ...current, done: current.done + 1 }));
      }
    }

    setBusy(false);
    setResult([
      `${imported}件の店舗/訪問をインポートしました。`,
      uploadedPhotos ? `${uploadedPhotos}枚の画像をアップロードしました。` : "",
      skippedVisits ? `重複する訪問日は${skippedVisits}件スキップしました。` : "",
      skippedPhotos ? `画像は${skippedPhotos}枚スキップしました。` : "",
    ].filter(Boolean).join(" "));
    onImported();
  }

  const canImport = records.length > 0 || (imageSummary?.files.length ?? 0) > 0;
  const folderInputProps = { webkitdirectory: "", directory: "" };

  return (
    <FormShell title="CSVインポート" onBack={onBack}>
      <Card className="space-y-5 border border-stone-200/40 bg-white/90 rounded-2xl p-4 shadow-sm sm:p-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="CSVファイル">
            <Input className="h-11 rounded-xl bg-stone-50/50 border-stone-200/60 file:bg-stone-200/50 file:border-none file:text-xs file:font-semibold cursor-pointer" accept=".csv,text/csv" type="file" onChange={(event) => void readCsv(event.target.files?.[0])} />
          </Field>
          <Field label="画像フォルダ">
            <Input
              {...folderInputProps}
              className="h-11 rounded-xl bg-stone-50/50 border-stone-200/60 file:bg-stone-200/50 file:border-none file:text-xs file:font-semibold cursor-pointer"
              accept="image/*,.heic,.heif"
              type="file"
              multiple
              onChange={(event) => readImageFolder(event.target.files)}
            />
          </Field>
        </div>

        {fileName && (
          <div className="grid gap-3 rounded-xl bg-stone-50/80 p-3 text-xs md:grid-cols-3 text-stone-600">
            <span className="truncate font-semibold text-stone-800">{fileName}</span>
            <span>{records.length} 件のレコードを検出</span>
            <span className={errors.length > 0 ? "text-red-600 font-semibold" : "text-stone-400"}>
              {errors.length} 件のエラー
            </span>
          </div>
        )}

        {errors.length > 0 && (
          <div className="max-h-36 overflow-auto rounded-xl bg-red-50/50 p-3 text-xs text-red-800">
            {errors.map((error, index) => <p key={index} className="font-light">{error}</p>)}
          </div>
        )}

        {imageSummary && (
          <div className="grid gap-3 rounded-xl border border-stone-200/40 bg-white p-3.5 text-xs md:grid-cols-4 text-stone-600">
            <span className="flex items-center gap-1.5 font-bold text-stone-700">
              <FolderOpen className="size-3.5 text-primary" />
              画像フォルダ
            </span>
            <span>対象: {imageSummary.files.length} 枚</span>
            <span>検出: {imageSummary.restaurantCount} 店舗</span>
            <span className="font-medium text-stone-500">{formatBytes(imageSummary.totalBytes)}</span>
            {imageSummary.skippedCount > 0 && (
              <span className="text-amber-700/90 font-light md:col-span-4 mt-1">
                画像以外のファイル（{imageSummary.skippedCount} 件）は自動で除外されます。
              </span>
            )}
          </div>
        )}

        {records.length > 0 && (
          <div className="overflow-hidden rounded-xl border border-stone-200/40">
            <div className="grid grid-cols-[1.2fr_0.8fr_0.5fr] bg-stone-50 px-3 py-2.5 text-[10px] font-bold text-stone-400 uppercase tracking-wider md:grid-cols-[1.4fr_0.8fr_0.5fr_1.3fr] border-b border-stone-100">
              <span>店舗名</span>
              <span>訪問日</span>
              <span>評価</span>
              <span className="hidden md:block">住所</span>
            </div>
            <div className="max-h-60 overflow-auto divide-y divide-stone-100/80">
              {records.slice(0, 100).map((record, index) => (
                <div key={index} className="grid grid-cols-[1.2fr_0.8fr_0.5fr] px-3 py-2 text-xs md:grid-cols-[1.4fr_0.8fr_0.5fr_1.3fr] text-stone-600 hover:bg-stone-50/50 transition-colors">
                  <span className="truncate font-semibold text-stone-800">{record.name}</span>
                  <span className="font-light">{record.visitedAt ?? "-"}</span>
                  <span className="font-semibold text-amber-600">{record.rating ?? "-"}</span>
                  <span className="hidden truncate font-light md:block">{record.address || "-"}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {busy && uploadProgress.total > 0 && (
          <div className="space-y-2 rounded-xl bg-stone-50/80 p-3.5 text-xs">
            <div className="flex items-center justify-between gap-3 text-stone-600">
              <span className="flex items-center gap-1.5 font-bold">
                <ImageIcon className="size-3.5 text-primary" />
                画像をアップロード中...
              </span>
              <span className="font-semibold tabular-nums">{uploadProgress.done} / {uploadProgress.total}</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-stone-200/60">
              <div
                className="h-full bg-primary transition-all duration-300 rounded-full"
                style={{ width: `${uploadProgress.total ? (uploadProgress.done / uploadProgress.total) * 100 : 0}%` }}
              />
            </div>
          </div>
        )}

        {result && <MessageBanner message={{ text: result, type: "success" }} />}

        <Button className="h-11 rounded-xl press-effect shadow-sm" disabled={busy || !canImport} type="button" onClick={importRecords}>
          <Upload className="size-4" />
          インポート処理を開始
        </Button>
      </Card>
    </FormShell>
  );
}

/* ========================================
   Utility Components
   ======================================== */

function restaurantKey(name: string, area: string | null) {
  return `${name.trim()}\u0000${(area ?? "").trim()}`;
}

function normalizeRestaurantName(name: string) {
  return name.trim().normalize("NFKC").toLowerCase();
}

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

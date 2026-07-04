/* eslint-disable @next/next/no-img-element */
"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Camera,
  FolderOpen,
  Image as ImageIcon,
  KeyRound,
  Lock,
  LogOut,
  MapPin,
  Plus,
  Search,
  Settings,
  SlidersHorizontal,
  Star,
  Trash2,
  Utensils,
  Upload,
} from "lucide-react";
import { createClient } from "@/lib/supabase";
import { getFriendlyAuthError, getPasswordValidation, getRedirectUrl } from "@/lib/auth";
import { createVisitPhotoUploads, sanitizeStorageFileName } from "@/lib/photo-upload";
import { deleteRestaurantWithAssets } from "@/lib/restaurant-delete";
import { getDuplicateRestaurantCleanupPlan } from "@/lib/restaurant-dedupe";
import { sortRestaurants, type SortMode } from "@/lib/restaurant-sort";
import {
  getMogurecoImageImportSummary,
  parseMogurecoCsv,
  type MogurecoImageImportSummary,
  type MogurecoImportRecord,
} from "@/lib/mogureco-import";
import type { Photo, Restaurant, RestaurantStatus, Tag, Visit } from "@/types/database";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type View = "list" | "new" | "detail" | "visit" | "account" | "import";
type AuthMode = "login" | "setup";
type Message = { text: string; type: "neutral" | "success" | "error" };

const supabase = createClient();
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://log-project-psi.vercel.app";

function getSupabase() {
  if (!supabase) {
    throw new Error("Supabase is not configured.");
  }

  return supabase;
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
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);
  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"all" | RestaurantStatus>("all");
  const [sortMode, setSortMode] = useState<SortMode>("newest");
  const [view, setView] = useState<View>("list");
  const [selected, setSelected] = useState<Restaurant | null>(null);

  useEffect(() => {
    if (!supabase) return;

    const params = new URLSearchParams(window.location.hash.slice(1));
    const authError = params.get("error_description");
    const recoveryType = params.get("type");
    if (authError) {
      setMessage({ text: decodeURIComponent(authError.replace(/\+/g, " ")), type: "error" });
    }
    if (recoveryType === "recovery") {
      setIsPasswordRecovery(true);
      setView("account");
    }

    supabase.auth.getSession().then(({ data, error }) => {
      if (error) {
        setMessage({ text: getFriendlyAuthError(error.message), type: "error" });
      }
      setUserId(data.session?.user.id ?? null);
      setUserEmail(data.session?.user.email ?? "");
      setLoading(false);
    });

    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY") {
        setIsPasswordRecovery(true);
        setView("account");
        setMessage({ text: "新しいパスワードを設定してください。", type: "success" });
      }
      setUserId(session?.user.id ?? null);
      setUserEmail(session?.user.email ?? "");
    });

    return () => data.subscription.unsubscribe();
  }, []);

  const loadRestaurants = useCallback(async () => {
    const client = getSupabase();
    const { data, error } = await client
      .from("restaurants")
      .select("*, tags(*), visits(*), photos(*)")
      .order("updated_at", { ascending: false });

    if (error) {
      setMessage({ text: error.message, type: "error" });
      return [];
    }

    const next = (data ?? []) as Restaurant[];
    setRestaurants(next);
    return next;
  }, []);

  useEffect(() => {
    if (userId) void loadRestaurants();
  }, [loadRestaurants, userId]);

  const stats = useMemo(() => {
    const visited = restaurants.filter((restaurant) => restaurant.status === "visited").length;
    const wishlist = restaurants.filter((restaurant) => restaurant.status === "wishlist").length;
    const photos = restaurants.reduce((sum, restaurant) => sum + (restaurant.photos?.length ?? 0), 0);
    return { total: restaurants.length, visited, wishlist, photos };
  }, [restaurants]);

  const filtered = useMemo(() => {
    const next = restaurants.filter((restaurant) => {
      const haystack = [
        restaurant.name,
        restaurant.area,
        restaurant.genre,
        ...(restaurant.tags?.map((tag: Tag) => tag.name) ?? []),
      ].join(" ").toLowerCase();

      return (status === "all" || restaurant.status === status) && haystack.includes(query.toLowerCase());
    });

    return sortRestaurants(next, sortMode);
  }, [restaurants, query, status, sortMode]);

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
    setView("list");
  }

  async function signOut() {
    await getSupabase().auth.signOut();
    setUserId(null);
    setUserEmail("");
    setView("list");
    setSelected(null);
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

  async function deleteRestaurant(restaurant: Restaurant) {
    setDeleteBusy(true);
    setMessage(null);

    try {
      await deleteRestaurantWithAssets(getSupabase(), restaurant);
      setSelected(null);
      setView("list");
      setMessage({ text: `${restaurant.name}を削除しました。`, type: "success" });
      await loadRestaurants();
    } catch (error) {
      setMessage({ text: error instanceof Error ? error.message : "店舗を削除できませんでした。", type: "error" });
    } finally {
      setDeleteBusy(false);
    }
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
    <Shell>
      <AppHeader
        email={userEmail}
        query={query}
        onAdd={() => setView("new")}
        onAccount={() => setView("account")}
        onImport={() => setView("import")}
        onQueryChange={setQuery}
        onSignOut={signOut}
      />

      {message && <div className="mx-auto max-w-6xl animate-in"><MessageBanner message={message} /></div>}

      {view === "list" && (
        <div className="animate-fade">
          <Dashboard stats={stats} />
          <ListControls
            sortMode={sortMode}
            status={status}
            onSortModeChange={setSortMode}
            onStatusChange={setStatus}
          />
          <section className="mx-auto mt-5 max-w-6xl grid gap-3 md:grid-cols-2">
            {filtered.map((restaurant, i) => (
              <RestaurantCard
                key={restaurant.id}
                restaurant={restaurant}
                index={i}
                onClick={() => {
                  setSelected(restaurant);
                  setView("detail");
                }}
              />
            ))}
          </section>
          {!filtered.length && <EmptyState onAdd={() => setView("new")} />}
          <button
            className="safe-bottom fixed bottom-5 right-5 z-50 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg shadow-primary/25 press-effect hover-lift md:hidden"
            onClick={() => setView("new")}
          >
            <Plus className="size-5" />
          </button>
        </div>
      )}

      {view === "new" && (
        <div className="animate-in">
          <RestaurantForm
            onBack={() => setView("list")}
            onSaved={() => {
              setView("list");
              void loadRestaurants();
            }}
          />
        </div>
      )}

      {view === "import" && (
        <div className="animate-in">
          <MogurecoImportPanel
            restaurants={restaurants}
            onBack={() => setView("list")}
            onImported={() => void loadRestaurants()}
          />
        </div>
      )}

      {view === "detail" && selected && (
        <div className="animate-in">
          <RestaurantDetail
            deleteBusy={deleteBusy}
            restaurant={selected}
            onAddVisit={() => setView("visit")}
            onBack={() => setView("list")}
            onDelete={() => void deleteRestaurant(selected)}
          />
        </div>
      )}

      {view === "visit" && selected && (
        <div className="animate-in">
          <VisitForm
            restaurant={selected}
            onBack={() => setView("detail")}
            onSaved={async () => {
              const next = await loadRestaurants();
              const current = next.find((restaurant) => restaurant.id === selected.id);
              setSelected(current ?? selected);
              setView("detail");
            }}
          />
        </div>
      )}

      {view === "account" && (
        <div className="animate-in">
          <AccountPanel
            authBusy={authBusy}
            cleanupBusy={cleanupBusy}
            email={userEmail}
            isPasswordRecovery={isPasswordRecovery}
            newPassword={newPassword}
            onBack={() => setView("list")}
            onCleanupDuplicates={cleanupDuplicateRestaurants}
            onNewPasswordChange={setNewPassword}
            onSubmit={updatePassword}
          />
        </div>
      )}
    </Shell>
  );
}

/* ========================================
   Shell & Layout
   ======================================== */

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen px-4 py-5 text-foreground md:px-8 md:py-8 flex flex-col justify-start">
      {children}
    </main>
  );
}

/* ========================================
   Auth Screen
   ======================================== */

function AuthScreen({
  authBusy,
  authMode,
  email,
  message,
  password,
  onEmailChange,
  onLogin,
  onModeChange,
  onPasswordChange,
  onSetup,
}: {
  authBusy: boolean;
  authMode: AuthMode;
  email: string;
  message: Message | null;
  password: string;
  onEmailChange: (value: string) => void;
  onLogin: (event: FormEvent<HTMLFormElement>) => void;
  onModeChange: (mode: AuthMode) => void;
  onPasswordChange: (value: string) => void;
  onSetup: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <main className="min-h-screen flex items-center justify-center p-4 sm:p-6 md:p-10">
      <div className="w-full max-w-5xl overflow-hidden rounded-3xl bg-white shadow-2xl shadow-stone-300/30 lg:grid lg:grid-cols-[1.15fr_0.85fr] min-h-[580px] animate-scale">
        {/* 左側: ビジュアル */}
        <section className="relative min-h-[280px] overflow-hidden bg-stone-900 text-white lg:min-h-full flex flex-col justify-between p-8 md:p-10">
          <img
            alt="BiteLogの食事記録イメージ"
            className="absolute inset-0 size-full object-cover opacity-50 transition duration-1000 hover:scale-105"
            src="/images/bitelog-hero.png"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-stone-950/90 via-stone-900/40 to-stone-800/20" />

          <div className="relative z-10">
            <div className="inline-flex items-center gap-2.5 rounded-full border border-white/15 bg-white/10 px-4 py-2 text-[11px] font-semibold tracking-widest uppercase backdrop-blur-xl">
              <BrandMark className="size-5 rounded-md" />
              <span>BiteLog</span>
            </div>
          </div>

          <div className="relative z-10 max-w-md mt-auto space-y-5">
            <h1 className="text-3xl font-extrabold tracking-tight leading-[1.2] md:text-[2.5rem] text-white">
              日常の美食を、
              <br />
              美しい記憶のままに。
            </h1>
            <p className="text-[13px] leading-relaxed text-white/60 font-light max-w-sm">
              お気に入りの店、心に残った料理。BiteLogは、あなたの美味しい体験を写真と文字で残すプライベートログです。
            </p>
            <div className="flex gap-6 pt-2 text-white/50 text-[11px] tracking-wide uppercase font-medium">
              <span>Import</span>
              <span className="text-white/20">—</span>
              <span>Archive</span>
              <span className="text-white/20">—</span>
              <span>Discover</span>
            </div>
          </div>
        </section>

        {/* 右側: フォーム */}
        <section className="flex flex-col justify-between p-8 md:p-10">
          <div className="my-auto space-y-7">
            <div className="space-y-1.5">
              <h2 className="text-[1.6rem] font-bold tracking-tight text-stone-800">サインイン</h2>
              <p className="text-[13px] text-stone-400 font-light">アカウントにログインして始めましょう。</p>
            </div>

            <div className="flex rounded-xl bg-stone-100/80 p-1">
              <button
                className={`h-9 flex-1 rounded-lg text-xs font-semibold transition-all duration-200 ${authMode === "login" ? "bg-white text-stone-800 shadow-sm" : "text-stone-400 hover:text-stone-600"}`}
                type="button"
                onClick={() => onModeChange("login")}
              >
                ログイン
              </button>
              <button
                className={`h-9 flex-1 rounded-lg text-xs font-semibold transition-all duration-200 ${authMode === "setup" ? "bg-white text-stone-800 shadow-sm" : "text-stone-400 hover:text-stone-600"}`}
                type="button"
                onClick={() => onModeChange("setup")}
              >
                パスワード設定
              </button>
            </div>

            {message && <MessageBanner message={message} />}

            {authMode === "login" ? (
              <form className="space-y-5" onSubmit={onLogin}>
                <Field label="メールアドレス">
                  <Input className="h-11 rounded-xl bg-stone-50/80 border-stone-200/60 text-sm" autoComplete="email" placeholder="name@example.com" type="email" value={email} onChange={(event) => onEmailChange(event.target.value)} />
                </Field>
                <Field label="パスワード">
                  <Input className="h-11 rounded-xl bg-stone-50/80 border-stone-200/60 text-sm" autoComplete="current-password" placeholder="••••••••" type="password" value={password} onChange={(event) => onPasswordChange(event.target.value)} />
                </Field>
                <Button className="w-full h-11 font-bold rounded-xl shadow-sm press-effect" disabled={authBusy} type="submit">
                  <Lock className="size-4" />
                  サインイン
                </Button>
              </form>
            ) : (
              <form className="space-y-5" onSubmit={onSetup}>
                <Field label="メールアドレス">
                  <Input className="h-11 rounded-xl bg-stone-50/80 border-stone-200/60 text-sm" autoComplete="email" placeholder="name@example.com" type="email" value={email} onChange={(event) => onEmailChange(event.target.value)} />
                </Field>
                <Button className="w-full h-11 font-bold rounded-xl shadow-sm press-effect" disabled={authBusy} type="submit">
                  <KeyRound className="size-4" />
                  設定用の案内を送る
                </Button>
              </form>
            )}
          </div>

          <div className="pt-8 text-center">
            <p className="text-[11px] text-stone-300 tracking-wide">&copy; {new Date().getFullYear()} BITELOG</p>
          </div>
        </section>
      </div>
    </main>
  );
}

/* ========================================
   App Header（検索バー統合）
   ======================================== */

function AppHeader({
  email,
  query,
  onAccount,
  onAdd,
  onImport,
  onQueryChange,
  onSignOut,
}: {
  email: string;
  query: string;
  onAccount: () => void;
  onAdd: () => void;
  onImport: () => void;
  onQueryChange: (query: string) => void;
  onSignOut: () => void;
}) {
  return (
    <header className="mx-auto mb-6 flex max-w-6xl items-center gap-3 rounded-2xl glass-card px-4 py-3 shadow-sm animate-in">
      {/* ロゴ */}
      <div className="flex items-center gap-2.5 shrink-0">
        <BrandMark className="size-9 rounded-xl shadow-sm" />
        <div className="hidden sm:block min-w-0">
          <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-stone-400">Food Journal</p>
          <h1 className="text-sm font-bold text-stone-800 -mt-0.5">BiteLog</h1>
        </div>
      </div>

      {/* 検索バー */}
      <div className="relative flex-1 max-w-md mx-auto">
        <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-stone-400" />
        <input
          className="h-9 w-full rounded-xl border-0 bg-stone-100/60 pl-9 pr-3 text-xs text-stone-700 placeholder:text-stone-400 outline-none transition-all duration-200 focus:bg-white focus:ring-2 focus:ring-primary/15 focus:shadow-sm"
          placeholder="店名・エリア・ジャンルで検索..."
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
        />
      </div>

      {/* アクション */}
      <div className="flex items-center gap-1 shrink-0">
        <span className="hidden xl:inline text-[11px] text-stone-400 font-light truncate max-w-36 mr-1">{email}</span>
        <Button className="hidden md:inline-flex text-xs h-8 rounded-xl shadow-sm press-effect" size="sm" onClick={onAdd}>
          <Plus className="size-3.5" />
          追加
        </Button>
        <IconButton label="CSVインポート" onClick={onImport}>
          <Upload className="size-4" />
        </IconButton>
        <IconButton label="アカウント" onClick={onAccount}>
          <Settings className="size-4" />
        </IconButton>
        <IconButton label="ログアウト" onClick={onSignOut}>
          <LogOut className="size-4" />
        </IconButton>
      </div>
    </header>
  );
}

function BrandMark({ className = "size-9 rounded-xl" }: { className?: string }) {
  return (
    <img
      alt=""
      aria-hidden="true"
      className={`shrink-0 object-cover ${className}`}
      src="/icons/icon-192.png"
    />
  );
}

function IconButton({ children, label, onClick }: { children: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      aria-label={label}
      className="grid size-8 place-items-center rounded-xl text-stone-400 transition-all duration-200 hover:bg-stone-100/80 hover:text-stone-700"
      type="button"
      onClick={onClick}
    >
      {children}
    </button>
  );
}

/* ========================================
   Dashboard（Hero + Summary 統合）
   ======================================== */

function Dashboard({ stats }: { stats: { total: number; visited: number; wishlist: number; photos: number } }) {
  return (
    <section className="mx-auto max-w-6xl mb-5 animate-in">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="すべての店" value={stats.total} delay={0} />
        <StatCard label="行った店" value={stats.visited} delay={1} />
        <StatCard label="行きたい店" value={stats.wishlist} delay={2} />
        <StatCard label="写真" value={stats.photos} delay={3} />
      </div>
    </section>
  );
}

function StatCard({ label, value, delay }: { label: string; value: number; delay: number }) {
  return (
    <div className={`group rounded-2xl border border-stone-200/50 bg-white/80 p-4 hover-lift animate-in delay-${delay + 1}`}>
      <p className="text-[10px] font-semibold text-stone-400 tracking-wider uppercase">{label}</p>
      <p className="mt-1.5 text-2xl font-extrabold text-stone-800 tabular-nums leading-none animate-count">{value}</p>
    </div>
  );
}

/* ========================================
   List Controls
   ======================================== */

function ListControls({
  sortMode,
  status,
  onSortModeChange,
  onStatusChange,
}: {
  sortMode: SortMode;
  status: "all" | RestaurantStatus;
  onSortModeChange: (sortMode: SortMode) => void;
  onStatusChange: (status: "all" | RestaurantStatus) => void;
}) {
  return (
    <section className="mx-auto max-w-6xl flex flex-wrap items-center gap-3 animate-in delay-3">
      {/* フィルターピル */}
      <div className="flex rounded-xl bg-stone-100/60 p-1">
        <FilterButton active={status === "all"} label="すべて" onClick={() => onStatusChange("all")} />
        <FilterButton active={status === "visited"} label="行った" onClick={() => onStatusChange("visited")} />
        <FilterButton active={status === "wishlist"} label="行きたい" onClick={() => onStatusChange("wishlist")} />
      </div>

      {/* ソート */}
      <div className="relative ml-auto">
        <SlidersHorizontal className="pointer-events-none absolute left-3 top-1/2 size-3 -translate-y-1/2 text-stone-400" />
        <select
          aria-label="並び替え"
          className="h-8 rounded-xl border-0 bg-stone-100/60 pl-8 pr-8 text-[11px] font-semibold text-stone-600 outline-none appearance-none cursor-pointer transition-all duration-200 focus:bg-white focus:ring-2 focus:ring-primary/15"
          value={sortMode}
          onChange={(event) => onSortModeChange(event.target.value as SortMode)}
        >
          <option value="newest">最新の更新順</option>
          <option value="rating">評価の高い順</option>
          <option value="visitDate">訪問日順</option>
        </select>
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-stone-400 text-[10px]">▼</span>
      </div>
    </section>
  );
}

function FilterButton({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      className={`h-7 rounded-lg px-4 text-[11px] font-semibold transition-all duration-200 ${
        active
          ? "bg-white text-stone-800 shadow-sm"
          : "text-stone-400 hover:text-stone-600"
      }`}
      type="button"
      onClick={onClick}
    >
      {label}
    </button>
  );
}

/* ========================================
   Restaurant Card
   ======================================== */

function RestaurantCard({ restaurant, index, onClick }: { restaurant: Restaurant; index: number; onClick: () => void }) {
  const latestPhoto = restaurant.photos?.[0];
  const delayClass = `delay-${Math.min(index + 1, 8)}`;

  return (
    <Card
      className={`group cursor-pointer overflow-hidden p-0 border border-stone-200/40 bg-white/90 rounded-2xl flex hover-lift press-effect animate-in ${delayClass}`}
      onClick={onClick}
    >
      <div className="flex gap-4 p-4 w-full">
        <RestaurantThumb photo={latestPhoto} name={restaurant.name} />

        <div className="min-w-0 flex-1 flex flex-col justify-between py-0.5 space-y-2">
          <div className="space-y-1.5">
            <div className="flex items-start justify-between gap-2">
              <h2 className="truncate text-[15px] font-bold text-stone-800 tracking-tight group-hover:text-primary transition-colors duration-200">
                {restaurant.name}
              </h2>
              <StatusBadge status={restaurant.status} />
            </div>

            <p className="flex items-center gap-1 truncate text-[11px] text-stone-400 font-light">
              <MapPin className="size-3 shrink-0" />
              <span>{restaurant.area || "エリア未設定"}</span>
              {restaurant.genre && (
                <>
                  <span className="text-stone-200 mx-0.5">·</span>
                  <span>{restaurant.genre}</span>
                </>
              )}
            </p>
          </div>

          <div className="flex items-center gap-3 text-[11px] text-stone-400">
            <Stars rating={restaurant.rating} />
            <span className="text-stone-200">·</span>
            <span className="font-light">{restaurant.visits?.length ?? 0} 回訪問</span>
            {(restaurant.photos?.length ?? 0) > 0 && (
              <>
                <span className="text-stone-200">·</span>
                <span className="flex items-center gap-0.5 font-light">
                  <Camera className="size-3" />
                  {restaurant.photos?.length}
                </span>
              </>
            )}
          </div>

          {(restaurant.tags?.length ?? 0) > 0 && (
            <div className="flex flex-wrap gap-1">
              {restaurant.tags?.slice(0, 3).map((tag) => (
                <span
                  key={tag.id}
                  className="inline-block rounded-md bg-stone-50 px-1.5 py-0.5 text-[10px] text-stone-500 font-light"
                >
                  #{tag.name}
                </span>
              ))}
              {(restaurant.tags?.length ?? 0) > 3 && (
                <span className="text-[10px] text-stone-300 font-light">+{(restaurant.tags?.length ?? 0) - 3}</span>
              )}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

function StatusBadge({ status }: { status: RestaurantStatus }) {
  return (
    <Badge
      className={`shrink-0 text-[10px] font-medium px-2 py-0.5 rounded-lg border-0 shadow-none ${
        status === "visited"
          ? "bg-primary/8 text-primary"
          : "bg-accent/8 text-accent"
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
  onDelete,
}: {
  deleteBusy: boolean;
  restaurant: Restaurant;
  onBack: () => void;
  onAddVisit: () => void;
  onDelete: () => void;
}) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  return (
    <FormShell title={restaurant.name} onBack={onBack}>
      <div className="grid gap-5 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="space-y-5">
          {/* 基本情報 */}
          <Card className="space-y-4 border border-stone-200/40 shadow-sm rounded-2xl p-5 bg-white/90">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-2">
                <p className="flex items-center gap-1.5 text-[11px] text-stone-400 font-light">
                  <MapPin className="size-3.5" />
                  <span>{restaurant.area || "エリア未設定"}</span>
                  <span className="text-stone-200 mx-0.5">·</span>
                  <span>{restaurant.genre || "ジャンル未設定"}</span>
                </p>
                <div className="flex items-center gap-3">
                  <Stars rating={restaurant.rating} />
                  <StatusBadge status={restaurant.status} />
                </div>
              </div>
              <div className="flex shrink-0 flex-wrap justify-end gap-2">
                <Button
                  size="sm"
                  onClick={() => setConfirmingDelete(true)}
                  className="rounded-xl border border-red-100 bg-red-50 text-xs text-red-600 shadow-none hover:bg-red-100"
                >
                  <Trash2 className="size-3.5" />
                  削除
                </Button>
                <Button size="sm" onClick={onAddVisit} className="rounded-xl shadow-sm press-effect text-xs">
                  <Utensils className="size-3.5" />
                  訪問記録を追加
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
            {restaurant.visits && restaurant.visits.length > 0 ? (
              <div className="relative border-l-[1.5px] border-stone-200/60 pl-6 ml-2 py-1 space-y-5">
                {restaurant.visits.map((visit: Visit, i: number) => (
                  <div key={visit.id} className={`relative animate-in delay-${Math.min(i + 1, 8)}`}>
                    <span className="absolute -left-[27px] top-1 flex h-3 w-3 items-center justify-center rounded-full bg-white border-[1.5px] border-primary">
                      <span className="h-1.5 w-1.5 rounded-full bg-primary timeline-dot" />
                    </span>
                    <div className="space-y-1">
                      <p className="text-[10px] font-semibold text-stone-400 tracking-wider uppercase">{visit.visited_at}</p>
                      <h4 className="text-sm font-semibold text-stone-800">{visit.dish_name || "料理名未入力"}</h4>
                      {visit.memo && <p className="text-xs leading-relaxed text-stone-500 font-light mt-1 max-w-xl">{visit.memo}</p>}
                      <div className="pt-0.5">
                        <Stars rating={visit.rating} />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-10 text-stone-300">
                <Utensils className="size-5 mb-2 opacity-50" />
                <p className="text-xs font-light">訪問記録がまだありません。</p>
              </div>
            )}
          </section>
        </div>

        {/* 写真ギャラリー */}
        <section className="space-y-4 border border-stone-200/40 shadow-sm rounded-2xl bg-white/90 p-5 h-fit">
          <h3 className="text-xs font-bold text-stone-500 tracking-widest uppercase pb-2 border-b border-stone-100/80">
            写真ギャラリー
          </h3>
          {restaurant.photos && restaurant.photos.length > 0 ? (
            <div className="grid gap-2 grid-cols-2">
              {restaurant.photos.map((photo, i) => (
                <div key={photo.id} className={`group relative overflow-hidden rounded-xl bg-stone-50 aspect-square animate-in delay-${Math.min(i + 1, 8)}`}>
                  <PhotoTile className="size-full object-cover transition duration-500 group-hover:scale-105" photo={photo} />
                  {photo.caption && (
                    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent p-3 pt-8 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                      <span className="text-[10px] text-white font-light truncate block">{photo.caption}</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-14 rounded-xl bg-stone-50/50 text-stone-300">
              <Camera className="size-6 mb-2 opacity-40" />
              <p className="text-xs font-light">写真が登録されていません。</p>
            </div>
          )}
        </section>
      </div>
    </FormShell>
  );
}

/* ========================================
   Restaurant Form
   ======================================== */

function RestaurantForm({ onBack, onSaved }: { onBack: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ name: "", area: "", genre: "", status: "visited" as RestaurantStatus, rating: "", memo: "", tags: "" });
  const [busy, setBusy] = useState(false);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const client = getSupabase();
    const { data: user } = await client.auth.getUser();
    const userId = user.user?.id;
    if (!userId || !form.name) return;

    setBusy(true);
    const { data: restaurant, error } = await client
      .from("restaurants")
      .insert({
        user_id: userId,
        name: form.name,
        area: form.area || null,
        genre: form.genre || null,
        status: form.status,
        rating: form.rating ? Number(form.rating) : null,
        memo: form.memo || null,
      })
      .select()
      .single();

    if (!error && restaurant) {
      const tagNames = form.tags.split(/[、,\s]+/).filter(Boolean);
      for (const name of tagNames) {
        const { data: tag } = await client
          .from("tags")
          .upsert({ user_id: userId, name }, { onConflict: "user_id,name" })
          .select()
          .single();
        if (tag) await client.from("restaurant_tags").insert({ restaurant_id: restaurant.id, tag_id: tag.id, user_id: userId });
      }
      onSaved();
    }
    setBusy(false);
  }

  return (
    <FormShell title="店舗を追加" onBack={onBack}>
      <Card className="border border-stone-200/40 bg-white/90 rounded-2xl p-6 shadow-sm">
        <form className="grid gap-5 md:grid-cols-2" onSubmit={save}>
          <Field label="店名">
            <Input className="h-11 rounded-xl bg-stone-50/50 border-stone-200/60" required placeholder="店名を入力" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
          </Field>
          <Field label="分類">
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
          </Field>
          <Field label="エリア">
            <Input className="h-11 rounded-xl bg-stone-50/50 border-stone-200/60" placeholder="例: 渋谷、恵比寿" value={form.area} onChange={(event) => setForm({ ...form, area: event.target.value })} />
          </Field>
          <Field label="ジャンル">
            <Input className="h-11 rounded-xl bg-stone-50/50 border-stone-200/60" placeholder="例: 和食、イタリアン" value={form.genre} onChange={(event) => setForm({ ...form, genre: event.target.value })} />
          </Field>
          <Field label="評価 (1 - 5)">
            <Input className="h-11 rounded-xl bg-stone-50/50 border-stone-200/60" max="5" min="0.5" placeholder="例: 4.5" step="0.5" type="number" value={form.rating} onChange={(event) => setForm({ ...form, rating: event.target.value })} />
          </Field>
          <Field label="タグ">
            <Input className="h-11 rounded-xl bg-stone-50/50 border-stone-200/60" placeholder="スペース区切り (例: ラーメン 渋谷)" value={form.tags} onChange={(event) => setForm({ ...form, tags: event.target.value })} />
          </Field>
          <Field className="md:col-span-2" label="メモ">
            <Textarea className="rounded-xl bg-stone-50/50 border-stone-200/60 min-h-[100px]" placeholder="店内の雰囲気、予算、おすすめメニューなど..." value={form.memo} onChange={(event) => setForm({ ...form, memo: event.target.value })} />
          </Field>
          <Button className="md:col-span-2 h-11 font-bold rounded-xl shadow-sm press-effect" disabled={busy} type="submit">店舗を保存する</Button>
        </form>
      </Card>
    </FormShell>
  );
}

/* ========================================
   Visit Form
   ======================================== */

function VisitForm({ restaurant, onBack, onSaved }: { restaurant: Restaurant; onBack: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ visited_at: new Date().toISOString().slice(0, 10), dish_name: "", rating: "", memo: "", caption: "" });
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const client = getSupabase();
    const { data: user } = await client.auth.getUser();
    const userId = user.user?.id;
    if (!userId) return;

    setBusy(true);
    setMessage(null);
    const { data: visit, error: visitError } = await client
      .from("visits")
      .insert({
        user_id: userId,
        restaurant_id: restaurant.id,
        visited_at: form.visited_at,
        dish_name: form.dish_name || null,
        rating: form.rating ? Number(form.rating) : null,
        memo: form.memo || null,
      })
      .select()
      .single();

    if (visitError || !visit) {
      setBusy(false);
      setMessage({ text: visitError?.message ?? "訪問記録を保存できませんでした。", type: "error" });
      return;
    }

    await client.from("restaurants").update({ status: "visited", updated_at: new Date().toISOString() }).eq("id", restaurant.id);

    const photoErrors: string[] = [];

    for (const upload of createVisitPhotoUploads({
      files,
      userId,
      restaurantId: restaurant.id,
      visitId: visit.id,
      caption: form.caption,
      createId: () => crypto.randomUUID(),
    })) {
      const { error: uploadError } = await client.storage.from("food-photos").upload(upload.path, upload.file);
      if (uploadError) {
        photoErrors.push(`${upload.file.name}: ${uploadError.message}`);
        continue;
      }

      const { error: photoError } = await client.from("photos").insert(upload.row);
      if (photoError) {
        photoErrors.push(`${upload.file.name}: ${photoError.message}`);
      }
    }

    if (photoErrors.length) {
      setBusy(false);
      setMessage({
        text: `訪問記録は保存しましたが、写真${photoErrors.length}枚の登録に失敗しました。${photoErrors.join(" / ")}`,
        type: "error",
      });
      return;
    }

    setBusy(false);
    onSaved();
  }

  return (
    <FormShell title="訪問記録を追加" onBack={onBack}>
      <Card className="border border-stone-200/40 bg-white/90 rounded-2xl p-6 shadow-sm">
        <form className="grid gap-5 md:grid-cols-2" onSubmit={save}>
          <Field label="訪問日">
            <Input className="h-11 rounded-xl bg-stone-50/50 border-stone-200/60 font-medium cursor-pointer" type="date" value={form.visited_at} onChange={(event) => setForm({ ...form, visited_at: event.target.value })} />
          </Field>
          <Field label="食べた料理">
            <Input className="h-11 rounded-xl bg-stone-50/50 border-stone-200/60" placeholder="例: 特製醤油ラーメン" value={form.dish_name} onChange={(event) => setForm({ ...form, dish_name: event.target.value })} />
          </Field>
          <Field label="評価 (1 - 5)">
            <Input className="h-11 rounded-xl bg-stone-50/50 border-stone-200/60" max="5" min="0.5" placeholder="例: 4.0" step="0.5" type="number" value={form.rating} onChange={(event) => setForm({ ...form, rating: event.target.value })} />
          </Field>
          <Field label="写真">
            <Input
              className="h-11 rounded-xl bg-stone-50/50 border-stone-200/60 file:bg-stone-200/50 file:border-none file:text-xs file:font-semibold cursor-pointer"
              accept="image/*"
              multiple
              type="file"
              onChange={(event) => setFiles(Array.from(event.target.files ?? []))}
            />
            {files.length > 0 && (
              <div className="mt-2 space-y-1 rounded-xl bg-stone-50/70 p-3 text-xs text-stone-600">
                <p className="font-semibold">{files.length}枚選択中</p>
                <p className="line-clamp-2">{files.map((selectedFile) => selectedFile.name).join("、")}</p>
              </div>
            )}
          </Field>
          <Field className="md:col-span-2" label="感想・訪問メモ">
            <Textarea className="rounded-xl bg-stone-50/50 border-stone-200/60 min-h-[100px]" placeholder="料理の味、サービス、混雑状況など..." value={form.memo} onChange={(event) => setForm({ ...form, memo: event.target.value })} />
          </Field>
          <Field className="md:col-span-2" label="写真のキャプション">
            <Input className="h-11 rounded-xl bg-stone-50/50 border-stone-200/60" placeholder="例: 絶品のチャーシュー" value={form.caption} onChange={(event) => setForm({ ...form, caption: event.target.value })} />
          </Field>
          <Button className="md:col-span-2 h-11 font-bold rounded-xl shadow-sm press-effect" disabled={busy} type="submit">
            <Camera className="size-4" />
            訪問記録を保存する
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
  email,
  isPasswordRecovery,
  newPassword,
  onBack,
  onCleanupDuplicates,
  onNewPasswordChange,
  onSubmit,
}: {
  authBusy: boolean;
  cleanupBusy: boolean;
  email: string;
  isPasswordRecovery: boolean;
  newPassword: string;
  onBack: () => void;
  onCleanupDuplicates: () => void;
  onNewPasswordChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <FormShell title="アカウント設定" onBack={onBack}>
      <Card className="mx-auto max-w-xl space-y-5 border border-stone-200/40 bg-white/90 rounded-2xl p-6 shadow-sm">
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
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-stone-400">データ整理</p>
            <p className="mt-1 text-sm leading-6 text-stone-600">
              同じ店名と住所で重複している店舗のうち、写真が入っていない店舗を削除します。訪問履歴とタグは写真ありの店舗へ移します。
            </p>
          </div>
          <Button className="h-11 rounded-xl press-effect w-full sm:w-auto" disabled={cleanupBusy} type="button" variant="outline" onClick={onCleanupDuplicates}>
            <Trash2 className="size-4" />
            写真なし重複店舗を削除
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
        const storagePath = `${userId}/${restaurant.id}/bitelog/${crypto.randomUUID()}-${sanitizeStorageFileName(imageFile.file.name)}`;
        const { error: uploadError } = await client.storage.from("food-photos").upload(storagePath, imageFile.file, {
          cacheControl: "31536000",
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
          skippedPhotos += 1;
          setErrors((current) => [...current, `${imageFile.relativePath}: ${photoError.message}`]);
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
      <Card className="space-y-5 border border-stone-200/40 bg-white/90 rounded-2xl p-6 shadow-sm">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="CSVファイル">
            <Input className="h-11 rounded-xl bg-stone-50/50 border-stone-200/60 file:bg-stone-200/50 file:border-none file:text-xs file:font-semibold cursor-pointer" accept=".csv,text/csv" type="file" onChange={(event) => void readCsv(event.target.files?.[0])} />
          </Field>
          <Field label="画像フォルダ">
            <Input
              {...folderInputProps}
              className="h-11 rounded-xl bg-stone-50/50 border-stone-200/60 file:bg-stone-200/50 file:border-none file:text-xs file:font-semibold cursor-pointer"
              accept="image/*"
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

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="mx-auto mt-8 max-w-6xl flex flex-col items-center gap-4 py-20 text-center animate-in">
      <div className="grid size-14 place-items-center rounded-2xl bg-stone-100/60 text-stone-300">
        <BrandMark className="size-10 rounded-xl opacity-80" />
      </div>
      <div className="space-y-1">
        <h2 className="text-sm font-bold text-stone-700">記録が見つかりませんでした</h2>
        <p className="text-xs text-stone-400 font-light max-w-xs">最初の店舗を追加して、あなただけのBiteLogを始めましょう。</p>
      </div>
      <Button className="rounded-xl press-effect mt-1" onClick={onAdd} size="sm">
        <Plus className="size-4" />
        新しく店舗を追加
      </Button>
    </div>
  );
}

function FormShell({ children, onBack, title }: { children: React.ReactNode; onBack: () => void; title: string }) {
  return (
    <section className="mx-auto max-w-6xl space-y-5">
      <div className="flex items-center gap-3">
        <button
          className="grid size-8 place-items-center rounded-xl text-stone-400 transition-all duration-200 hover:bg-stone-100/80 hover:text-stone-700"
          type="button"
          onClick={onBack}
        >
          <ArrowLeft className="size-4" />
        </button>
        <h1 className="text-lg font-bold text-stone-800 tracking-tight">{title}</h1>
      </div>
      {children}
    </section>
  );
}

function Field({ children, className = "", label }: { children: React.ReactNode; className?: string; label: string }) {
  return (
    <div className={`space-y-1.5 ${className}`}>
      <Label className="text-[11px] font-semibold text-stone-500 tracking-wide">{label}</Label>
      {children}
    </div>
  );
}

function MessageBanner({ message }: { message: Message }) {
  const tone = message.type === "error"
    ? "border-red-200/50 bg-red-50/60 text-red-700"
    : message.type === "success"
      ? "border-primary/15 bg-primary/5 text-primary"
      : "border-stone-200/50 bg-stone-50/60 text-stone-600";

  return <p className={`rounded-xl border px-4 py-2.5 text-xs font-medium ${tone}`}>{message.text}</p>;
}

function Stars({ rating }: { rating: number | null }) {
  return (
    <span className="inline-flex items-center gap-1 text-xs font-semibold text-stone-600 tabular-nums">
      <Star className={`size-3.5 ${rating ? "fill-amber-400 text-amber-400" : "text-stone-200"}`} />
      <span>{rating !== null ? rating.toFixed(1) : "-"}</span>
    </span>
  );
}

function RestaurantThumb({ name, photo }: { name: string; photo?: Photo }) {
  if (photo) {
    return <PhotoTile className="size-[88px] shrink-0 object-cover" photo={photo} />;
  }

  return (
    <div className="grid aspect-square size-[88px] shrink-0 place-items-center rounded-2xl bg-stone-50 text-stone-300">
      <Utensils className="size-6 stroke-[1.2]" aria-label={name} />
    </div>
  );
}

function PhotoTile({ className = "aspect-square size-full object-cover", photo }: { className?: string; photo: Photo }) {
  const { data } = getSupabase().storage.from("food-photos").getPublicUrl(photo.storage_path);

  return <img src={data.publicUrl} alt={photo.caption ?? "food photo"} className={`rounded-2xl bg-stone-50 ${className}`} />;
}

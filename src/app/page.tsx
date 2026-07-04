/* eslint-disable @next/next/no-img-element */
"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Camera,
  ChefHat,
  FolderOpen,
  Image as ImageIcon,
  KeyRound,
  ListFilter,
  Lock,
  LogOut,
  MapPin,
  Plus,
  Search,
  Settings,
  SlidersHorizontal,
  Star,
  Utensils,
  Upload,
} from "lucide-react";
import { createClient } from "@/lib/supabase";
import { getFriendlyAuthError, getPasswordValidation, getRedirectUrl } from "@/lib/auth";
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

  if (!supabase) {
    return (
      <Shell>
        <Card className="space-y-3">
          <h1 className="text-2xl font-bold">もぐレコ</h1>
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
        <div className="grid min-h-[60vh] place-items-center text-sm text-muted-foreground">読み込み中...</div>
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
        onAdd={() => setView("new")}
        onAccount={() => setView("account")}
        onImport={() => setView("import")}
        onSignOut={signOut}
      />

      {message && <MessageBanner message={message} />}

      {view === "list" && (
        <>
          <DashboardHero stats={stats} />
          <DashboardSummary stats={stats} />
          <ListControls
            query={query}
            sortMode={sortMode}
            status={status}
            onQueryChange={setQuery}
            onSortModeChange={setSortMode}
            onStatusChange={setStatus}
          />
          <div className="mt-5 grid gap-3 md:grid-cols-2">
            {filtered.map((restaurant) => (
              <RestaurantCard
                key={restaurant.id}
                restaurant={restaurant}
                onClick={() => {
                  setSelected(restaurant);
                  setView("detail");
                }}
              />
            ))}
          </div>
          {!filtered.length && <EmptyState onAdd={() => setView("new")} />}
          <Button className="safe-bottom fixed bottom-5 right-5 h-14 w-14 rounded-full shadow-xl md:hidden" onClick={() => setView("new")}>
            <Plus className="size-5" />
          </Button>
        </>
      )}

      {view === "new" && (
        <RestaurantForm
          onBack={() => setView("list")}
          onSaved={() => {
            setView("list");
            void loadRestaurants();
          }}
        />
      )}

      {view === "import" && (
        <MogurecoImportPanel
          restaurants={restaurants}
          onBack={() => setView("list")}
          onImported={() => void loadRestaurants()}
        />
      )}

      {view === "detail" && selected && (
        <RestaurantDetail
          restaurant={selected}
          onAddVisit={() => setView("visit")}
          onBack={() => setView("list")}
        />
      )}

      {view === "visit" && selected && (
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
      )}

      {view === "account" && (
        <AccountPanel
          authBusy={authBusy}
          email={userEmail}
          isPasswordRecovery={isPasswordRecovery}
          newPassword={newPassword}
          onBack={() => setView("list")}
          onNewPasswordChange={setNewPassword}
          onSubmit={updatePassword}
        />
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <main className="min-h-screen bg-background px-4 py-6 text-foreground md:px-8 md:py-10 max-w-6xl mx-auto flex flex-col justify-start">{children}</main>;
}

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
    <main className="min-h-screen bg-background flex items-center justify-center p-4 sm:p-6 md:p-10">
      <div className="w-full max-w-5xl overflow-hidden rounded-2xl border border-stone-200/80 bg-white shadow-xl shadow-stone-200/40 lg:grid lg:grid-cols-[1.2fr_0.8fr] min-h-[600px]">
        {/* 左側: ビジュアルセクション */}
        <section className="relative min-h-[300px] overflow-hidden bg-stone-900 text-white lg:min-h-full flex flex-col justify-between p-8 md:p-10">
          <img
            alt="もぐレコ背景"
            className="absolute inset-0 size-full object-cover opacity-60 mix-blend-luminosity transition duration-700 hover:scale-105"
            src="/images/mogureco-hero.png"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-stone-950 via-stone-900/30 to-stone-900/20" />
          
          <div className="relative z-10">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-4 py-1.5 text-xs font-semibold tracking-wide backdrop-blur-md">
              <ChefHat className="size-3.5 text-stone-200" />
              <span>MOGURECO</span>
            </div>
          </div>

          <div className="relative z-10 max-w-md mt-auto space-y-4">
            <h1 className="text-3xl font-extrabold tracking-tight leading-tight md:text-4xl text-white">
              日常の美食を、<br />美しい記憶のままに。
            </h1>
            <p className="text-sm leading-relaxed text-stone-200 font-light">
              お気に入りの店、心に残った料理、あの日感じた味。もぐレコは、あなたの美味しい体験を写真と文字で上品に残すプライベートログです。
            </p>
            <div className="grid grid-cols-3 gap-2 pt-2 text-stone-200">
              <div className="rounded-lg border border-white/10 bg-white/5 p-2.5 backdrop-blur-sm text-center">
                <span className="block text-[10px] uppercase tracking-wider opacity-60">Import</span>
                <span className="font-semibold text-xs md:text-sm">CSV一括</span>
              </div>
              <div className="rounded-lg border border-white/10 bg-white/5 p-2.5 backdrop-blur-sm text-center">
                <span className="block text-[10px] uppercase tracking-wider opacity-60">Archive</span>
                <span className="font-semibold text-xs md:text-sm">写真記録</span>
              </div>
              <div className="rounded-lg border border-white/10 bg-white/5 p-2.5 backdrop-blur-sm text-center">
                <span className="block text-[10px] uppercase tracking-wider opacity-60">Manage</span>
                <span className="font-semibold text-xs md:text-sm">店舗リスト</span>
              </div>
            </div>
          </div>
        </section>

        {/* 右側: フォームセクション */}
        <section className="flex flex-col justify-between bg-stone-50/50 p-8 md:p-10">
          <div className="my-auto space-y-6">
            <div className="space-y-2">
              <h2 className="text-2xl font-bold tracking-tight text-stone-900">ようこそ</h2>
              <p className="text-sm text-stone-500">アカウントにサインインするか、新規パスワードを設定してください。</p>
            </div>

            <div className="flex rounded-lg bg-stone-200/50 p-1">
              <button
                className={`h-9 flex-1 rounded-md text-xs font-semibold transition ${authMode === "login" ? "bg-white text-stone-900 shadow-sm" : "text-stone-500 hover:text-stone-900"}`}
                type="button"
                onClick={() => onModeChange("login")}
              >
                ログイン
              </button>
              <button
                className={`h-9 flex-1 rounded-md text-xs font-semibold transition ${authMode === "setup" ? "bg-white text-stone-900 shadow-sm" : "text-stone-500 hover:text-stone-900"}`}
                type="button"
                onClick={() => onModeChange("setup")}
              >
                パスワード設定
              </button>
            </div>

            {message && <MessageBanner message={message} />}

            {authMode === "login" ? (
              <form className="space-y-4" onSubmit={onLogin}>
                <Field label="メールアドレス">
                  <Input autoComplete="email" placeholder="name@example.com" type="email" value={email} onChange={(event) => onEmailChange(event.target.value)} />
                </Field>
                <Field label="パスワード">
                  <Input autoComplete="current-password" placeholder="••••••••" type="password" value={password} onChange={(event) => onPasswordChange(event.target.value)} />
                </Field>
                <Button className="w-full font-bold shadow-sm" disabled={authBusy} type="submit">
                  <Lock className="size-4" />
                  サインイン
                </Button>
              </form>
            ) : (
              <form className="space-y-4" onSubmit={onSetup}>
                <Field label="メールアドレス">
                  <Input autoComplete="email" placeholder="name@example.com" type="email" value={email} onChange={(event) => onEmailChange(event.target.value)} />
                </Field>
                <Button className="w-full font-bold shadow-sm" disabled={authBusy} type="submit">
                  <KeyRound className="size-4" />
                  設定用の案内を送る
                </Button>
              </form>
            )}
          </div>

          <div className="pt-6 text-center text-xs text-stone-400">
            &copy; {new Date().getFullYear()} MOGURECO. All rights reserved.
          </div>
        </section>
      </div>
    </main>
  );
}

function AppHeader({
  email,
  onAccount,
  onAdd,
  onImport,
  onSignOut,
}: {
  email: string;
  onAccount: () => void;
  onAdd: () => void;
  onImport: () => void;
  onSignOut: () => void;
}) {
  return (
    <header className="mx-auto mb-6 flex max-w-6xl items-center justify-between gap-4 rounded-xl border border-stone-200/60 bg-white/80 px-4 py-3 shadow-sm backdrop-blur-md">
      <div className="flex min-w-0 items-center gap-3">
        <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
          <ChefHat className="size-5" />
        </div>
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-widest text-stone-400">Gourmet Journal</p>
          <h1 className="truncate text-base font-bold text-stone-850">もぐレコ</h1>
        </div>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="hidden max-w-44 truncate text-xs text-stone-500 font-medium md:inline mr-2">{email}</span>
        <Button className="hidden md:inline-flex shadow-sm hover:opacity-95" size="sm" onClick={onAdd}>
          <Plus className="size-4" />
          新規追加
        </Button>
        <Button className="hidden md:inline-flex" size="sm" variant="outline" onClick={onImport}>
          <Upload className="size-4" />
          CSVインポート
        </Button>
        <Button aria-label="CSVインポート" className="md:hidden text-stone-600 hover:text-stone-900" size="sm" variant="ghost" onClick={onImport}>
          <Upload className="size-4" />
        </Button>
        <Button aria-label="アカウント" className="text-stone-600 hover:text-stone-900" size="sm" variant="ghost" onClick={onAccount}>
          <Settings className="size-4" />
        </Button>
        <Button aria-label="ログアウト" className="text-stone-600 hover:text-stone-900" size="sm" variant="ghost" onClick={onSignOut}>
          <LogOut className="size-4" />
        </Button>
      </div>
    </header>
  );
}

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
        const storagePath = `${userId}/${restaurant.id}/mogureco/${crypto.randomUUID()}-${sanitizeStorageFileName(imageFile.file.name)}`;
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
    <FormShell title="もぐレコCSVインポート" onBack={onBack}>
      <Card className="space-y-5 border border-stone-200/60 bg-white rounded-xl p-6 shadow-sm">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="CSVファイル">
            <Input className="bg-stone-50 border-stone-200/80 file:bg-stone-200/50 file:border-none file:text-xs file:font-semibold text-stone-700 cursor-pointer" accept=".csv,text/csv" type="file" onChange={(event) => void readCsv(event.target.files?.[0])} />
          </Field>
          <Field label="画像フォルダ">
            <Input
              {...folderInputProps}
              className="bg-stone-50 border-stone-200/80 file:bg-stone-200/50 file:border-none file:text-xs file:font-semibold text-stone-700 cursor-pointer"
              accept="image/*"
              type="file"
              multiple
              onChange={(event) => readImageFolder(event.target.files)}
            />
          </Field>
        </div>

        {fileName && (
          <div className="grid gap-3 rounded-lg bg-stone-50 border border-stone-100 p-3 text-xs md:grid-cols-3 text-stone-600">
            <span className="truncate font-semibold text-stone-800">{fileName}</span>
            <span>{records.length} 件のレコードを検出</span>
            <span className={errors.length > 0 ? "text-red-600 font-semibold" : "text-stone-400"}>
              {errors.length} 件のエラー
            </span>
          </div>
        )}
        
        {errors.length > 0 && (
          <div className="max-h-36 overflow-auto rounded-lg border border-red-200/60 bg-red-50/30 p-3 text-xs text-red-800">
            {errors.map((error, index) => <p key={index} className="font-light">{error}</p>)}
          </div>
        )}

        {imageSummary && (
          <div className="grid gap-3 rounded-lg border border-stone-200/60 bg-white p-3.5 text-xs md:grid-cols-4 text-stone-600">
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
          <div className="overflow-hidden rounded-lg border border-stone-200/60">
            <div className="grid grid-cols-[1.2fr_0.8fr_0.5fr] bg-stone-50 px-3 py-2.5 text-[10px] font-bold text-stone-500 uppercase tracking-wider md:grid-cols-[1.4fr_0.8fr_0.5fr_1.3fr] border-b">
              <span>店舗名</span>
              <span>訪問日</span>
              <span>評価</span>
              <span className="hidden md:block">住所</span>
            </div>
            <div className="max-h-60 overflow-auto divide-y divide-stone-100">
              {records.slice(0, 100).map((record, index) => (
                <div key={index} className="grid grid-cols-[1.2fr_0.8fr_0.5fr] px-3 py-2 text-xs md:grid-cols-[1.4fr_0.8fr_0.5fr_1.3fr] text-stone-650 hover:bg-stone-50/50">
                  <span className="truncate font-semibold text-stone-850">{record.name}</span>
                  <span className="font-light">{record.visitedAt ?? "-"}</span>
                  <span className="font-semibold text-amber-600">{record.rating ?? "-"}</span>
                  <span className="hidden truncate font-light md:block">{record.address || "-"}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {busy && uploadProgress.total > 0 && (
          <div className="space-y-2 rounded-lg bg-stone-50 border border-stone-100 p-3.5 text-xs">
            <div className="flex items-center justify-between gap-3 text-stone-600">
              <span className="flex items-center gap-1.5 font-bold">
                <ImageIcon className="size-3.5 text-primary" />
                画像をアップロード中...
              </span>
              <span className="font-semibold tabular-nums">{uploadProgress.done} / {uploadProgress.total}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-stone-200/60">
              <div 
                className="h-full bg-primary transition-all duration-300 rounded-full" 
                style={{ width: `${uploadProgress.total ? (uploadProgress.done / uploadProgress.total) * 100 : 0}%` }} 
              />
            </div>
          </div>
        )}

        {result && <MessageBanner message={{ text: result, type: "success" }} />}

        <Button disabled={busy || !canImport} type="button" onClick={importRecords} className="shadow-sm">
          <Upload className="size-4" />
          インポート処理を開始
        </Button>
      </Card>
    </FormShell>
  );
}

function restaurantKey(name: string, area: string | null) {
  return `${name.trim()}\u0000${(area ?? "").trim()}`;
}

function normalizeRestaurantName(name: string) {
  return name.trim().normalize("NFKC").toLowerCase();
}

function sanitizeStorageFileName(fileName: string) {
  return fileName.normalize("NFKC").replace(/[^\w.-]+/g, "-");
}

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function DashboardHero({ stats }: { stats: { total: number; visited: number; wishlist: number; photos: number } }) {
  return (
    <section className="mx-auto mb-6 grid max-w-6xl overflow-hidden rounded-xl border border-stone-200/60 bg-white shadow-sm md:grid-cols-[1fr_20rem]">
      <div className="flex flex-col justify-between p-6 md:p-8 space-y-6">
        <div className="space-y-4">
          <div className="inline-flex items-center gap-1.5 rounded-full bg-stone-100 px-3 py-1 text-xs font-semibold text-stone-600">
            <Camera className="size-3.5" />
            <span>Archive & Collect</span>
          </div>
          <div className="max-w-2xl space-y-2">
            <h2 className="text-xl md:text-2xl font-bold tracking-tight text-stone-850">
              写真と記憶で紡ぐ、私だけの美食図鑑。
            </h2>
            <p className="text-xs md:text-sm leading-relaxed text-stone-500 font-light">
              インポートしたCSVの店舗情報と、写真フォルダの料理画像を自動でマッチング。訪れた店やこれから行きたい店を、美しいグリッドでスマートに整理・振り返ることができます。
            </p>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-4 pt-2 border-t border-stone-100">
          <HeroMetric label="登録店舗数" value={stats.total} />
          <HeroMetric label="訪問済み" value={stats.visited} />
          <HeroMetric label="写真アーカイブ" value={stats.photos} />
        </div>
      </div>
      <div className="relative min-h-[160px] md:min-h-full bg-stone-100">
        <img
          alt="食事の様子イメージ"
          className="absolute inset-0 size-full object-cover mix-blend-multiply opacity-90"
          src="/images/mogureco-hero.png"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-white via-transparent to-transparent md:block hidden" />
      </div>
    </section>
  );
}

function HeroMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="space-y-1">
      <span className="block text-[10px] font-bold uppercase tracking-wider text-stone-400">{label}</span>
      <strong className="text-xl font-extrabold text-stone-800 tabular-nums">{value}</strong>
    </div>
  );
}

function DashboardSummary({ stats }: { stats: { total: number; visited: number; wishlist: number; photos: number } }) {
  return (
    <section className="mx-auto grid max-w-6xl grid-cols-2 gap-4 md:grid-cols-4 mb-6">
      <StatCard label="すべての店" value={stats.total} />
      <StatCard label="行った店" value={stats.visited} />
      <StatCard label="行きたい店" value={stats.wishlist} />
      <StatCard label="写真の数" value={stats.photos} />
    </section>
  );
}

function ListControls({
  query,
  sortMode,
  status,
  onQueryChange,
  onSortModeChange,
  onStatusChange,
}: {
  query: string;
  sortMode: SortMode;
  status: "all" | RestaurantStatus;
  onQueryChange: (query: string) => void;
  onSortModeChange: (sortMode: SortMode) => void;
  onStatusChange: (status: "all" | RestaurantStatus) => void;
}) {
  return (
    <section className="mx-auto mt-6 grid max-w-6xl gap-4 md:grid-cols-[1fr_auto_auto] items-center">
      <div className="relative w-full">
        <Search className="absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-stone-400" />
        <Input 
          className="pl-10 pr-4 h-10 bg-white border-stone-200 shadow-sm focus-visible:ring-primary/20 rounded-lg text-sm transition-all" 
          placeholder="店名・エリア・ジャンル・タグで検索..." 
          value={query} 
          onChange={(event) => onQueryChange(event.target.value)} 
        />
      </div>
      
      <div className="flex gap-3 w-full md:w-auto items-center">
        <div className="relative flex-1 md:flex-none">
          <SlidersHorizontal className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-stone-500" />
          <select
            aria-label="並び替え"
            className="h-10 w-full md:w-40 rounded-lg border border-stone-200 bg-white pl-9 pr-8 text-xs font-semibold text-stone-700 shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-primary/20 transition-all appearance-none cursor-pointer"
            value={sortMode}
            onChange={(event) => onSortModeChange(event.target.value as SortMode)}
          >
            <option value="newest">最新の更新順</option>
            <option value="rating">評価の高い順</option>
            <option value="visitDate">訪問日順</option>
          </select>
          <span className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 flex items-center justify-center text-stone-400 text-xs">▼</span>
        </div>

        <div className="flex rounded-lg bg-stone-200/50 p-0.5 border border-stone-200/30">
          <FilterButton active={status === "all"} label="すべて" onClick={() => onStatusChange("all")} />
          <FilterButton active={status === "visited"} label="行った" onClick={() => onStatusChange("visited")} />
          <FilterButton active={status === "wishlist"} label="行きたい" onClick={() => onStatusChange("wishlist")} />
        </div>
      </div>
    </section>
  );
}

function RestaurantCard({ restaurant, onClick }: { restaurant: Restaurant; onClick: () => void }) {
  const latestPhoto = restaurant.photos?.[0];

  return (
    <Card 
      className="group cursor-pointer overflow-hidden p-0 border border-stone-200/60 bg-white transition-all duration-300 hover:shadow-md hover:border-stone-300 rounded-xl flex" 
      onClick={onClick}
    >
      <div className="flex gap-4 p-4 w-full">
        <RestaurantThumb photo={latestPhoto} name={restaurant.name} />
        
        <div className="min-w-0 flex-1 flex flex-col justify-between py-0.5 space-y-2">
          <div className="space-y-1">
            <div className="flex items-start justify-between gap-3">
              <h2 className="truncate text-base font-bold text-stone-800 tracking-tight group-hover:text-primary transition-colors">
                {restaurant.name}
              </h2>
              <Badge 
                className={`font-semibold text-[10px] tracking-wider px-2 py-0.5 rounded-full border border-transparent shadow-none shrink-0 ${
                  restaurant.status === "visited" 
                    ? "bg-primary/10 text-primary border-primary/10" 
                    : "bg-accent/10 text-accent border-accent/10"
                }`}
              >
                {restaurant.status === "visited" ? "行った店" : "行きたい店"}
              </Badge>
            </div>
            
            <p className="flex items-center gap-1 truncate text-xs text-stone-500 font-light">
              <MapPin className="size-3 shrink-0 text-stone-400" />
              <span>{restaurant.area || "エリア未設定"}</span>
              <span className="text-stone-300 mx-1">|</span>
              <span>{restaurant.genre || "ジャンル未設定"}</span>
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-stone-500 pt-1">
            <Stars rating={restaurant.rating} />
            <span className="text-stone-300">•</span>
            <span className="font-light">{restaurant.visits?.length ?? 0} 回の訪問</span>
            <span className="text-stone-300">•</span>
            <span className="font-light">{restaurant.photos?.length ?? 0} 枚の写真</span>
          </div>

          <div className="flex flex-wrap gap-1 pt-1">
            {restaurant.tags?.slice(0, 4).map((tag) => (
              <Badge 
                key={tag.id} 
                className="bg-stone-100 hover:bg-stone-100 text-stone-600 font-light text-[10px] px-1.5 py-0 border border-stone-200/40 rounded shadow-none"
              >
                #{tag.name}
              </Badge>
            ))}
          </div>
        </div>
      </div>
    </Card>
  );
}

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
      <Card className="border border-stone-200/60 bg-white rounded-xl p-6 shadow-sm">
        <form className="grid gap-4 md:grid-cols-2" onSubmit={save}>
          <Field label="店名">
            <Input required placeholder="店名を入力" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
          </Field>
          <Field label="分類">
            <div className="relative">
              <select 
                className="h-10 w-full rounded-lg border border-stone-200 bg-white px-3 text-sm shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-primary/20 appearance-none cursor-pointer pr-10 font-medium text-stone-700 transition-all" 
                value={form.status} 
                onChange={(event) => setForm({ ...form, status: event.target.value as RestaurantStatus })}
              >
                <option value="visited">行った店</option>
                <option value="wishlist">行きたい店</option>
              </select>
              <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-stone-400 text-xs">▼</span>
            </div>
          </Field>
          <Field label="エリア">
            <Input placeholder="例: 渋谷、恵比寿" value={form.area} onChange={(event) => setForm({ ...form, area: event.target.value })} />
          </Field>
          <Field label="ジャンル">
            <Input placeholder="例: 和食、イタリアン、カフェ" value={form.genre} onChange={(event) => setForm({ ...form, genre: event.target.value })} />
          </Field>
          <Field label="評価 (1 - 5)">
            <Input max="5" min="0.5" placeholder="星評価 (例: 4.5)" step="0.5" type="number" value={form.rating} onChange={(event) => setForm({ ...form, rating: event.target.value })} />
          </Field>
          <Field label="タグ">
            <Input placeholder="スペース区切り (例: ラーメン 渋谷 一人飯)" value={form.tags} onChange={(event) => setForm({ ...form, tags: event.target.value })} />
          </Field>
          <Field className="md:col-span-2" label="メモ">
            <Textarea placeholder="店内の雰囲気、予算、おすすめメニューなど..." value={form.memo} onChange={(event) => setForm({ ...form, memo: event.target.value })} />
          </Field>
          <Button className="md:col-span-2 font-bold shadow-sm" disabled={busy} type="submit">店舗を保存する</Button>
        </form>
      </Card>
    </FormShell>
  );
}

function RestaurantDetail({ restaurant, onBack, onAddVisit }: { restaurant: Restaurant; onBack: () => void; onAddVisit: () => void }) {
  return (
    <FormShell title={restaurant.name} onBack={onBack}>
      <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="space-y-6">
          <Card className="space-y-4 border border-stone-200/60 shadow-sm rounded-xl p-5">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1.5">
                <p className="flex items-center gap-1 text-xs text-stone-500 font-light">
                  <MapPin className="size-3.5 text-stone-400" />
                  <span>{restaurant.area || "エリア未設定"}</span>
                  <span className="text-stone-300 mx-1">|</span>
                  <span>{restaurant.genre || "ジャンル未設定"}</span>
                </p>
                <div className="flex items-center gap-3">
                  <Stars rating={restaurant.rating} />
                  <Badge 
                    className={`font-semibold text-[10px] tracking-wider px-2 py-0.5 rounded-full border border-transparent shadow-none shrink-0 ${
                      restaurant.status === "visited" 
                        ? "bg-primary/10 text-primary border-primary/10" 
                        : "bg-accent/10 text-accent border-accent/10"
                    }`}
                  >
                    {restaurant.status === "visited" ? "行った店" : "行きたい店"}
                  </Badge>
                </div>
              </div>
              <Button size="sm" onClick={onAddVisit} className="shadow-sm">
                <Utensils className="size-4" />
                訪問記録を追加
              </Button>
            </div>
            
            {restaurant.memo && (
              <div className="rounded-lg bg-stone-50 border border-stone-100 p-4">
                <p className="text-sm leading-relaxed text-stone-600 font-light whitespace-pre-wrap">{restaurant.memo}</p>
              </div>
            )}
            
            <div className="flex flex-wrap gap-1.5 pt-1">
              {restaurant.tags?.map((tag) => (
                <Badge 
                  key={tag.id} 
                  className="bg-stone-100 hover:bg-stone-100 text-stone-600 font-light text-[10px] px-2 py-0.5 border border-stone-200/40 rounded shadow-none"
                >
                  #{tag.name}
                </Badge>
              ))}
            </div>
          </Card>

          <section className="space-y-4 border border-stone-200/60 shadow-sm rounded-xl bg-white p-5">
            <h3 className="text-sm font-bold text-stone-700 tracking-wider uppercase border-b border-stone-100 pb-2">訪問タイムライン</h3>
            {restaurant.visits && restaurant.visits.length > 0 ? (
              <div className="relative border-l-2 border-stone-200/60 pl-6 ml-3 py-2 space-y-6">
                {restaurant.visits.map((visit: Visit) => (
                  <div key={visit.id} className="relative">
                    {/* タイムラインのインジケータ */}
                    <span className="absolute -left-[31px] top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-white border-2 border-primary">
                      <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                    </span>
                    <div className="space-y-1">
                      <p className="text-[10px] font-bold text-stone-400 tracking-wider uppercase">{visit.visited_at}</p>
                      <h4 className="text-sm font-semibold text-stone-800">{visit.dish_name || "料理名未入力"}</h4>
                      {visit.memo && <p className="text-xs leading-relaxed text-stone-500 font-light mt-1 max-w-xl">{visit.memo}</p>}
                      <div className="pt-1">
                        <Stars rating={visit.rating} />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-stone-400 font-light py-4 text-center">訪問記録がまだありません。</p>
            )}
          </section>
        </div>

        <section className="space-y-4 border border-stone-200/60 shadow-sm rounded-xl bg-white p-5 h-fit">
          <h3 className="text-sm font-bold text-stone-700 tracking-wider uppercase border-b border-stone-100 pb-2">写真ギャラリー</h3>
          {restaurant.photos && restaurant.photos.length > 0 ? (
            <div className="grid gap-3 grid-cols-2">
              {restaurant.photos.map((photo) => (
                <div key={photo.id} className="group relative overflow-hidden rounded-lg border border-stone-100 bg-stone-50 aspect-square">
                  <PhotoTile className="size-full object-cover transition duration-500 group-hover:scale-105" photo={photo} />
                  {photo.caption && (
                    <div className="absolute inset-x-0 bottom-0 bg-black/60 p-2 text-[10px] text-white opacity-0 group-hover:opacity-100 transition-opacity duration-300 truncate">
                      {photo.caption}
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-10 border border-dashed border-stone-200 rounded-lg text-stone-400 bg-stone-50/50">
              <Camera className="size-6 mb-2 opacity-50" />
              <p className="text-xs font-light">写真が登録されていません。</p>
            </div>
          )}
        </section>
      </div>
    </FormShell>
  );
}

function VisitForm({ restaurant, onBack, onSaved }: { restaurant: Restaurant; onBack: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ visited_at: new Date().toISOString().slice(0, 10), dish_name: "", rating: "", memo: "", caption: "" });
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const client = getSupabase();
    const { data: user } = await client.auth.getUser();
    const userId = user.user?.id;
    if (!userId) return;

    setBusy(true);
    const { data: visit } = await client
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

    await client.from("restaurants").update({ status: "visited", updated_at: new Date().toISOString() }).eq("id", restaurant.id);

    if (file && visit) {
      const path = `${userId}/${restaurant.id}/${crypto.randomUUID()}-${file.name}`;
      await client.storage.from("food-photos").upload(path, file);
      await client.from("photos").insert({
        user_id: userId,
        restaurant_id: restaurant.id,
        visit_id: visit.id,
        storage_path: path,
        caption: form.caption || null,
      });
    }

    setBusy(false);
    onSaved();
  }

  return (
    <FormShell title="訪問記録を追加" onBack={onBack}>
      <Card className="border border-stone-200/60 bg-white rounded-xl p-6 shadow-sm">
        <form className="grid gap-4 md:grid-cols-2" onSubmit={save}>
          <Field label="訪問日">
            <Input className="text-stone-750 font-medium cursor-pointer" type="date" value={form.visited_at} onChange={(event) => setForm({ ...form, visited_at: event.target.value })} />
          </Field>
          <Field label="食べた料理">
            <Input placeholder="例: 特製醤油ラーメン、マルゲリータ" value={form.dish_name} onChange={(event) => setForm({ ...form, dish_name: event.target.value })} />
          </Field>
          <Field label="評価 (1 - 5)">
            <Input max="5" min="0.5" placeholder="星評価 (例: 4.0)" step="0.5" type="number" value={form.rating} onChange={(event) => setForm({ ...form, rating: event.target.value })} />
          </Field>
          <Field label="写真">
            <Input className="bg-stone-50 border-stone-200/80 file:bg-stone-200/50 file:border-none file:text-xs file:font-semibold text-stone-700 cursor-pointer" accept="image/*" type="file" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
          </Field>
          <Field className="md:col-span-2" label="感想・訪問メモ">
            <Textarea placeholder="料理の味、サービス、混雑状況など..." value={form.memo} onChange={(event) => setForm({ ...form, memo: event.target.value })} />
          </Field>
          <Field className="md:col-span-2" label="写真のキャプション">
            <Input placeholder="例: 絶品のチャーシュー、看板メニューのピザ" value={form.caption} onChange={(event) => setForm({ ...form, caption: event.target.value })} />
          </Field>
          <Button className="md:col-span-2 font-bold shadow-sm" disabled={busy} type="submit">
            <Camera className="size-4" />
            訪問記録を保存する
          </Button>
        </form>
      </Card>
    </FormShell>
  );
}

function AccountPanel({
  authBusy,
  email,
  isPasswordRecovery,
  newPassword,
  onBack,
  onNewPasswordChange,
  onSubmit,
}: {
  authBusy: boolean;
  email: string;
  isPasswordRecovery: boolean;
  newPassword: string;
  onBack: () => void;
  onNewPasswordChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <FormShell title="アカウント設定" onBack={onBack}>
      <Card className="mx-auto max-w-xl space-y-5 border border-stone-200/60 bg-white rounded-xl p-6 shadow-sm">
        <div>
          <p className="text-xs font-bold text-stone-400 tracking-wider uppercase">サインイン中のメールアドレス</p>
          <p className="font-semibold text-stone-800 text-sm mt-0.5">{email}</p>
        </div>
        <form className="space-y-4 pt-2 border-t border-stone-100" onSubmit={onSubmit}>
          <Field label={isPasswordRecovery ? "新しいパスワード" : "パスワードの変更"}>
            <Input autoComplete="new-password" placeholder="新しいパスワード" type="password" value={newPassword} onChange={(event) => onNewPasswordChange(event.target.value)} />
          </Field>
          <Button disabled={authBusy} type="submit" className="w-full sm:w-auto">
            <KeyRound className="size-4" />
            パスワードを更新
          </Button>
        </form>
      </Card>
    </FormShell>
  );
}

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="mx-auto mt-8 grid max-w-6xl place-items-center gap-3 py-16 text-center border border-dashed border-stone-200 rounded-xl bg-stone-50/50">
      <div className="grid size-12 place-items-center rounded-full bg-stone-100 text-stone-400">
        <ListFilter className="size-5" />
      </div>
      <h2 className="text-sm font-bold text-stone-750">記録が見つかりませんでした</h2>
      <p className="text-xs text-stone-400 font-light max-w-xs mb-2">最初の店舗を追加して、あなただけの美食記録を始めましょう。</p>
      <Button onClick={onAdd} size="sm">
        <Plus className="size-4" />
        新しく店舗を追加
      </Button>
    </div>
  );
}

function FormShell({ children, onBack, title }: { children: React.ReactNode; onBack: () => void; title: string }) {
  return (
    <section className="mx-auto max-w-6xl space-y-6">
      <div className="flex items-center gap-3">
        <Button size="sm" type="button" variant="ghost" onClick={onBack} className="text-stone-500 hover:text-stone-900">
          <ArrowLeft className="size-4" />
          戻る
        </Button>
        <h1 className="text-lg font-bold text-stone-850 tracking-tight">{title}</h1>
      </div>
      {children}
    </section>
  );
}

function Field({ children, className = "", label }: { children: React.ReactNode; className?: string; label: string }) {
  return (
    <div className={`space-y-1.5 ${className}`}>
      <Label className="text-xs font-semibold text-stone-600">{label}</Label>
      {children}
    </div>
  );
}

function MessageBanner({ message }: { message: Message }) {
  const tone = message.type === "error"
    ? "border-red-200/60 bg-red-50/50 text-red-800/90"
    : message.type === "success"
      ? "border-primary/20 bg-primary/5 text-primary"
      : "border-stone-200/60 bg-stone-50/50 text-stone-700";

  return <p className={`mb-4 rounded-lg border px-4 py-2.5 text-xs font-medium ${tone}`}>{message.text}</p>;
}


function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="border border-stone-200/60 bg-white rounded-xl p-4 shadow-sm">
      <p className="text-[10px] font-bold text-stone-400 tracking-wider uppercase">{label}</p>
      <p className="mt-1 text-2xl font-extrabold text-stone-800 tabular-nums leading-none">{value}</p>
    </div>
  );
}

function FilterButton({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      className={`h-8 rounded-md px-4 text-xs font-semibold transition duration-200 ${
        active 
          ? "bg-white text-stone-800 shadow-sm border border-stone-200/40" 
          : "text-stone-500 hover:text-stone-850 hover:bg-stone-200/20 border border-transparent"
      }`}
      type="button"
      onClick={onClick}
    >
      {label}
    </button>
  );
}

function Stars({ rating }: { rating: number | null }) {
  return (
    <span className="inline-flex items-center gap-1 text-xs font-semibold text-stone-700 tabular-nums">
      <Star className={`size-3.5 ${rating ? "fill-amber-400 text-amber-500" : "text-stone-300"}`} />
      <span>{rating !== null ? rating.toFixed(1) : "-"}</span>
    </span>
  );
}

function RestaurantThumb({ name, photo }: { name: string; photo?: Photo }) {
  if (photo) {
    return <PhotoTile className="size-24 shrink-0 object-cover" photo={photo} />;
  }

  return (
    <div className="grid aspect-square size-24 shrink-0 place-items-center rounded-xl bg-stone-100 border border-stone-200/40 text-stone-400">
      <Utensils className="size-6 stroke-[1.5]" aria-label={name} />
    </div>
  );
}

function PhotoTile({ className = "aspect-square size-full object-cover", photo }: { className?: string; photo: Photo }) {
  const { data } = getSupabase().storage.from("food-photos").getPublicUrl(photo.storage_path);

  return <img src={data.publicUrl} alt={photo.caption ?? "food photo"} className={`rounded-xl bg-stone-50 ${className}`} />;
}

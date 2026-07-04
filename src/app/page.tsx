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
  return <main className="min-h-screen bg-background px-4 py-4 text-foreground md:px-8">{children}</main>;
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
    <main className="min-h-screen bg-[#f8f5ee] px-4 py-4 text-foreground md:py-6">
      <div className="mx-auto grid min-h-[calc(100vh-2rem)] max-w-6xl overflow-hidden rounded-[2rem] border border-white/70 bg-white shadow-2xl shadow-slate-900/10 lg:min-h-[calc(100vh-3rem)] lg:grid-cols-[1.15fr_0.85fr]">
        <section className="relative min-h-[440px] overflow-hidden bg-slate-950 text-white lg:min-h-full">
          <img
            alt="朝の食卓とスマートフォンに表示されたもぐレコの食事記録イメージ"
            className="absolute inset-0 size-full object-cover"
            src="/images/mogureco-hero.png"
          />
          <div className="absolute inset-0 bg-gradient-to-r from-slate-950/86 via-slate-950/48 to-slate-950/10" />
          <div className="absolute inset-x-0 bottom-0 h-56 bg-gradient-to-t from-slate-950/80 to-transparent" />
          <div className="relative flex min-h-[440px] flex-col justify-between p-6 sm:p-8 lg:min-h-full lg:p-10">
            <div className="inline-flex w-fit items-center gap-2 rounded-lg border border-white/20 bg-white/14 px-3 py-2 text-sm font-semibold shadow-sm backdrop-blur">
              <ChefHat className="size-4 text-amber-300" />
              もぐレコ
            </div>
            <div className="max-w-xl space-y-4 rounded-xl bg-slate-950/56 p-3 backdrop-blur-sm sm:space-y-5 sm:bg-transparent sm:p-0 sm:backdrop-blur-0">
              <h1 className="text-3xl font-bold leading-tight tracking-tight sm:text-4xl md:text-6xl md:leading-[0.98]">
                食べたい店と食べた記録を、写真ごと残す。
              </h1>
              <p className="max-w-lg text-sm leading-7 text-white/88 sm:text-base md:text-lg">
                モグレコCSVと写真フォルダを取り込み、行った店・行きたい店・訪問メモをひとつの画面で見返せます。
              </p>
              <div className="grid max-w-lg grid-cols-3 gap-2">
                <PreviewStat className="border-white/15 bg-white/14 text-white backdrop-blur" label="Import" value="CSV" />
                <PreviewStat className="border-white/15 bg-white/14 text-white backdrop-blur" label="Photos" value="画像" />
                <PreviewStat className="border-white/15 bg-white/14 text-white backdrop-blur" label="Places" value="店舗" />
              </div>
            </div>
          </div>
        </section>

        <section className="flex items-center bg-[linear-gradient(145deg,#fffaf0,#f0fbf6)] px-5 py-8 sm:px-8 lg:px-10">
          <div className="w-full">
            <div className="mb-6 inline-flex items-center gap-2 rounded-lg border bg-white/80 px-3 py-2 text-sm font-semibold shadow-sm">
              <ChefHat className="size-4 text-primary" />
              もぐレコ
            </div>
            <Card className="mx-auto w-full max-w-md border-slate-200 bg-white/95 p-5 shadow-xl shadow-slate-900/10">
              <div className="mb-5 flex rounded-lg bg-slate-100 p-1">
                <button
                  className={`h-10 flex-1 rounded-md text-sm font-semibold transition ${authMode === "login" ? "bg-white text-slate-950 shadow-sm" : "text-slate-500"}`}
                  type="button"
                  onClick={() => onModeChange("login")}
                >
                  ログイン
                </button>
                <button
                  className={`h-10 flex-1 rounded-md text-sm font-semibold transition ${authMode === "setup" ? "bg-white text-slate-950 shadow-sm" : "text-slate-500"}`}
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
                    <Input autoComplete="email" type="email" value={email} onChange={(event) => onEmailChange(event.target.value)} />
                  </Field>
                  <Field label="パスワード">
                    <Input autoComplete="current-password" type="password" value={password} onChange={(event) => onPasswordChange(event.target.value)} />
                  </Field>
                  <Button className="w-full" disabled={authBusy} type="submit">
                    <Lock className="size-4" />
                    ログイン
                  </Button>
                </form>
              ) : (
                <form className="space-y-4" onSubmit={onSetup}>
                  <Field label="メールアドレス">
                    <Input autoComplete="email" type="email" value={email} onChange={(event) => onEmailChange(event.target.value)} />
                  </Field>
                  <Button className="w-full" disabled={authBusy} type="submit">
                    <KeyRound className="size-4" />
                    設定メールを送る
                  </Button>
                </form>
              )}
            </Card>
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
    <header className="mx-auto mb-5 flex max-w-6xl items-center justify-between gap-3 rounded-lg border bg-white/90 px-3 py-3 shadow-sm backdrop-blur">
      <div className="flex min-w-0 items-center gap-3">
        <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground">
          <ChefHat className="size-5" />
        </div>
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">AI Gourmet Log</p>
          <h1 className="truncate text-lg font-bold">もぐレコ</h1>
        </div>
      </div>
      <div className="flex items-center gap-1">
        <span className="hidden max-w-44 truncate text-sm text-muted-foreground md:inline">{email}</span>
        <Button className="hidden md:inline-flex" onClick={onAdd}>
          <Plus className="size-4" />
          追加
        </Button>
        <Button className="hidden md:inline-flex" variant="outline" onClick={onImport}>
          <Upload className="size-4" />
          CSV
        </Button>
        <Button aria-label="CSVインポート" className="md:hidden" size="sm" variant="ghost" onClick={onImport}>
          <Upload className="size-4" />
        </Button>
        <Button aria-label="アカウント" size="sm" variant="ghost" onClick={onAccount}>
          <Settings className="size-4" />
        </Button>
        <Button aria-label="ログアウト" size="sm" variant="ghost" onClick={onSignOut}>
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
      <Card className="space-y-4">
        <Field label="CSVファイル">
          <Input accept=".csv,text/csv" type="file" onChange={(event) => void readCsv(event.target.files?.[0])} />
        </Field>
        <Field label="画像フォルダ">
          <Input
            {...folderInputProps}
            accept="image/*"
            type="file"
            multiple
            onChange={(event) => readImageFolder(event.target.files)}
          />
        </Field>
        {fileName && (
          <div className="grid gap-2 rounded-lg bg-muted p-3 text-sm md:grid-cols-3">
            <span className="truncate font-semibold">{fileName}</span>
            <span>{records.length}件読み込み</span>
            <span>{errors.length}件エラー</span>
          </div>
        )}
        {errors.length > 0 && (
          <div className="max-h-36 overflow-auto rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            {errors.map((error) => <p key={error}>{error}</p>)}
          </div>
        )}
        {imageSummary && (
          <div className="grid gap-2 rounded-lg border bg-white p-3 text-sm md:grid-cols-4">
            <span className="flex items-center gap-2 font-semibold">
              <FolderOpen className="size-4 text-primary" />
              画像フォルダ
            </span>
            <span>{imageSummary.files.length}枚</span>
            <span>{imageSummary.restaurantCount}店舗</span>
            <span>{formatBytes(imageSummary.totalBytes)}</span>
            {imageSummary.skippedCount > 0 && <span className="text-amber-700 md:col-span-4">画像以外のファイルを{imageSummary.skippedCount}件スキップします。</span>}
          </div>
        )}
        {records.length > 0 && (
          <div className="overflow-hidden rounded-lg border">
            <div className="grid grid-cols-[1.2fr_0.8fr_0.5fr] bg-muted px-3 py-2 text-xs font-semibold text-muted-foreground md:grid-cols-[1.4fr_0.8fr_0.5fr_1.3fr]">
              <span>店舗</span>
              <span>訪問日</span>
              <span>評価</span>
              <span className="hidden md:block">住所</span>
            </div>
            <div className="max-h-80 overflow-auto">
              {records.slice(0, 100).map((record) => (
                <div key={`${record.name}-${record.visitedAt}-${record.address}`} className="grid grid-cols-[1.2fr_0.8fr_0.5fr] border-t px-3 py-2 text-sm md:grid-cols-[1.4fr_0.8fr_0.5fr_1.3fr]">
                  <span className="truncate font-semibold">{record.name}</span>
                  <span>{record.visitedAt ?? "-"}</span>
                  <span>{record.rating ?? "-"}</span>
                  <span className="hidden truncate md:block">{record.address || "-"}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        {busy && uploadProgress.total > 0 && (
          <div className="space-y-2 rounded-lg bg-muted p-3 text-sm">
            <div className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-2 font-semibold">
                <ImageIcon className="size-4 text-primary" />
                画像アップロード中
              </span>
              <span>{uploadProgress.done} / {uploadProgress.total}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-white">
              <div className="h-full bg-primary transition-all" style={{ width: `${uploadProgress.total ? (uploadProgress.done / uploadProgress.total) * 100 : 0}%` }} />
            </div>
          </div>
        )}
        {result && <MessageBanner message={{ text: result, type: "success" }} />}
        <Button disabled={busy || !canImport} type="button" onClick={importRecords}>
          <Upload className="size-4" />
          インポート
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
    <section className="mx-auto mb-4 grid max-w-6xl overflow-hidden rounded-lg border bg-white shadow-sm md:grid-cols-[1fr_19rem]">
      <div className="space-y-4 p-5 md:p-6">
        <div className="inline-flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900">
          <Camera className="size-4" />
          もぐレコ取り込み
        </div>
        <div className="max-w-2xl space-y-2">
          <h2 className="text-2xl font-bold tracking-tight text-slate-950 md:text-3xl">写真つきの訪問記録を、まとめて見返す。</h2>
          <p className="text-sm leading-6 text-muted-foreground md:text-base">
            CSVの店舗情報と写真フォルダを合わせて取り込み、訪問日・評価・写真を店舗ごとに整理します。
          </p>
        </div>
        <div className="grid grid-cols-3 gap-2 text-sm">
          <HeroMetric label="店舗" value={stats.total} />
          <HeroMetric label="訪問済み" value={stats.visited} />
          <HeroMetric label="写真" value={stats.photos} />
        </div>
      </div>
      <div className="relative min-h-44 md:min-h-full">
        <img
          alt="もぐレコの食事記録をイメージした朝食とスマートフォン"
          className="absolute inset-0 size-full object-cover"
          src="/images/mogureco-hero.png"
        />
      </div>
    </section>
  );
}

function HeroMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border bg-slate-50 px-3 py-2">
      <span className="block text-xs font-semibold text-muted-foreground">{label}</span>
      <strong className="text-lg text-slate-950">{value}</strong>
    </div>
  );
}

function DashboardSummary({ stats }: { stats: { total: number; visited: number; wishlist: number; photos: number } }) {
  return (
    <section className="mx-auto grid max-w-6xl grid-cols-2 gap-3 md:grid-cols-4">
      <StatCard label="Total" value={stats.total} />
      <StatCard label="Visited" value={stats.visited} />
      <StatCard label="Wishlist" value={stats.wishlist} />
      <StatCard label="Photos" value={stats.photos} />
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
    <section className="mx-auto mt-4 grid max-w-6xl gap-3 md:grid-cols-[1fr_auto_auto]">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input className="pl-10" placeholder="店名・エリア・ジャンル・タグで検索" value={query} onChange={(event) => onQueryChange(event.target.value)} />
      </div>
      <label className="relative block">
        <SlidersHorizontal className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <select
          aria-label="並び替え"
          className="h-11 w-full rounded-lg border border-input bg-white pl-10 pr-9 text-sm font-semibold shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring md:w-36"
          value={sortMode}
          onChange={(event) => onSortModeChange(event.target.value as SortMode)}
        >
          <option value="newest">新着順</option>
          <option value="rating">星が高い順</option>
          <option value="visitDate">訪問日順</option>
        </select>
      </label>
      <div className="grid grid-cols-3 gap-2 rounded-lg border bg-white p-1">
        <FilterButton active={status === "all"} label="すべて" onClick={() => onStatusChange("all")} />
        <FilterButton active={status === "visited"} label="行った" onClick={() => onStatusChange("visited")} />
        <FilterButton active={status === "wishlist"} label="行きたい" onClick={() => onStatusChange("wishlist")} />
      </div>
    </section>
  );
}

function RestaurantCard({ restaurant, onClick }: { restaurant: Restaurant; onClick: () => void }) {
  const latestPhoto = restaurant.photos?.[0];

  return (
    <Card className="group cursor-pointer overflow-hidden p-0 transition hover:-translate-y-0.5 hover:shadow-md" onClick={onClick}>
      <div className="flex gap-3 p-3">
        <RestaurantThumb photo={latestPhoto} name={restaurant.name} />
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="truncate text-base font-bold">{restaurant.name}</h2>
              <p className="mt-1 flex items-center gap-1 truncate text-sm text-muted-foreground">
                <MapPin className="size-4 shrink-0" />
                {restaurant.area || "エリア未設定"} / {restaurant.genre || "ジャンル未設定"}
              </p>
            </div>
            <Badge className={restaurant.status === "visited" ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}>
              {restaurant.status === "visited" ? "行った" : "行きたい"}
            </Badge>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Stars rating={restaurant.rating} />
            <span>{restaurant.visits?.length ?? 0} visits</span>
            <span>{restaurant.photos?.length ?? 0} photos</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {restaurant.tags?.slice(0, 4).map((tag) => (
              <Badge key={tag.id} className="bg-slate-100 text-slate-600">#{tag.name}</Badge>
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
    <FormShell title="店舗追加" onBack={onBack}>
      <form className="grid gap-4 md:grid-cols-2" onSubmit={save}>
        <Field label="店名">
          <Input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
        </Field>
        <Field label="分類">
          <select className="h-11 w-full rounded-lg border border-input bg-white px-3 text-sm shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as RestaurantStatus })}>
            <option value="visited">行った店</option>
            <option value="wishlist">行きたい店</option>
          </select>
        </Field>
        <Field label="エリア">
          <Input value={form.area} onChange={(event) => setForm({ ...form, area: event.target.value })} />
        </Field>
        <Field label="ジャンル">
          <Input value={form.genre} onChange={(event) => setForm({ ...form, genre: event.target.value })} />
        </Field>
        <Field label="評価 1-5">
          <Input max="5" min="0.5" step="0.5" type="number" value={form.rating} onChange={(event) => setForm({ ...form, rating: event.target.value })} />
        </Field>
        <Field label="タグ">
          <Input placeholder="ラーメン 渋谷 一人飯" value={form.tags} onChange={(event) => setForm({ ...form, tags: event.target.value })} />
        </Field>
        <Field className="md:col-span-2" label="メモ">
          <Textarea value={form.memo} onChange={(event) => setForm({ ...form, memo: event.target.value })} />
        </Field>
        <Button className="md:col-span-2" disabled={busy} type="submit">保存</Button>
      </form>
    </FormShell>
  );
}

function RestaurantDetail({ restaurant, onBack, onAddVisit }: { restaurant: Restaurant; onBack: () => void; onAddVisit: () => void }) {
  return (
    <FormShell title={restaurant.name} onBack={onBack}>
      <div className="grid gap-4 lg:grid-cols-[1fr_0.9fr]">
        <Card className="space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="flex items-center gap-1 text-sm text-muted-foreground">
                <MapPin className="size-4" />
                {restaurant.area || "エリア未設定"} / {restaurant.genre || "ジャンル未設定"}
              </p>
              <div className="mt-2 flex items-center gap-3">
                <Stars rating={restaurant.rating} />
                <Badge>{restaurant.status === "visited" ? "行った" : "行きたい"}</Badge>
              </div>
            </div>
            <Button onClick={onAddVisit}>
              <Utensils className="size-4" />
              訪問追加
            </Button>
          </div>
          {restaurant.memo && <p className="rounded-lg bg-muted p-3 text-sm leading-6">{restaurant.memo}</p>}
          <div className="flex flex-wrap gap-2">
            {restaurant.tags?.map((tag) => <Badge key={tag.id}>#{tag.name}</Badge>)}
          </div>
        </Card>

        <section className="space-y-3">
          <h3 className="font-bold">写真</h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {restaurant.photos?.map((photo) => <PhotoTile key={photo.id} className="h-44 w-full object-contain" photo={photo} />)}
          </div>
        </section>
      </div>
      <section className="mt-5 space-y-3">
        <h3 className="font-bold">訪問記録</h3>
        <div className="grid gap-3 md:grid-cols-2">
          {restaurant.visits?.map((visit: Visit) => (
            <Card key={visit.id} className="space-y-2">
              <p className="text-sm text-muted-foreground">{visit.visited_at}</p>
              <p className="font-semibold">{visit.dish_name || "料理名なし"}</p>
              {visit.memo && <p className="text-sm leading-6">{visit.memo}</p>}
              <Stars rating={visit.rating} />
            </Card>
          ))}
        </div>
      </section>
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
    <FormShell title="訪問記録追加" onBack={onBack}>
      <form className="grid gap-4 md:grid-cols-2" onSubmit={save}>
        <Field label="訪問日">
          <Input type="date" value={form.visited_at} onChange={(event) => setForm({ ...form, visited_at: event.target.value })} />
        </Field>
        <Field label="食べた料理">
          <Input value={form.dish_name} onChange={(event) => setForm({ ...form, dish_name: event.target.value })} />
        </Field>
        <Field label="評価 1-5">
          <Input max="5" min="0.5" step="0.5" type="number" value={form.rating} onChange={(event) => setForm({ ...form, rating: event.target.value })} />
        </Field>
        <Field label="写真">
          <Input accept="image/*" type="file" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
        </Field>
        <Field className="md:col-span-2" label="感想">
          <Textarea value={form.memo} onChange={(event) => setForm({ ...form, memo: event.target.value })} />
        </Field>
        <Field className="md:col-span-2" label="写真キャプション">
          <Input value={form.caption} onChange={(event) => setForm({ ...form, caption: event.target.value })} />
        </Field>
        <Button className="md:col-span-2" disabled={busy} type="submit">
          <Camera className="size-4" />
          保存
        </Button>
      </form>
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
    <FormShell title="アカウント" onBack={onBack}>
      <Card className="mx-auto max-w-xl space-y-4">
        <div>
          <p className="text-sm text-muted-foreground">ログイン中</p>
          <p className="font-semibold">{email}</p>
        </div>
        <form className="space-y-4" onSubmit={onSubmit}>
          <Field label={isPasswordRecovery ? "新しいパスワード" : "パスワード変更"}>
            <Input autoComplete="new-password" type="password" value={newPassword} onChange={(event) => onNewPasswordChange(event.target.value)} />
          </Field>
          <Button disabled={authBusy} type="submit">
            <KeyRound className="size-4" />
            更新
          </Button>
        </form>
      </Card>
    </FormShell>
  );
}

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <Card className="mx-auto mt-5 grid max-w-6xl place-items-center gap-3 py-12 text-center">
      <div className="grid size-12 place-items-center rounded-lg bg-muted">
        <ListFilter className="size-6 text-primary" />
      </div>
      <h2 className="text-lg font-bold">記録がありません</h2>
      <Button onClick={onAdd}>
        <Plus className="size-4" />
        店舗を追加
      </Button>
    </Card>
  );
}

function FormShell({ children, onBack, title }: { children: React.ReactNode; onBack: () => void; title: string }) {
  return (
    <section className="mx-auto max-w-6xl">
      <div className="mb-4 flex items-center gap-3">
        <Button size="sm" type="button" variant="ghost" onClick={onBack}>
          <ArrowLeft className="size-4" />
          戻る
        </Button>
        <h1 className="text-2xl font-bold">{title}</h1>
      </div>
      {children}
    </section>
  );
}

function Field({ children, className = "", label }: { children: React.ReactNode; className?: string; label: string }) {
  return (
    <div className={`space-y-2 ${className}`}>
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function MessageBanner({ message }: { message: Message }) {
  const tone = message.type === "error"
    ? "border-red-200 bg-red-50 text-red-800"
    : message.type === "success"
      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
      : "border-slate-200 bg-slate-50 text-slate-700";

  return <p className={`mb-4 rounded-lg border px-3 py-2 text-sm ${tone}`}>{message.text}</p>;
}

function PreviewStat({ className = "bg-white/80", label, value }: { className?: string; label: string; value: string }) {
  return (
    <div className={`rounded-lg border p-3 shadow-sm ${className}`}>
      <p className="text-xs font-semibold uppercase tracking-wider opacity-70">{label}</p>
      <p className="mt-1 font-bold">{value}</p>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <Card className="p-3">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-bold">{value}</p>
    </Card>
  );
}

function FilterButton({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      className={`h-9 rounded-md px-3 text-sm font-semibold transition ${active ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-muted"}`}
      type="button"
      onClick={onClick}
    >
      {label}
    </button>
  );
}

function Stars({ rating }: { rating: number | null }) {
  return (
    <span className="inline-flex items-center gap-1 text-sm font-semibold">
      <Star className={`size-4 ${rating ? "fill-amber-400 text-amber-400" : "text-muted-foreground"}`} />
      {rating ?? "-"}
    </span>
  );
}

function RestaurantThumb({ name, photo }: { name: string; photo?: Photo }) {
  if (photo) {
    return <PhotoTile className="size-24 shrink-0 object-cover" photo={photo} />;
  }

  return (
    <div className="grid aspect-square size-24 shrink-0 place-items-center rounded-lg bg-[linear-gradient(135deg,hsl(169_72%_88%),hsl(42_96%_86%))] text-primary">
      <Utensils className="size-7" aria-label={name} />
    </div>
  );
}

function PhotoTile({ className = "aspect-square size-full object-cover", photo }: { className?: string; photo: Photo }) {
  const { data } = getSupabase().storage.from("food-photos").getPublicUrl(photo.storage_path);

  return <img src={data.publicUrl} alt={photo.caption ?? "food photo"} className={`rounded-lg bg-muted ${className}`} />;
}

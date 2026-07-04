/* eslint-disable @next/next/no-img-element */
"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Camera,
  ChefHat,
  KeyRound,
  ListFilter,
  Lock,
  LogOut,
  MapPin,
  Plus,
  Search,
  Settings,
  Star,
  Utensils,
} from "lucide-react";
import { createClient } from "@/lib/supabase";
import { getFriendlyAuthError, getPasswordValidation, getRedirectUrl } from "@/lib/auth";
import type { Photo, Restaurant, RestaurantStatus, Tag, Visit } from "@/types/database";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type View = "list" | "new" | "detail" | "visit" | "account";
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

  const filtered = useMemo(() => restaurants.filter((restaurant) => {
    const haystack = [
      restaurant.name,
      restaurant.area,
      restaurant.genre,
      ...(restaurant.tags?.map((tag: Tag) => tag.name) ?? []),
    ].join(" ").toLowerCase();

    return (status === "all" || restaurant.status === status) && haystack.includes(query.toLowerCase());
  }), [restaurants, query, status]);

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
          <h1 className="text-2xl font-bold">AIグルメ記録</h1>
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
        onSignOut={signOut}
      />

      {message && <MessageBanner message={message} />}

      {view === "list" && (
        <>
          <DashboardSummary stats={stats} />
          <ListControls query={query} status={status} onQueryChange={setQuery} onStatusChange={setStatus} />
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
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,hsl(168_76%_92%),transparent_34%),linear-gradient(135deg,hsl(210_24%_98%),hsl(44_100%_96%))] px-4 py-6 text-foreground">
      <div className="mx-auto grid min-h-[calc(100vh-3rem)] max-w-6xl items-center gap-6 lg:grid-cols-[1.05fr_0.95fr]">
        <section className="space-y-6">
          <div className="inline-flex items-center gap-2 rounded-lg border bg-white/80 px-3 py-2 text-sm font-semibold shadow-sm">
            <ChefHat className="size-4 text-primary" />
            AIグルメ記録
          </div>
          <div className="max-w-xl space-y-4">
            <h1 className="text-4xl font-bold tracking-tight text-slate-950 md:text-6xl">
              食べたい店と食べた記録を、ひとつの場所に。
            </h1>
            <p className="text-base leading-7 text-slate-600 md:text-lg">
              同じメールアドレスならPCでもスマホでも同じアカウントで使えます。
            </p>
          </div>
          <div className="grid max-w-2xl gap-3 sm:grid-cols-3">
            <PreviewStat label="Wishlist" value="行きたい" />
            <PreviewStat label="Visits" value="訪問記録" />
            <PreviewStat label="Photos" value="写真" />
          </div>
        </section>

        <Card className="mx-auto w-full max-w-md border-slate-200 bg-white/95 p-5 shadow-2xl shadow-slate-900/10">
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
    </main>
  );
}

function AppHeader({ email, onAccount, onAdd, onSignOut }: { email: string; onAccount: () => void; onAdd: () => void; onSignOut: () => void }) {
  return (
    <header className="mx-auto mb-5 flex max-w-6xl items-center justify-between gap-3 rounded-lg border bg-white/90 px-3 py-3 shadow-sm backdrop-blur">
      <div className="flex min-w-0 items-center gap-3">
        <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground">
          <ChefHat className="size-5" />
        </div>
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">AI Gourmet Log</p>
          <h1 className="truncate text-lg font-bold">グルメ記録</h1>
        </div>
      </div>
      <div className="flex items-center gap-1">
        <span className="hidden max-w-44 truncate text-sm text-muted-foreground md:inline">{email}</span>
        <Button className="hidden md:inline-flex" onClick={onAdd}>
          <Plus className="size-4" />
          追加
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
  status,
  onQueryChange,
  onStatusChange,
}: {
  query: string;
  status: "all" | RestaurantStatus;
  onQueryChange: (query: string) => void;
  onStatusChange: (status: "all" | RestaurantStatus) => void;
}) {
  return (
    <section className="mx-auto mt-4 grid max-w-6xl gap-3 md:grid-cols-[1fr_auto]">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input className="pl-10" placeholder="店名・エリア・ジャンル・タグで検索" value={query} onChange={(event) => onQueryChange(event.target.value)} />
      </div>
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
          <Input max="5" min="1" type="number" value={form.rating} onChange={(event) => setForm({ ...form, rating: event.target.value })} />
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
          <div className="grid grid-cols-3 gap-2">
            {restaurant.photos?.map((photo) => <PhotoTile key={photo.id} photo={photo} />)}
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
          <Input max="5" min="1" type="number" value={form.rating} onChange={(event) => setForm({ ...form, rating: event.target.value })} />
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

function PreviewStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-white/80 p-3 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">{label}</p>
      <p className="mt-1 font-bold text-slate-950">{value}</p>
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
    return <PhotoTile photo={photo} />;
  }

  return (
    <div className="grid aspect-square size-24 shrink-0 place-items-center rounded-lg bg-[linear-gradient(135deg,hsl(169_72%_88%),hsl(42_96%_86%))] text-primary">
      <Utensils className="size-7" aria-label={name} />
    </div>
  );
}

function PhotoTile({ photo }: { photo: Photo }) {
  const { data } = getSupabase().storage.from("food-photos").getPublicUrl(photo.storage_path);

  return <img src={data.publicUrl} alt={photo.caption ?? "food photo"} className="aspect-square size-full rounded-lg object-cover" />;
}

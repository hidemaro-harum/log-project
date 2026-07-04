"use client";

import { useEffect, useMemo, useState } from "react";
import { Camera, LogOut, MapPin, Plus, Search, Star, Utensils } from "lucide-react";
import { createClient } from "@/lib/supabase";
import type { Photo, Restaurant, RestaurantStatus, Tag, Visit } from "@/types/database";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type View = "list" | "new" | "detail" | "visit";
const supabase = createClient();

function getSupabase() {
  if (!supabase) {
    throw new Error("Supabase is not configured.");
  }

  return supabase;
}

export default function Home() {
  const [userId, setUserId] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(true);
  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"all" | RestaurantStatus>("all");
  const [view, setView] = useState<View>("list");
  const [selected, setSelected] = useState<Restaurant | null>(null);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getUser().then(({ data }) => { setUserId(data.user?.id ?? null); setLoading(false); });
    const { data } = supabase.auth.onAuthStateChange((_event, session) => setUserId(session?.user.id ?? null));
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => { if (userId) void loadRestaurants(); }, [userId]);

  async function loadRestaurants() {
    const client = getSupabase();
    const { data, error } = await client.from("restaurants").select("*, tags(*), visits(*), photos(*)").order("updated_at", { ascending: false });
    if (!error) setRestaurants((data ?? []) as Restaurant[]);
  }

  const filtered = useMemo(() => restaurants.filter((r) => {
    const haystack = [r.name, r.area, r.genre, ...(r.tags?.map((t) => t.name) ?? [])].join(" ").toLowerCase();
    return (status === "all" || r.status === status) && haystack.includes(query.toLowerCase());
  }), [restaurants, query, status]);

  async function login() {
    if (!supabase || !email) return;
    await getSupabase().auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.origin } });
    alert("ログイン用リンクをメールで送信しました。");
  }

  if (!supabase) return <Shell><Card className="space-y-4"><h1 className="text-2xl font-bold">AIグルメ記録</h1><p className="text-muted-foreground">Supabase の公開環境変数が未設定です。Vercel に NEXT_PUBLIC_SUPABASE_URL と NEXT_PUBLIC_SUPABASE_ANON_KEY を設定してください。</p></Card></Shell>;
  if (loading) return <Shell><p>読み込み中...</p></Shell>;
  if (!userId) return <Shell><Card className="space-y-4"><h1 className="text-2xl font-bold">AIグルメ記録</h1><p className="text-muted-foreground">メールリンクでログインして、自分だけの店・料理・写真を記録します。</p><Input type="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} /><Button className="w-full" onClick={login}>ログインリンクを送る</Button></Card></Shell>;

  return <Shell>
    <header className="sticky top-0 z-10 -mx-4 mb-4 bg-background/90 px-4 py-3 backdrop-blur"><div className="flex items-center justify-between"><div><p className="text-xs text-muted-foreground">Personal PWA</p><h1 className="text-xl font-bold">グルメ記録</h1></div><Button variant="ghost" size="sm" onClick={() => getSupabase().auth.signOut()}><LogOut className="size-4" /></Button></div></header>
    {view === "list" && <><div className="space-y-3"><div className="relative"><Search className="absolute left-3 top-3 size-5 text-muted-foreground" /><Input className="pl-10" placeholder="店名・エリア・ジャンル・タグで検索" value={query} onChange={(e) => setQuery(e.target.value)} /></div><div className="grid grid-cols-3 gap-2"><Button variant={status === "all" ? "default" : "secondary"} onClick={() => setStatus("all")}>すべて</Button><Button variant={status === "visited" ? "default" : "secondary"} onClick={() => setStatus("visited")}>行った</Button><Button variant={status === "wishlist" ? "default" : "secondary"} onClick={() => setStatus("wishlist")}>行きたい</Button></div></div><div className="mt-5 space-y-3">{filtered.map((r) => <RestaurantCard key={r.id} restaurant={r} onClick={() => { setSelected(r); setView("detail"); }} />)}</div><Button className="fixed bottom-5 right-5 h-14 w-14 rounded-full shadow-lg safe-bottom" onClick={() => setView("new")}><Plus /></Button></>}
    {view === "new" && <RestaurantForm onBack={() => setView("list")} onSaved={() => { setView("list"); void loadRestaurants(); }} />}
    {view === "detail" && selected && <RestaurantDetail restaurant={selected} onBack={() => setView("list")} onAddVisit={() => setView("visit")} onRefresh={async () => { await loadRestaurants(); const next = restaurants.find((r) => r.id === selected.id); if (next) setSelected(next); }} />}
    {view === "visit" && selected && <VisitForm restaurant={selected} onBack={() => setView("detail")} onSaved={async () => { await loadRestaurants(); setView("list"); }} />}
  </Shell>;
}

function Shell({ children }: { children: React.ReactNode }) { return <main className="mx-auto min-h-screen max-w-md px-4 py-4">{children}</main>; }
function Stars({ rating }: { rating: number | null }) { return <span className="inline-flex items-center gap-1 text-sm"><Star className="size-4 fill-primary text-primary" />{rating ?? "-"}</span>; }
function RestaurantCard({ restaurant, onClick }: { restaurant: Restaurant; onClick: () => void }) { return <Card onClick={onClick} className="space-y-3 active:scale-[0.99]"><div className="flex items-start justify-between gap-3"><div><h2 className="font-bold">{restaurant.name}</h2><p className="mt-1 flex items-center gap-1 text-sm text-muted-foreground"><MapPin className="size-4" />{restaurant.area || "エリア未設定"} · {restaurant.genre || "ジャンル未設定"}</p></div><Badge>{restaurant.status === "visited" ? "行った" : "行きたい"}</Badge></div><div className="flex items-center justify-between text-sm"><Stars rating={restaurant.rating} /><span>{restaurant.visits?.length ?? 0} visits · {restaurant.photos?.length ?? 0} photos</span></div><div className="flex flex-wrap gap-2">{restaurant.tags?.map((t) => <Badge key={t.id} className="bg-accent">#{t.name}</Badge>)}</div></Card>; }

function RestaurantForm({ onBack, onSaved }: { onBack: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ name: "", area: "", genre: "", status: "visited" as RestaurantStatus, rating: "", memo: "", tags: "" });
  async function save() {
    const client = getSupabase();
    const { data: user } = await client.auth.getUser();
    const userId = user.user?.id; if (!userId || !form.name) return;
    const { data: restaurant } = await client.from("restaurants").insert({ user_id: userId, name: form.name, area: form.area || null, genre: form.genre || null, status: form.status, rating: form.rating ? Number(form.rating) : null, memo: form.memo || null }).select().single();
    const tagNames = form.tags.split(/[、,\s]+/).filter(Boolean);
    for (const name of tagNames) { const { data: tag } = await client.from("tags").upsert({ user_id: userId, name }, { onConflict: "user_id,name" }).select().single(); if (tag && restaurant) await client.from("restaurant_tags").insert({ restaurant_id: restaurant.id, tag_id: tag.id, user_id: userId }); }
    onSaved();
  }
  return <FormShell title="店舗追加" onBack={onBack}><Field label="店名"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field><div className="grid grid-cols-2 gap-3"><Field label="エリア"><Input value={form.area} onChange={(e) => setForm({ ...form, area: e.target.value })} /></Field><Field label="ジャンル"><Input value={form.genre} onChange={(e) => setForm({ ...form, genre: e.target.value })} /></Field></div><Field label="分類"><select className="h-11 w-full rounded-2xl border px-4" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as RestaurantStatus })}><option value="visited">行った店</option><option value="wishlist">行きたい店</option></select></Field><Field label="評価 1-5"><Input type="number" min="1" max="5" value={form.rating} onChange={(e) => setForm({ ...form, rating: e.target.value })} /></Field><Field label="タグ"><Input placeholder="ラーメン 渋谷 一人飯" value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} /></Field><Field label="メモ"><Textarea value={form.memo} onChange={(e) => setForm({ ...form, memo: e.target.value })} /></Field><Button onClick={save} className="w-full">保存</Button></FormShell>;
}
function RestaurantDetail({ restaurant, onBack, onAddVisit }: { restaurant: Restaurant; onBack: () => void; onAddVisit: () => void; onRefresh: () => void }) { return <FormShell title={restaurant.name} onBack={onBack}><RestaurantCard restaurant={restaurant} onClick={() => {}} /><Button className="w-full" onClick={onAddVisit}><Utensils className="size-4" />訪問記録を追加</Button><section><h3 className="mb-2 font-bold">訪問記録</h3><div className="space-y-2">{restaurant.visits?.map((v: Visit) => <Card key={v.id}><p className="text-sm text-muted-foreground">{v.visited_at}</p><p className="font-semibold">{v.dish_name || "料理名なし"}</p><p>{v.memo}</p><Stars rating={v.rating} /></Card>)}</div></section><section><h3 className="mb-2 font-bold">写真</h3><div className="grid grid-cols-3 gap-2">{restaurant.photos?.map((p: Photo) => <PhotoTile key={p.id} photo={p} />)}</div></section></FormShell>; }
function PhotoTile({ photo }: { photo: Photo }) { const { data } = getSupabase().storage.from("food-photos").getPublicUrl(photo.storage_path); return <img src={data.publicUrl} alt={photo.caption ?? "food photo"} className="aspect-square rounded-2xl object-cover" />; }
function VisitForm({ restaurant, onBack, onSaved }: { restaurant: Restaurant; onBack: () => void; onSaved: () => void }) { const [form, setForm] = useState({ visited_at: new Date().toISOString().slice(0, 10), dish_name: "", rating: "", memo: "", caption: "" }); const [file, setFile] = useState<File | null>(null); async function save() { const client = getSupabase(); const { data: user } = await client.auth.getUser(); const userId = user.user?.id; if (!userId) return; const { data: visit } = await client.from("visits").insert({ user_id: userId, restaurant_id: restaurant.id, visited_at: form.visited_at, dish_name: form.dish_name || null, rating: form.rating ? Number(form.rating) : null, memo: form.memo || null }).select().single(); await client.from("restaurants").update({ status: "visited", updated_at: new Date().toISOString() }).eq("id", restaurant.id); if (file && visit) { const path = `${userId}/${restaurant.id}/${crypto.randomUUID()}-${file.name}`; await client.storage.from("food-photos").upload(path, file); await client.from("photos").insert({ user_id: userId, restaurant_id: restaurant.id, visit_id: visit.id, storage_path: path, caption: form.caption || null }); } onSaved(); } return <FormShell title="訪問記録追加" onBack={onBack}><Field label="訪問日"><Input type="date" value={form.visited_at} onChange={(e) => setForm({ ...form, visited_at: e.target.value })} /></Field><Field label="食べた料理"><Input value={form.dish_name} onChange={(e) => setForm({ ...form, dish_name: e.target.value })} /></Field><Field label="評価 1-5"><Input type="number" min="1" max="5" value={form.rating} onChange={(e) => setForm({ ...form, rating: e.target.value })} /></Field><Field label="感想"><Textarea value={form.memo} onChange={(e) => setForm({ ...form, memo: e.target.value })} /></Field><Field label="写真"><Input type="file" accept="image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></Field><Field label="写真キャプション"><Input value={form.caption} onChange={(e) => setForm({ ...form, caption: e.target.value })} /></Field><Button onClick={save} className="w-full"><Camera className="size-4" />保存</Button></FormShell>; }
function FormShell({ title, onBack, children }: { title: string; onBack: () => void; children: React.ReactNode }) { return <div className="space-y-4"><Button variant="ghost" onClick={onBack}>← 戻る</Button><h1 className="text-2xl font-bold">{title}</h1>{children}</div>; }
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <div className="space-y-2"><Label>{label}</Label>{children}</div>; }

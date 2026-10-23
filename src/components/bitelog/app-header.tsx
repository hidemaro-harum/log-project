"use client";

import { Plus, Search, Settings, Upload, LogOut, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BrandMark, IconButton } from "./brand";

export function AppHeader({
  email,
  query,
  onHome,
  onAccount,
  onAdd,
  onImport,
  onQueryChange,
  onSignOut,
}: {
  email: string;
  query: string;
  onHome: () => void;
  onAccount: () => void;
  onAdd: () => void;
  onImport: () => void;
  onQueryChange: (query: string) => void;
  onSignOut: () => void;
}) {
  return (
    <header className="sticky top-3 z-40 mx-auto mb-7 flex max-w-6xl items-center gap-3 rounded-2xl border border-stone-200/80 bg-white/95 px-3 py-2 shadow-sm backdrop-blur-xl sm:px-4">
      <button
        type="button"
        aria-label="BiteLog ホームへ"
        onClick={onHome}
        className="flex min-h-11 shrink-0 items-center gap-2.5 rounded-lg text-left"
      >
        <BrandMark className="size-10 rounded-xl" />
        <div>
          <p className="text-lg font-semibold tracking-tight text-stone-800">
            BiteLog
          </p>
          <p className="hidden text-[10px] text-stone-500 lg:block">
            おいしい記憶を、ひとつずつ。
          </p>
        </div>
      </button>
      <div
        role="search"
        className="relative mx-auto hidden w-full max-w-sm sm:block"
      >
        <Search
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-stone-500"
          aria-hidden="true"
        />
        <input
          type="search"
          aria-label="お店を検索"
          className="h-11 w-full rounded-xl border border-stone-200 bg-stone-50 pl-9 pr-10 text-sm text-stone-700 placeholder:text-stone-500"
          placeholder="店名・エリア・ジャンル・タグ"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
        />
        {query && (
          <button
            type="button"
            aria-label="検索をクリア"
            onClick={() => onQueryChange("")}
            className="absolute inset-y-0 right-0 grid w-10 place-items-center rounded-r-xl text-stone-500"
          >
            <X className="size-4" />
          </button>
        )}
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-0.5">
        <Button className="hidden rounded-xl md:inline-flex" onClick={onAdd}>
          <Plus className="size-4" />
          記録する
        </Button>
        <IconButton label="CSVインポート" onClick={onImport}>
          <Upload className="size-4" />
        </IconButton>
        <span className="hidden sm:inline-flex" title={email}>
          <IconButton label="アカウント" onClick={onAccount}>
            <Settings className="size-4" />
          </IconButton>
        </span>
        <IconButton label="ログアウト" onClick={onSignOut}>
          <LogOut className="size-4" />
        </IconButton>
      </div>
    </header>
  );
}

"use client";

import Image from "next/image";
import type { FormEvent } from "react";
import { Lock, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BrandMark } from "./brand";
import { Field, MessageBanner, type Message } from "./form-primitives";
type AuthMode = "login" | "setup";

export function AuthScreen({
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
          <Image
            fill
            priority
            sizes="(max-width: 1024px) 100vw, 590px"
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
            <p className="text-[13px] leading-relaxed text-white/85 max-w-sm">
              お気に入りの店、心に残った料理。BiteLogは、あなたの美味しい体験を写真と文字で残すプライベートログです。
            </p>
          </div>
        </section>

        {/* 右側: フォーム */}
        <section className="flex flex-col justify-between p-8 md:p-10">
          <div className="my-auto space-y-7">
            <div className="space-y-1.5">
              <h2 className="text-[1.6rem] font-bold tracking-tight text-stone-800">
                サインイン
              </h2>
              <p className="text-[13px] text-stone-600">
                保存したお店と食事の記録を開きます。
              </p>
            </div>

            <div className="flex rounded-xl bg-stone-100/80 p-1">
              <button
                className={`h-9 flex-1 rounded-lg text-xs font-semibold transition-all duration-200 ${authMode === "login" ? "bg-white text-stone-800 shadow-sm" : "text-stone-600 hover:text-stone-800"}`}
                type="button"
                aria-pressed={authMode === "login"}
                onClick={() => onModeChange("login")}
              >
                ログイン
              </button>
              <button
                className={`h-9 flex-1 rounded-lg text-xs font-semibold transition-all duration-200 ${authMode === "setup" ? "bg-white text-stone-800 shadow-sm" : "text-stone-600 hover:text-stone-800"}`}
                type="button"
                aria-pressed={authMode === "setup"}
                onClick={() => onModeChange("setup")}
              >
                パスワード設定
              </button>
            </div>

            {message && <MessageBanner message={message} />}

            {authMode === "login" ? (
              <form className="space-y-5" onSubmit={onLogin}>
                <Field label="メールアドレス">
                  <Input
                    className="h-11 rounded-xl bg-stone-50/80 border-stone-200/60 text-sm"
                    autoComplete="email"
                    placeholder="name@example.com"
                    required
                    type="email"
                    value={email}
                    onChange={(event) => onEmailChange(event.target.value)}
                  />
                </Field>
                <Field label="パスワード">
                  <Input
                    className="h-11 rounded-xl bg-stone-50/80 border-stone-200/60 text-sm"
                    autoComplete="current-password"
                    placeholder="••••••••"
                    required
                    type="password"
                    value={password}
                    onChange={(event) => onPasswordChange(event.target.value)}
                  />
                </Field>
                <Button
                  className="w-full h-11 font-bold rounded-xl shadow-sm press-effect"
                  disabled={authBusy}
                  type="submit"
                >
                  <Lock className="size-4" />
                  {authBusy ? "ログインしています…" : "サインイン"}
                </Button>
              </form>
            ) : (
              <form className="space-y-5" onSubmit={onSetup}>
                <Field label="メールアドレス">
                  <Input
                    className="h-11 rounded-xl bg-stone-50/80 border-stone-200/60 text-sm"
                    autoComplete="email"
                    placeholder="name@example.com"
                    required
                    type="email"
                    value={email}
                    onChange={(event) => onEmailChange(event.target.value)}
                  />
                </Field>
                <Button
                  className="w-full h-11 font-bold rounded-xl shadow-sm press-effect"
                  disabled={authBusy}
                  type="submit"
                >
                  <KeyRound className="size-4" />
                  {authBusy ? "送信しています…" : "設定用の案内を送る"}
                </Button>
              </form>
            )}
          </div>

          <div className="pt-8 text-center">
            <p className="text-[11px] text-stone-500 tracking-wide">
              &copy; {new Date().getFullYear()} BITELOG
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}

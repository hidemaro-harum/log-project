# AIグルメ記録 MVP設計

## プロジェクト構成
- `src/app`: Next.js App Router。ログイン、店舗一覧、追加、詳細、訪問追加を単一PWA画面として実装。
- `src/components/ui`: shadcn/uiの思想に沿った最小UIプリミティブ。
- `src/lib`: Supabaseクライアントと共通ユーティリティ。
- `src/types`: Supabaseテーブルに対応するTypeScript型。
- `supabase/schema.sql`: 初期DBスキーマ、RLS、Storage bucket policy。

## DBスキーマ
- `restaurants`: 店舗。`user_id`を必須にして将来の複数ユーザー利用に対応。`status`で「行った」「行きたい」を分類。
- `visits`: 訪問記録。料理名、感想、評価、訪問日を保持。
- `photos`: Supabase Storageのパスを保持。店舗・訪問記録に紐付け可能。
- `tags`: ユーザーごとのタグマスタ。
- `restaurant_tags`: 店舗とタグの中間テーブル。

## Supabase SQL
`supabase/schema.sql`をSupabase SQL Editorで実行する。AuthはEmail OTPを想定し、Storage bucket `food-photos`を作成する。

## 画面設計
1. ログイン画面: メールアドレス入力、Magic Link送信。
2. 店舗一覧: 検索、分類フィルタ、カード一覧、追加FAB。
3. 店舗追加: 店名、エリア、ジャンル、分類、評価、タグ、メモ。
4. 店舗詳細: 基本情報、訪問履歴、写真グリッド。
5. 訪問記録追加: 訪問日、料理名、評価、感想、写真アップロード。

## 実装ステップ
1. Next.js + TypeScript + Tailwind CSSの基盤を作る。
2. shadcn/ui風の最小コンポーネントを追加する。
3. Supabase AuthとDB CRUDを接続する。
4. 店舗一覧・追加・詳細・訪問追加を実装する。
5. Supabase Storageで写真アップロードを実装する。
6. PWA manifestとアイコンを追加する。
7. 将来AI機能として、感想要約、タグ提案、店名/料理名OCRを追加する。

# Operational Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 画像集約と各ポータル処理へ、誤実行防止、CSV検証、通知、履歴、APIリトライを追加する。

**Architecture:** `Operations.js`へ履歴・通知・検証・HTTP再試行の純粋関数とGAS連携を集約する。既存のChoice・ANA進捗形式は変更せず、各処理の入口・完了・異常終了から共通関数を呼ぶ。

**Tech Stack:** Google Apps Script V8、Node.js `node:test`、clasp

---

### Task 1: 共通運用基盤

**Files:** Create `src/Operations.js`, `test/operations.test.js`; Modify `src/Config.js`, `src/Menu.js`

- [x] 履歴追記、通知、履歴失敗の握りつぶしを期待する失敗テストを書く。
- [x] `node --test test/operations.test.js`で未定義失敗を確認する。
- [x] `execution_history`初期化と`recordOperationResult_`、`completeOperation_`を実装する。
- [x] focused testを通す。

### Task 2: 画像集約の安全性

**Files:** Modify `src/Collector.js`, `src/Dashboard.js`, `test/collector-dry-run.test.js`; Create `test/collector-safety.test.js`

- [x] pending work拒否、予約表示、フォルダID重複排除、異常終了通知の失敗テストを書く。
- [x] focused testのREDを確認する。
- [x] 既存進捗形式を維持して最小実装する。
- [x] focused testを通す。

### Task 3: CSV出力前検証

**Files:** Modify `src/Operations.js`, `src/DistributorANA.js`, `src/DistributorRakuten.js`, `test/ana.test.js`, `test/rakuten-template.test.js`

- [x] ANAの識別コード空欄・出力バッチエラー、楽天の必須ヘッダー・識別キー・更新エラーを拒否する失敗テストを書く。
- [x] focused testのREDを確認する。
- [x] 全行・選択行の両方でダウンロード前に検証し、失敗履歴を記録する。
- [x] focused testを通す。

### Task 4: 楽天API再試行と処理接続

**Files:** Modify `src/Operations.js`, `src/Distributor.js`, `src/DistributorANA.js`, `src/DistributorRakuten.js`, `test/operations.test.js`, `test/rakuten-template.test.js`

- [x] 429・5xxを最大3回再試行し、通常4xxは即停止する失敗テストを書く。
- [x] focused testのREDを確認する。
- [x] 楽天GET・アップロードを共通fetchへ移し、主要処理の完了・異常終了を履歴と通知へ接続する。
- [x] focused testを通す。

### Task 5: 全体検証とデプロイ

**Files:** Modify `README.md`, plan checklist

- [x] `node --test test/*.test.js`を実行し全件PASSを確認する。
- [x] `for f in src/*.js test/*.js; do node --check "$f" || exit 1; done`を実行する。
- [x] `.clasp.json`と`clasp status`で対象を再確認する。
- [x] `clasp push`し、pushされたファイル一覧を確認する。

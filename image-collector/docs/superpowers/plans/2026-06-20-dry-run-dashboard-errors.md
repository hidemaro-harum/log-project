# Dry Run Dashboard Errors Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 画像集約ドライランの集計とエラー行詳細を`dashboard`シートで確認できるようにする。

**Architecture:** 既存の画像集約処理を維持しつつ、ドライランでもdashboardを初期化・更新する。明細APIにフォルダURLを追加し、フォルダアクセス失敗時だけでなく通常の本実行ログにも同じ列構成を使用する。

**Tech Stack:** Google Apps Script V8、Node.js `node:test`、VMベースGASテストローダー

---

### Task 1: ドライランのdashboard出力

**Files:**
- Create: `test/collector-dry-run.test.js`
- Modify: `src/Collector.js:197-314`
- Modify: `src/Dashboard.js:12-120`

- [x] **Step 1: Write the failing test**

`_runCollect({isDryRun: true})`をGASモック上で実行し、dashboard初期化、エラー行のURL・原因、最終サマリー更新、`makeCopy`未実行を検証する。

- [x] **Step 2: Run test to verify it fails**

Run: `node --test test/collector-dry-run.test.js`

Expected: dashboardが初期化されない、またはエラー明細が記録されずFAIL。

- [x] **Step 3: Write minimal implementation**

ドライランでも`initDashboard_()`を呼び、ステータスを`ドライラン実行中`にする。空行とフォルダアクセスエラーをdashboardへ追加し、最後にサマリーと`ドライラン完了`ステータスを更新する。dashboard明細に`フォルダURL`列を追加する。

- [x] **Step 4: Run focused test**

Run: `node --test test/collector-dry-run.test.js`

Expected: PASS。

- [x] **Step 5: Run full verification**

Run: `node --test test/*.test.js`

Expected: 全テストPASS。

Run: `for f in src/*.js test/*.js; do node --check "$f" || exit 1; done`

Expected: exit code 0。

- [x] **Step 6: Review diff**

Run: `git diff -- src/Collector.js src/Dashboard.js test/collector-dry-run.test.js`。Git管理外の場合は`sed`で変更箇所を再確認する。

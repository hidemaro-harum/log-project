# Number Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 共通対照表から楽天番号とANA備考を安全に移行し、マルチSKU画像パスを設定する。

**Architecture:** `NumberMigration.js`へ対照表検証と変換計画を純粋関数として実装し、GAS入口でドライラン、バックアップ、一括書込を行う。既存楽天テンプレート処理にはChikuma方式のSKU画像計画だけを接続する。

**Tech Stack:** Google Apps Script V8、Node.js `node:test`、clasp

---

### Task 1: 対照表と変換計画
- [x] 失敗テスト: シングル・マルチ検証、楽天3層変換、ANA備考計画、冪等性、不変列。
- [x] RED確認後、`src/NumberMigration.js`の純粋関数を実装してGREENにする。

### Task 2: 初期設定と実行UI
- [x] 失敗テスト: 差分設定で2シートを安全に作成する。
- [x] `Config.js`、`Menu.js`へシート・メニューを追加する。
- [x] ドライラン署名、ダッシュボード、バックアップ、本実行、履歴通知を実装する。

### Task 3: マルチSKU画像
- [x] 失敗テスト: 新番号一致、旧番号フォールバック、未一致、シングル非更新。
- [x] 楽天テンプレート処理へSKU画像タイプ・パス計画を接続する。
- [x] CSV出力前検証へマルチSKU画像不足を接続する。

### Task 4: 検証とデプロイ
- [x] READMEを更新する。
- [x] 全テストと全JavaScript構文確認を通す。
- [x] `.clasp.json`と追跡ファイルを確認し`clasp push`する。

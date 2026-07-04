# Number Mapping Auto Fill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `rakuten_csv`から`number_mapping`の商品管理番号とSKU区分を安全に自動補完する。

**Architecture:** `NumberMigration.js`へ楽天CSVのSKU索引と補完計画を作る純粋関数を追加し、GAS入口ではエラー0件の場合だけ対象2列を一括更新する。既存の対照表検証、履歴、通知パターンを再利用し、メニューとREADMEへ操作順を追加する。

**Tech Stack:** Google Apps Script V8、Node.js `node:test`、clasp

---

### Task 1: 補完計画の純粋関数

**Files:**
- Modify: `test/number-migration.test.js`
- Modify: `src/NumberMigration.js`

- [x] **Step 1: シングル・マルチ補完の失敗テストを書く**

`planNumberMappingAutoFill_(mappingData, rakutenData)`へ、旧SKU番号からURLを引き、同一URLのSKU行数で`シングル`/`マルチ`を返すテストを追加する。変更結果は`rowIndex`、`colIndex`、`from`、`to`を持つ。

- [x] **Step 2: 失敗を確認する**

Run: `node --test test/number-migration.test.js`

Expected: `planNumberMappingAutoFill_ is not a function`

- [x] **Step 3: 最小実装を追加する**

`NumberMigration.js`へ以下の責務を実装する。

```javascript
function planNumberMappingAutoFill_(mappingData, rakutenData) {
  // 必須ヘッダー検証
  // 楽天SKU行を旧システム連携用SKU番号で索引化
  // 商品管理番号ごとのSKU行数を集計
  // 対照表の空欄URL・SKU区分だけをchangesへ追加
  return { changes: [], errors: [], alreadyFilled: 0, targetCount: 0 };
}
```

- [x] **Step 4: 競合と未一致の失敗テストを書く**

入力済み不一致、旧SKU未一致、楽天CSV内の旧SKU重複、楽天CSVの商品管理番号空欄をテストする。エラー時も計画は返すが、書込関数は呼ばない前提とする。

- [x] **Step 5: エラー検出を実装しテストを通す**

Run: `node --test test/number-migration.test.js`

Expected: 全テストPASS

### Task 2: GAS入口とメニュー

**Files:**
- Modify: `src/NumberMigration.js`
- Modify: `src/Menu.js`
- Modify: `test/setup-columns.test.js`

- [x] **Step 1: 書込対象列限定の失敗テストを書く**

補完計画の変更を`buildMigrationColumnWrites_`へ渡し、URL列とSKU区分列だけが生成され、商品番号・SKU番号・備考列が含まれないことを検証する。

- [x] **Step 2: GAS公開関数を実装する**

```javascript
function autoFillNumberMappingFromRakuten() {
  // number_mapping/rakuten_csv読込
  // 計画作成
  // 検証結果列更新
  // エラー0件のみapplyMigrationChanges_
  // execution_historyと完了/エラーダイアログ
}
```

エラー時は書き込まず、行番号付き理由を`検証結果`へ設定する。成功時は変更件数と補完済み件数を表示する。

- [x] **Step 3: メニュー順を更新する**

`🔄 番号移行`の先頭へ`① 楽天CSVから対照表を補完`を追加し、既存項目を`②`以降へ繰り下げる。

- [x] **Step 4: 対象テストを実行する**

Run: `node --test test/number-migration.test.js test/setup-columns.test.js`

Expected: 全テストPASS

### Task 3: ドキュメントとデプロイ

**Files:**
- Modify: `README.md`

- [x] **Step 1: READMEの入力・操作順を更新する**

商品管理番号とSKU区分は手入力不要で、旧SKU番号入力後にメニューから補完すること、競合時は上書きしないことを明記する。

- [x] **Step 2: 全検証を実行する**

Run: `node --test test/*.test.js`

Expected: failure 0

Run: `for f in src/*.js test/*.js; do node --check "$f" || exit 1; done`

Expected: exit 0

- [x] **Step 3: デプロイ対象を確認する**

Run: `clasp status`

Expected: `src/NumberMigration.js`、`src/Menu.js`を含むSadoの追跡ファイル一覧

Run: `cat .clasp.json`

Expected: Script ID `12xVenQQgR8xGbDQh-tw-iGYI9NrVuHYQgrm299U1g9kCuFiVUDvh-WO8`

- [x] **Step 4: GASへ反映する**

Run: `clasp push`

Expected: push成功

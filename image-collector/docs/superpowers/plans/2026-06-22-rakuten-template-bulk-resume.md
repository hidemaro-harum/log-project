# 楽天HTML・商品画像 一括差込改善 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 楽天HTML差込を、Choice／画像不足を安全に可視化し、商品画像を完全置換しながら1万行以上を自動再開できる一括処理へ変更する。

**Architecture:** 商品1件の判定・HTML・画像値生成を純粋関数へ分離し、複数商品の変更を隣接列範囲へまとめて書く。ScriptPropertiesに商品ブロック単位のチェックポイントを保存し、25分で時間主導トリガーへ引き継ぐ。初回書込み前にDrive CSVバックアップを作成する。

**Tech Stack:** Google Apps Script V8、Google Sheets、DriveApp、時間主導トリガー、Node.js `node:test`。

**Note:** Git管理外のためコミットは行わず、最終検証後に`clasp push --force`する。

---

### Task 1: 商品単位のHTML・画像計画

**Files:**
- Modify: `src/DistributorRakuten.js`
- Test: `test/rakuten-template.test.js`

- [ ] **Step 1: HTML先頭正規化の失敗テストを書く**

```js
test('normalizeRakutenHtmlLeadingWhitespace_ removes only leading whitespace', () => {
  assert.equal(gas.normalizeRakutenHtmlLeadingWhitespace_('\r\n  <style>x</style>\n<p>a</p>'),
    '<style>x</style>\n<p>a</p>');
});
```

- [ ] **Step 2: 画像完全置換の失敗テストを書く**

`buildRakutenProductImageValues_(paths, alt, 20)`が常に60セルを返し、空パスを詰めて最大20枚だけ`CABINET`・パス・ALTを設定し、残りを空欄にすることを検証する。

```js
const values = gas.buildRakutenProductImageValues_(['a.jpg', '', 'b.jpg'], '商品A', 3);
assert.deepEqual(plain(values), [
  'CABINET','a.jpg','商品A',
  'CABINET','b.jpg','商品A',
  '','','',
]);
```

- [ ] **Step 3: 商品安全判定の失敗テストを書く**

`planRakutenTemplateProduct_`について次を検証する。

- Choice商品なし: `status='CHOICE_MISSING'`、変更0。
- 新画像なし: `status='IMAGE_MISSING'`、変更0。
- Choice項目不足: HTMLへ`-`を差込み、警告を重複なく返す。
- HTML1列でも50,000文字超過: `status='HTML_ERROR'`、変更0。
- 正常: HTML3列＋画像60列の値を返す。
- 商品名なし: Choice品名をALTに使用する。

- [ ] **Step 4: 純粋関数を実装する**

追加する関数:

```js
function normalizeRakutenHtmlLeadingWhitespace_(html) { /* 先頭の空白・タブ・CR・LFだけ除去 */ }
function buildRakutenProductImageValues_(paths, altText, slotCount) { /* 全枠クリア後の完成値 */ }
function planRakutenTemplateProduct_(input) { /* status/htmlValues/imageValues/warnings/log */ }
```

SP画像を先頭へ置く場合は`imgHtml + html`とし、余分な`'\n'`を挿入しない。コメント削除後、3HTMLすべてへ先頭正規化を適用する。

- [ ] **Step 5: 対象テストを実行する**

```bash
node --test --test-name-pattern='normalizeRakutenHtml|ProductImageValues|TemplateProduct' test/rakuten-template.test.js
```

### Task 2: 隣接列グループと一括書込み

**Files:**
- Modify: `src/DistributorRakuten.js`
- Test: `test/rakuten-template.test.js`

- [ ] **Step 1: 列グループ化の失敗テストを書く**

HTML3列と画像60列の列番号を昇順・重複なしにし、連続列だけを`{startColumn, endColumn, columns}`へまとめる`groupAdjacentRakutenMutationColumns_`をテストする。

- [ ] **Step 2: バッチ変更適用の失敗テストを書く**

`buildRakutenTemplateBatchWrites_(sheetValues, batchPlans, groups, firstRow)`が更新対象の商品行だけを変更し、SKU行、対象外行、中間列、数式文字列を保持することを検証する。

- [ ] **Step 3: 一括書込み関数を実装する**

```js
function groupAdjacentRakutenMutationColumns_(columns) { /* 隣接範囲 */ }
function buildRakutenTemplateBatchWrites_(existingByGroup, productPlans, groups, firstRow) { /* setValues payload */ }
function applyRakutenTemplateBatchWrites_(sheet, writes) { /* groupごとに1回setValues */ }
```

1商品ごとの`getRange/getValues/getFormulas/setValues`を削除する。バッチの各列範囲を1回読み、数式セルは数式文字列を保持し、範囲ごとに1回書く。

- [ ] **Step 4: 1万行相当の回帰テストを追加する**

1,250商品×8行のfixtureで、書込み回数が商品数に比例せず、`隣接列グループ数×バッチ数`以下であることを検証する。

### Task 3: ログ・バックアップ・チェックポイント

**Files:**
- Modify: `src/Config.js`
- Modify: `src/DistributorRakuten.js`
- Test: `test/rakuten-template.test.js`
- Test: `test/reset-progress.test.js`

- [ ] **Step 1: 定数を追加する**

```js
PROP_KEYS.RAKUTEN_TEMPLATE_PROGRESS
RAKUTEN_TEMPLATE_CONFIG_ = { BATCH_PRODUCTS: 200, TIME_LIMIT_MS: 25 * 60 * 1000, RESUME_DELAY_MS: 60 * 1000 }
```

再開関数名は`resumeRakutenTemplateInjection`とする。

- [ ] **Step 2: チェックポイント純粋関数の失敗テストを書く**

`buildRakutenTemplateCheckpoint_(nextBlockIndex, stats, signature, backupFileId)`が、Choiceなし、画像なし、その他スキップ、文字数、書込みエラーを保持することを検証する。

- [ ] **Step 3: 入力署名を実装する**

テンプレート、Choice照合キーと値、画像URL／パス／手動マッピング、楽天の商品管理番号・SKU管理番号・システム連携用SKU番号をSHA-256署名へ含める。再開時の不一致は処理を停止する。

- [ ] **Step 4: Driveバックアップを実装する**

`backupRakutenTemplateTargets_(spreadsheet, sheet, blocks, columnMap)`で、対象商品の元行番号、商品管理番号、システム連携用SKU番号、HTML3列、画像60列をUTF-8 BOM付きCSVへ出力する。対象スプレッドシートの最初の親フォルダへ保存し、親がない場合はDriveルートへ保存する。

- [ ] **Step 5: ログ分類を実装する**

既存5列`rakuten_dashboard`へ、管理コード列にシステム連携用SKU番号、内容欄に商品管理番号と理由を記録する。商品ごとのログをバッチ単位で1回追記する。

- [ ] **Step 6: 進捗リセット対象へ追加する**

`resetProgress`がプロパティと`resumeRakutenTemplateInjection`トリガーを削除するテストを追加する。

### Task 4: 再開可能な実行オーケストレーション

**Files:**
- Modify: `src/DistributorRakuten.js`
- Test: `test/rakuten-template.test.js`

- [ ] **Step 1: 開始・競合テストを書く**

`applyTemplateInjection`は確認前にロックを持たず、確認後にロック取得し、既存進捗／再開トリガーがあれば拒否する。キャンセル時は状態を変更しない。

- [ ] **Step 2: 初回・再開コアを実装する**

```js
function runRakutenTemplateInjectionJob_(isResume) { /* load→validate→batch loop→checkpoint */ }
function resumeRakutenTemplateInjection() { return runRakutenTemplateInjectionJob_(true); }
```

初回はバックアップ成功後にだけ書込みを開始する。再開は保存済み`nextBlockIndex`から処理する。

- [ ] **Step 3: 時間中断を実装する**

各バッチ開始前に経過時間を確認し、25分超なら現在位置を保存して再開トリガーを1件だけ作成する。完了済みバッチの次位置だけを保存する。

- [ ] **Step 4: 完了・失敗処理を実装する**

完了時は進捗・トリガー削除、flush、履歴、メール通知。異常時はトリガー削除、進捗と累計を残して履歴・通知へ記録する。ロックはUI／メール通知前に解放する。

- [ ] **Step 5: プレビューを共通計画へ接続する**

`previewTemplate`は最初の1商品を`planRakutenTemplateProduct_`で判定・更新し、Choiceなし／画像なしなら変更せずログとUIへ理由を表示する。

- [ ] **Step 6: 再開・冪等性テストを追加する**

- 200商品ごとに次位置を保存。
- 時間超過でトリガー1件。
- 再開時署名変更で書込み0。
- バッチ失敗時に次位置を進めない。
- 同じバッチ再実行でHTML画像が重複しない。
- 完了時に進捗・トリガー0。

### Task 5: ドキュメント・全体レビュー・push

**Files:**
- Modify: `README.md`
- Review: `src/Config.js`
- Review: `src/DistributorRakuten.js`
- Review: `src/Menu.js`
- Review: `test/*.test.js`

- [ ] **Step 1: READMEを更新する**

Choiceなし／画像なしは商品を変更せずダッシュボードへ記録すること、既存画像の完全置換、ALT可変、先頭改行除去、Driveバックアップ、自動再開、二重実行拒否を記載する。

- [ ] **Step 2: 仕様レビューを行う**

商品安全判定、HTML3列、画像60列、ログ分類、バックアップ、進捗、プレビュー共通化を確認する。

- [ ] **Step 3: 品質レビューを行う**

GASメモリ、シートI/O回数、ロック、トリガー重複、チェックポイント境界、数式保持、1万行fixtureを確認する。

- [ ] **Step 4: 全テスト・構文確認を実行する**

```bash
node --test test/*.test.js
for f in src/*.js test/*.js; do node --check "$f" || exit 1; done
```

- [ ] **Step 5: デプロイ先を確認してpushする**

```bash
cat .clasp.json
npx --yes @google/clasp push --force
```


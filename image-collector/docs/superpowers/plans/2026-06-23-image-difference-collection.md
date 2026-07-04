# 画像差分抽出 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 統合先と差分保存先の両方に存在しない画像だけを、`master`の参照フォルダから差分保存先へ安全にコピーする再開可能な処理を追加する。

**Architecture:** 通常集約の`Collector.js`は変更範囲を抑え、差分抽出を`DifferenceCollector.js`へ分離する。ファイル名セットと純粋な判定関数でドライランと本実行を同一ロジックにし、専用ScriptPropertiesとトリガーでチェックポイントを保持する。既存dashboard、実行履歴、メール通知の共通APIを再利用する。

**Tech Stack:** Google Apps Script V8、Google Sheets、Google Drive、PropertiesService、ScriptLock、時間主導トリガー、Node.js `node:test`。

**Note:** このディレクトリはGit管理外のためコミット手順は省略し、最終検証後にデプロイ先を確認して`clasp push --force`する。

---

### Task 1: 設定・メニュー・進捗キー

**Files:**
- Modify: `src/Config.js`
- Modify: `src/Menu.js`
- Test: `test/menu.test.js`
- Test: `test/reset-progress.test.js`
- Test: `test/settings.test.js`

- [ ] **Step 1: 設定とメニューの失敗テストを書く**

次を検証する。

```js
assert.equal(gas.SETTING_KEYS.DIFF_DEST_FOLDER_URL, '差分画像保存先フォルダURL');
assert.deepEqual(diffItems, [
  ['📋 差分抽出 ドライラン', 'showDifferenceDryRunDialog'],
  ['🚀 差分抽出 実行', 'showDifferenceCollectDialog'],
]);
```

`setupInitialSettings_(false)`が既存値を維持しながら新設定行を追加することも検証する。

- [ ] **Step 2: 進捗リセットの失敗テストを書く**

既存の期待配列へ以下を追加する。

```js
'IMG_DIFF_PROGRESS',
'IMG_DIFF_CONFIG',
'IMG_DIFF_QUEUE_CONFIG',
```

トリガー期待値へ以下を追加する。

```js
'runQueuedDifferenceCollect',
'resumeDifferenceCollect',
```

- [ ] **Step 3: テストが失敗することを確認する**

```bash
node --test test/menu.test.js test/reset-progress.test.js test/settings.test.js
```

Expected: 新しい設定キー、メニュー、進捗キーが未定義でFAIL。

- [ ] **Step 4: 定数と設定行を実装する**

`Config.js`へ追加する。

```js
SETTING_KEYS.DIFF_DEST_FOLDER_URL = '差分画像保存先フォルダURL';
PROP_KEYS.DIFF_PROGRESS = 'IMG_DIFF_PROGRESS';
PROP_KEYS.DIFF_CONFIG = 'IMG_DIFF_CONFIG';
PROP_KEYS.DIFF_QUEUE_CONFIG = 'IMG_DIFF_QUEUE_CONFIG';
```

`settingRows`では統合先の直後へ次を追加する。

```js
[SETTING_KEYS.DIFF_DEST_FOLDER_URL, '', '統合先にない新規画像だけを保存するGoogle DriveフォルダURL'],
```

- [ ] **Step 5: 差分抽出サブメニューとリセット対象を実装する**

ルートメニューへ専用サブメニューを追加する。

```js
.addSubMenu(ui.createMenu('🆕 画像差分抽出')
  .addItem('📋 差分抽出 ドライラン', 'showDifferenceDryRunDialog')
  .addItem('🚀 差分抽出 実行', 'showDifferenceCollectDialog'))
```

`getProgressPropertyKeys_()`と`getProgressTriggerNames_()`へ専用キー・関数名を追加する。

- [ ] **Step 6: 対象テストを通す**

```bash
node --test test/menu.test.js test/reset-progress.test.js test/settings.test.js
```

Expected: PASS。

### Task 2: 差分判定とファイルコピー

**Files:**
- Create: `src/DifferenceCollector.js`
- Create: `test/difference-collector.test.js`

- [ ] **Step 1: 純粋な差分判定の失敗テストを書く**

```js
assert.equal(gas.classifyDifferenceFile_('A.JPG', { 'a.jpg': true }, {}), 'INTEGRATED');
assert.equal(gas.classifyDifferenceFile_('A.JPG', {}, { 'a.jpg': true }), 'DIFF_EXISTS');
assert.equal(gas.classifyDifferenceFile_('A.JPG', {}, {}), 'NEW');
```

比較順が統合先、差分保存先、新規の順であることを検証する。

- [ ] **Step 2: コピー関数の失敗テストを書く**

`copyDifferenceFilesFromFolder_`について次を検証する。

- MIMEが`image/*`でないファイルはコピーしない。
- 統合先の同名は`integratedSkipped`へ数える。
- 差分保存先の同名は`diffExistingSkipped`へ数える。
- 新規画像だけ`makeCopy`する。
- 大文字・小文字違いは同名とする。
- 成功後だけ差分セットへ追加する。
- ドライランでも差分セットへ仮追加し、後続同名を二重計上しない。

- [ ] **Step 3: 対象テストが失敗することを確認する**

```bash
node --test test/difference-collector.test.js
```

Expected: `classifyDifferenceFile_ is not defined`でFAIL。

- [ ] **Step 4: 判定とコピーを実装する**

```js
function classifyDifferenceFile_(fileName, integratedFiles, differenceFiles) {
  var key = String(fileName).toLowerCase();
  if (integratedFiles[key]) return 'INTEGRATED';
  if (differenceFiles[key]) return 'DIFF_EXISTS';
  return 'NEW';
}
```

戻り値は以下の固定形にする。

```js
{
  copied: 0,
  integratedSkipped: 0,
  diffExistingSkipped: 0,
  nonImages: 0,
  errors: 0,
  total: 0,
  details: [],
}
```

- [ ] **Step 5: 対象テストを通す**

```bash
node --test test/difference-collector.test.js
```

Expected: PASS。

### Task 3: 入力検証・行処理・ダッシュボード

**Files:**
- Modify: `src/DifferenceCollector.js`
- Test: `test/difference-collector.test.js`

- [ ] **Step 1: 実行コンテキスト検証の失敗テストを書く**

`loadDifferenceCollectContext_`がDriveコピー前に次を拒否することを検証する。

- 統合先URLなし。
- 差分保存先URLなし。
- `master`なし。
- `管理番号`または`フォルダリンク`なし。
- 統合先と差分保存先が同じフォルダID。

- [ ] **Step 2: 行処理の失敗テストを書く**

`processDifferenceCollectRows_`について次を検証する。

- 同一ソースフォルダIDは最初の1行だけ走査する。
- 空行は`データなし`としてスキップする。
- アクセス失敗行の後も処理を続行する。
- 行ログにコピー数、統合済み数、差分コピー済み数、エラー理由を含める。
- ドライランではDrive書込み0件。

- [ ] **Step 3: 集計構造を実装する**

専用統計は通常集約と混同せず、次の形にする。

```js
{
  processedRows: 0,
  copied: 0,
  integratedSkipped: 0,
  diffExistingSkipped: 0,
  otherSkipped: 0,
  errorCount: 0,
}
```

再開用の`buildDifferenceCheckpoint_`と`restoreDifferenceStats_`を純粋関数として追加する。

- [ ] **Step 4: ダッシュボード連携を実装する**

開始時は既存`initDashboard_`を使い、状態は次の文言を使う。

```text
📋 差分抽出ドライラン実行中
🆕 差分抽出処理中
⏸️ 差分抽出中断(再開待ち)
✅ 差分抽出完了
```

詳細行の備考に分類別件数を記録する。既存dashboardの列構造は変更しない。

- [ ] **Step 5: 対象テストを通す**

```bash
node --test test/difference-collector.test.js
```

Expected: PASS。

### Task 4: 予約・ロック・自動再開

**Files:**
- Modify: `src/DifferenceCollector.js`
- Modify: `src/Menu.js`
- Test: `test/difference-collector.test.js`
- Test: `test/menu.test.js`

- [ ] **Step 1: 公開エントリーポイントの失敗テストを書く**

追加する関数を直接検証する。

```js
showDifferenceDryRunDialog();
showDifferenceCollectDialog();
startDifferenceDryRun(dialogConfig);
startDifferenceCollect(dialogConfig);
runQueuedDifferenceCollect();
resumeDifferenceCollect();
```

次の順序と安全性を検証する。

- 確認ダイアログ後にロックを取得する。
- `tryLock`失敗時はプロパティ・トリガー・Driveを変更しない。
- 予約、進捗、再開トリガーのいずれかがあれば新規開始を拒否し、既存状態を保持する。
- ロック取得失敗時は`releaseLock`しない。
- UI通知前にロックを解放する。

- [ ] **Step 2: チェックポイントの失敗テストを書く**

- 制限時間到達前の未処理行インデックスを保存する。
- 累計分類件数を保存する。
- 再開トリガーは1件だけ作る。
- 再開時は保存行から開始する。
- 再開時に差分保存先のファイル一覧を再取得する。
- コピー成功済み行より後へ進捗を進める。
- 完了時に3プロパティと2トリガーを削除する。

- [ ] **Step 3: 予約実行を実装する**

`startDifferenceCollect`はJSON設定を`DIFF_QUEUE_CONFIG`へ保存し、`runQueuedDifferenceCollect`を約1秒後に予約する。予約関数は共通ScriptLockを取得し、競合時は設定を戻して約1分後へ再予約する。

- [ ] **Step 4: 時間中断と再開を実装する**

行処理前に`Date.now() - startedAt >= EXEC_CONFIG.TIME_LIMIT_MS`を判定する。中断時は現在の行インデックスと統計を保存し、既存の同名再開トリガーを削除してから1件だけ作成する。

- [ ] **Step 5: 完了・異常終了通知を実装する**

成功時は`completeOperation_`へ次を渡す。

```js
{
  operation: '画像差分抽出',
  mode: isDryRun ? 'ドライラン' : '本実行',
  status: '完了',
  success: stats.copied,
  skipped: stats.integratedSkipped + stats.diffExistingSkipped + stats.otherSkipped,
  errors: stats.errorCount,
}
```

異常終了時は進捗を残し、履歴・メールへ現在位置と累計を記録する。

- [ ] **Step 6: 対象テストを通す**

```bash
node --test test/difference-collector.test.js test/menu.test.js test/reset-progress.test.js
```

Expected: PASS。

### Task 5: 回帰・ドキュメント・デプロイ

**Files:**
- Modify: `README.md`
- Review: `src/Config.js`
- Review: `src/DifferenceCollector.js`
- Review: `src/Menu.js`
- Review: `test/*.test.js`

- [ ] **Step 1: READMEへ利用手順と制約を追加する**

次を明記する。

- 統合先と差分保存先のどちらにもない画像だけをコピーする。
- 同名判定は大文字・小文字を区別しない。
- 同名で内容だけ変わった画像は対象外。
- 比較元・コピー元は変更しない。
- 再実行時は差分保存先の既存画像もスキップする。
- ドライラン、自動再開、dashboard、通知の使い方。

- [ ] **Step 2: 仕様チェックを行う**

設計書の各節について、設定、メニュー、3段階判定、直下画像、重複フォルダ、ドライラン、進捗、ロック、ログ、エラー処理、テストの対応箇所を確認する。

- [ ] **Step 3: 全テストと構文確認を実行する**

```bash
node --test test/*.test.js
for f in src/*.js test/*.js; do node --check "$f" || exit 1; done
```

Expected: 全テストPASS、構文エラー0件。

- [ ] **Step 4: デプロイ先を確認する**

```bash
cat .clasp.json
```

Expected:

```json
{
  "scriptId": "12xVenQQgR8xGbDQh-tw-iGYI9NrVuHYQgrm299U1g9kCuFiVUDvh-WO8",
  "parentId": "1rri4ZVCPszLIreCuPA36_W1p12HXmHmJuzSK4HRVlgM"
}
```

- [ ] **Step 5: GASへ反映する**

```bash
npx --yes @google/clasp push --force
```

Expected: `DifferenceCollector.js`を含む全ソースがpushされる。


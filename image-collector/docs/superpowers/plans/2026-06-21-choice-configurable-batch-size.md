# Choice Configurable Batch Size Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Choice画像配置を`setting`の初期値70MBで分割し、未使用の楽天バッチサイズ設定を廃止する。

**Architecture:** `Config.js`にChoice専用設定キーと既定値を定義し、`Distributor.js`の事前検証で1〜80MBに正規化してバッチ分割関数へバイト値を渡す。`Menu.js`の差分更新で旧楽天設定行を削除し、Choiceダイアログは検証済みの設定値を表示する。

**Tech Stack:** Google Apps Script V8、Google Sheets、Node.js `node:test`、clasp

---

### Task 1: 設定キーと旧楽天設定の移行

**Files:**
- Modify: `src/Config.js`
- Modify: `src/Menu.js`
- Test: `test/setup-columns.test.js`

- [ ] **Step 1: 旧楽天行だけを削除する失敗テストを書く**

`setupInitialSettings_(false)`を既存settingシートに対して実行し、`楽天画像バッチサイズ(MB)`が消え、既存のURL・メール・任意設定値が保持され、`Choiceバッチサイズ(MB)`が`70`で追加されることを検証する。テスト用Sheetモックへ次を追加する。

```js
deleteRow(row) {
  this.values.splice(row - 1, 1);
}
```

- [ ] **Step 2: 失敗を確認する**

Run:

```bash
node --test test/setup-columns.test.js
```

Expected: `Choiceバッチサイズ(MB)`が存在せず、楽天行が残るためFAIL。

- [ ] **Step 3: Choice設定と移行処理を実装する**

`src/Config.js`へ追加する。

```js
CHOICE_BATCH_SIZE_MB: 'Choiceバッチサイズ(MB)',
```

```js
var CHOICE_CONFIG = {
  DEFAULT_BATCH_SIZE_MB: 70,
  MAX_BATCH_SIZE_MB: 80,
};
```

`SETTING_KEYS.RAKUTEN_BATCH_SIZE_MB`と`RAKUTEN_CONFIG.DEFAULT_BATCH_SIZE_MB`を削除する。`src/Menu.js`のChoice設定行へ追加し、楽天設定行から旧項目を削除する。

```js
[SETTING_KEYS.CHOICE_BATCH_SIZE_MB, String(CHOICE_CONFIG.DEFAULT_BATCH_SIZE_MB),
  'Choice画像の1バッチあたりの容量制限（1〜80MB）'],
```

既存シートの差分計算前に、旧キーを末尾から削除する。

```js
function removeObsoleteSettingRows_(sheet, obsoleteKeys) {
  var values = sheet.getDataRange().getValues();
  for (var row = values.length - 1; row >= 0; row--) {
    if (obsoleteKeys.indexOf(String(values[row][0]).trim()) !== -1) {
      sheet.deleteRow(row + 1);
    }
  }
}
```

```js
removeObsoleteSettingRows_(sheet, ['楽天画像バッチサイズ(MB)']);
```

- [ ] **Step 4: 設定移行テストを通す**

Run:

```bash
node --test test/setup-columns.test.js
```

Expected: PASS。Gitリポジトリではないためコミット工程は実施しない。

### Task 2: Choiceバッチサイズの検証と分割

**Files:**
- Modify: `src/Distributor.js`
- Modify: `src/Config.js`
- Test: `test/choice-batches.test.js`

- [ ] **Step 1: サイズ検証の失敗テストを書く**

次の境界を検証する。

```js
assert.equal(gas.parseChoiceBatchSizeMb_('70'), 70);
assert.equal(gas.parseChoiceBatchSizeMb_('1'), 1);
assert.equal(gas.parseChoiceBatchSizeMb_('80'), 80);
assert.throws(() => gas.parseChoiceBatchSizeMb_(''), /Choiceバッチサイズ/);
assert.throws(() => gas.parseChoiceBatchSizeMb_('abc'), /Choiceバッチサイズ/);
assert.throws(() => gas.parseChoiceBatchSizeMb_('0'), /1〜80/);
assert.throws(() => gas.parseChoiceBatchSizeMb_('81'), /1〜80/);
```

- [ ] **Step 2: 70MB境界の失敗テストを書く**

40MBの商品を2件渡し、70MBでは2バッチ、80MBでは1バッチになることを検証する。

```js
const MB = 1024 * 1024;
const items = [1, 2].map((rowIndex) => ({
  rowIndex,
  files: [{ fileInfo: { size: 40 * MB } }],
}));
assert.deepEqual(gas._splitIntoBatches(items, 70 * MB).map((b) => b.items.length), [1, 1]);
assert.deepEqual(gas._splitIntoBatches(items, 80 * MB).map((b) => b.items.length), [2]);
```

- [ ] **Step 3: 失敗を確認する**

Run:

```bash
node --test test/choice-batches.test.js
```

Expected: 検証関数未定義、または分割関数が引数を使わないためFAIL。

- [ ] **Step 4: 検証関数と可変分割を実装する**

```js
function parseChoiceBatchSizeMb_(value) {
  var text = String(value == null ? '' : value).trim();
  var size = Number(text);
  if (!text || !isFinite(size) || size < 1 || size > CHOICE_CONFIG.MAX_BATCH_SIZE_MB) {
    throw new Error('Choiceバッチサイズ(MB)は1〜80の数値で設定してください。');
  }
  return size;
}
```

`validateChoicePreRequisitesReadOnly_()`で設定を読み、戻り値へ`batchSizeMB`を追加する。

```js
var batchSizeMB = parseChoiceBatchSizeMb_(
  getSettingValue_(SETTING_KEYS.CHOICE_BATCH_SIZE_MB)
);
```

分割関数を明示的な上限値へ変更する。

```js
function _splitIntoBatches(matchResults, maxBatchSizeBytes) {
  var batches = [];
  var currentBatch = { items: [], totalSize: 0, totalFiles: 0 };
  for (var i = 0; i < matchResults.length; i++) {
    var item = matchResults[i];
    var itemSize = 0;
    for (var f = 0; f < item.files.length; f++) {
      itemSize += item.files[f].fileInfo.size;
    }
    if (currentBatch.items.length > 0 &&
        currentBatch.totalSize + itemSize > maxBatchSizeBytes) {
      batches.push(currentBatch);
      currentBatch = { items: [], totalSize: 0, totalFiles: 0 };
    }
    currentBatch.items.push(item);
    currentBatch.totalSize += itemSize;
    currentBatch.totalFiles += item.files.length;
  }
  if (currentBatch.items.length > 0) batches.push(currentBatch);
  return batches;
}
```

呼び出し側は次の形式にする。

```js
var batches = _splitIntoBatches(matchResults, batchSizeMB * 1024 * 1024);
```

- [ ] **Step 5: Choiceテストを通す**

Run:

```bash
node --test test/choice-batches.test.js
```

Expected: PASS。Gitリポジトリではないためコミット工程は実施しない。

### Task 3: ダイアログと文書を設定値へ同期

**Files:**
- Modify: `src/Menu.js`
- Modify: `README.md`
- Test: `test/choice-batches.test.js`

- [ ] **Step 1: ダイアログ表示の失敗テストを書く**

```js
const html = gas._buildChoiceDistDialogHtml({
  tsvRowCount: 1,
  imageColCount: 9,
  mgmtCodeFound: true,
  batchSizeMB: 70,
}, false);
assert.match(html, /70MB/);
assert.doesNotMatch(html, /80MB単位/);
```

- [ ] **Step 2: 失敗を確認する**

Run:

```bash
node --test test/choice-batches.test.js
```

Expected: 80MB固定文言が残るためFAIL。

- [ ] **Step 3: 検証結果と表示を接続する**

`_validateChoicePreRequisites()`の戻り値へ追加する。

```js
batchSizeMB: validation.batchSizeMB,
```

`_buildChoiceDistDialogHtml()`では次のローカル値を使い、説明、処理行、注記を置換する。

```js
var batchSizeLabel = validation.batchSizeMB + 'MB';
```

ヘルプは「`setting`のChoiceバッチサイズで分割」と表現し、READMEには初期値70MB、設定可能範囲1〜80MB、Choice出力先だけを削除するやり直し手順を記載する。

- [ ] **Step 4: 表示テストを通す**

Run:

```bash
node --test test/choice-batches.test.js
```

Expected: PASS。Gitリポジトリではないためコミット工程は実施しない。

### Task 4: 全体検証とGAS反映

**Files:**
- Verify: `src/*.js`
- Verify: `test/*.test.js`
- Deploy: `.clasp.json`の佐渡市Script ID

- [ ] **Step 1: 固定80MBと旧楽天設定の残存を確認する**

Run:

```bash
rg -n "80MB|RAKUTEN_BATCH_SIZE_MB|楽天画像バッチサイズ" src README.md test
```

Expected: 意図した上限説明・移行対象文字列以外に固定処理が残っていない。

- [ ] **Step 2: 全JavaScriptファイルの構文を確認する**

Run:

```bash
for f in src/*.js; do node --check "$f"; done
```

Expected: exit 0。

- [ ] **Step 3: 全テストを実行する**

Run:

```bash
node --test test/*.test.js
```

Expected: failure 0。

- [ ] **Step 4: 配布先を確認して反映する**

Run:

```bash
cat .clasp.json
clasp push
```

Expected: Script ID `12xVenQQgR8xGbDQh-tw-iGYI9NrVuHYQgrm299U1g9kCuFiVUDvh-WO8`へ全ファイルがpushされる。

- [ ] **Step 5: 運用手順を報告する**

「初期設定（差分更新）」を実行後、Choice出力先の旧`batch_...`と旧`tsv_b...`を削除し、ドライラン、配置実行の順にやり直す。統合先の元画像は削除しない。

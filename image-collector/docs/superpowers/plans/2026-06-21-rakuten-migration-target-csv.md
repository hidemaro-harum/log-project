# 楽天番号移行対象CSV Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `number_mapping`に記載された楽天商品ブロックだけを確認用シートへ生成し、確認後にShift-JIS CSVとしてダウンロードできるようにする。

**Architecture:** `NumberMigration.js`に純粋な商品ブロック抽出・検証関数を追加し、その結果だけを`rakuten_migration_csv`へ書き込む。生成とダウンロードを別メニューにし、ダウンロードは確認用シートを再検証してから既存のShift-JIS出力を呼ぶ。

**Tech Stack:** Google Apps Script V8、Google Sheets、Node.js `node:test`、既存の`downloadCsvShiftJis_`。

**Note:** このワークスペースはGitリポジトリではないため、各タスクのコミット手順は省略する。最終確認後に`clasp push --force`で対象GASへ反映する。

---

### Task 1: 対象商品ブロック抽出と変換済み検証

**Files:**
- Modify: `src/NumberMigration.js`
- Test: `test/number-migration.test.js`

- [ ] **Step 1: 対象商品だけを全行抽出する失敗テストを書く**

`test/number-migration.test.js`へ、対象シングル、対象外商品、対象マルチを混在させたテストを追加する。結果はヘッダー、対象シングルの商品行・SKU行、対象マルチの商品行・選択肢行・全SKU行だけを元順序で保持する。

```js
test('buildRakutenMigrationTargetCsv_ keeps complete mapped product blocks only', () => {
  const gas = loadGas(['src/NumberMigration.js']);
  const mapping = gas.parseNumberMapping_(mappingRows);
  const data = [
    ['商品管理番号（商品URL）','商品番号','商品名','選択肢タイプ','SKU管理番号','システム連携用SKU番号','任意列'],
    ['url-single','new-1','商品1','','','','keep-product'],
    ['url-single','','','','sku-1','new-1','keep-sku'],
    ['url-other','other','対象外','','','','drop'],
    ['url-other','','','','other-sku','other','drop'],
    ['url-multi','new-m','商品M','','','','keep-product'],
    ['url-multi','','','SELECT','','','keep-option'],
    ['url-multi','','','','sku-a','new-a','keep-a'],
    ['url-multi','','','','sku-b','new-b','keep-b'],
  ];

  const result = gas.buildRakutenMigrationTargetCsv_(data, mapping);

  assert.deepEqual(plain(result.errors), []);
  assert.equal(result.productCount, 2);
  assert.deepEqual(plain(result.data.map(row => row[6])), [
    '任意列','keep-product','keep-sku','keep-product','keep-option','keep-a','keep-b'
  ]);
});
```

- [ ] **Step 2: 対象0件、対照表URL欠落、未変換を拒否する失敗テストを書く**

```js
test('buildRakutenMigrationTargetCsv_ reports every missing mapped URL', () => {
  const gas = loadGas(['src/NumberMigration.js']);
  const mapping = gas.parseNumberMapping_(mappingRows);
  const data = [
    ['商品管理番号（商品URL）','商品番号','商品名','選択肢タイプ','SKU管理番号','システム連携用SKU番号'],
    ['url-single','new-1','商品1','','',''],
    ['url-single','','','','sku-1','new-1'],
  ];
  const result = gas.buildRakutenMigrationTargetCsv_(data, mapping);
  assert.ok(result.errors.some(error => /url-multi/.test(error) && /見つかりません/.test(error)));
});

test('buildRakutenMigrationTargetCsv_ rejects mapped rows that still use old numbers', () => {
  const gas = loadGas(['src/NumberMigration.js']);
  const mapping = gas.parseNumberMapping_([mappingRows[0], mappingRows[1]]);
  const data = [
    ['商品管理番号（商品URL）','商品番号','商品名','選択肢タイプ','SKU管理番号','システム連携用SKU番号'],
    ['url-single','old-1','商品1','','',''],
    ['url-single','','','','sku-1','old-1'],
  ];
  const result = gas.buildRakutenMigrationTargetCsv_(data, mapping);
  assert.ok(result.errors.some(error => /④ 楽天変換実行/.test(error)));
});
```

- [ ] **Step 3: 対象テストを実行して失敗を確認する**

Run:

```bash
node --test --test-name-pattern='buildRakutenMigrationTargetCsv_' test/number-migration.test.js
```

Expected: `buildRakutenMigrationTargetCsv_ is not a function`でFAIL。

- [ ] **Step 4: 純粋な抽出・検証関数を実装する**

`src/NumberMigration.js`へ次の責務を持つ`buildRakutenMigrationTargetCsv_(data, mapping)`を追加する。

```js
function buildRakutenMigrationTargetCsv_(data, mapping) {
  var required = requiredNmHeaders_(data, [
    '商品管理番号（商品URL）', '商品番号', '商品名',
    '選択肢タイプ', 'SKU管理番号', 'システム連携用SKU番号'
  ]);
  var result = { data: [], errors: mapping.errors.slice().concat(required.errors), productCount: 0 };
  if (result.errors.length) return result;

  var columns = required.map;
  var blocks = [];
  var current = null;
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var isProduct = numberText_(row[columns['商品名']]) &&
      !numberText_(row[columns['SKU管理番号']]) &&
      !numberText_(row[columns['選択肢タイプ']]);
    if (isProduct) {
      if (current) blocks.push(current);
      current = {
        url: numberText_(row[columns['商品管理番号（商品URL）']]),
        rows: []
      };
    }
    if (current) current.rows.push(row.slice());
  }
  if (current) blocks.push(current);

  var found = {};
  result.data = [data[0].slice()];
  blocks.forEach(function(block) {
    var key = numberKey_(block.url);
    if (!mapping.byUrl[key]) return;
    found[key] = true;
    result.productCount++;
    block.rows.forEach(function(row) { result.data.push(row); });
  });
  Object.keys(mapping.byUrl).forEach(function(key) {
    if (!found[key]) result.errors.push('商品管理番号（商品URL）「' + mapping.byUrl[key].rows[0].url + '」がrakuten_csvに見つかりません');
  });
  if (result.productCount === 0) result.errors.push('番号移行対象の商品がありません');

  var migrationPlan = planRakutenNumberMigration_(result.data, mapping);
  result.errors = result.errors.concat(migrationPlan.errors);
  if (migrationPlan.changes.length) {
    result.errors.push('未変換の番号が' + migrationPlan.changes.length + '件あります。④ 楽天変換実行を先に実行してください');
  }
  return result;
}
```

実装時は同一URLの商品ブロック重複もエラーにし、空行だけの末尾は出力しない。エラーは途中returnせず、欠落URLを全件集約する。

- [ ] **Step 5: 対象テストを実行して成功を確認する**

Run:

```bash
node --test --test-name-pattern='buildRakutenMigrationTargetCsv_' test/number-migration.test.js
```

Expected: 追加した全テストがPASS。

### Task 2: 確認用シート生成

**Files:**
- Modify: `src/Config.js`
- Modify: `src/NumberMigration.js`
- Test: `test/number-migration.test.js`

- [ ] **Step 1: シート生成の失敗テストを書く**

GASモックで`rakuten_csv`、`number_mapping`、`rakuten_migration_csv`を用意し、`generateRakutenMigrationCsv()`が確認用シートだけをクリア・拡張・書込することを検証する。元の2シートへの`setValues`は0回、生成シートへの書込は1回とする。

```js
test('generateRakutenMigrationCsv writes only the preview sheet after validation', () => {
  const sourceData = [
    ['商品管理番号（商品URL）','商品番号','商品名','選択肢タイプ','SKU管理番号','システム連携用SKU番号'],
    ['url-single','new-1','商品1','','',''],
    ['url-single','','','','sku-1','new-1'],
  ];
  const previewWrites = [];
  let previewClears = 0;
  const source = { getDataRange: () => ({ getValues: () => plain(sourceData) }) };
  const preview = {
    getMaxRows: () => 100,
    getMaxColumns: () => 30,
    clearContents() { previewClears++; },
    getRange(row, col, rows, cols) {
      return { setValues(values) { previewWrites.push({ row, col, rows, cols, values }); } };
    },
    setFrozenRows() {},
  };
  const ss = {
    getSheetByName(name) {
      if (name === 'rakuten_csv') return source;
      if (name === 'rakuten_migration_csv') return preview;
      return null;
    },
  };
  const gas = loadGas(['src/Config.js','src/NumberMigration.js'], {
    SpreadsheetApp: { getActiveSpreadsheet: () => ss, getUi: () => ({}) },
  });
  gas.loadNumberMapping_ = () => gas.parseNumberMapping_([mappingRows[0], mappingRows[1]]);
  gas.recordOperationResult_ = () => {};
  gas.notifyMessage_ = () => {};

  gas.generateRakutenMigrationCsv();

  assert.equal(previewClears, 1);
  assert.deepEqual(plain(previewWrites[0].values), sourceData);
});

test('generateRakutenMigrationCsv clears a stale preview when validation fails', () => {
  let previewClears = 0;
  const preview = { clearContents() { previewClears++; } };
  const ss = {
    getSheetByName(name) {
      if (name === 'rakuten_csv') return { getDataRange: () => ({ getValues: () => [] }) };
      if (name === 'rakuten_migration_csv') return preview;
      return null;
    },
  };
  const gas = loadGas(['src/Config.js','src/NumberMigration.js'], {
    SpreadsheetApp: { getActiveSpreadsheet: () => ss, getUi: () => ({}) },
  });
  gas.loadNumberMapping_ = () => gas.parseNumberMapping_([mappingRows[0], mappingRows[1]]);
  gas.recordOperationResult_ = () => {};
  gas.notifyMessage_ = () => {};

  gas.generateRakutenMigrationCsv();

  assert.equal(previewClears, 1);
});
```

生成エラー時には既存確認用シートが`clearContents()`され、古いデータを残さないテストも追加する。

- [ ] **Step 2: テストを実行して失敗を確認する**

Run:

```bash
node --test --test-name-pattern='generateRakutenMigrationCsv' test/number-migration.test.js
```

Expected: 関数未定義でFAIL。

- [ ] **Step 3: シート名と生成関数を実装する**

`src/Config.js`の`SHEET_NAMES`へ追加する。

```js
RAKUTEN_MIGRATION_CSV: 'rakuten_migration_csv',
```

`src/NumberMigration.js`へ以下を追加する。

```js
function ensureNumberMigrationSheetSize_(sheet, rows, columns) {
  if (sheet.getMaxRows() < rows) sheet.insertRowsAfter(sheet.getMaxRows(), rows - sheet.getMaxRows());
  if (sheet.getMaxColumns() < columns) sheet.insertColumnsAfter(sheet.getMaxColumns(), columns - sheet.getMaxColumns());
}

function generateRakutenMigrationCsv() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ui = SpreadsheetApp.getUi();
  var preview = ss.getSheetByName(SHEET_NAMES.RAKUTEN_MIGRATION_CSV);
  try {
    var source = ss.getSheetByName(SHEET_NAMES.RAKUTEN_CSV);
    if (!source) throw new Error('rakuten_csvシートがありません');
    var mapping = loadNumberMapping_();
    var result = buildRakutenMigrationTargetCsv_(source.getDataRange().getValues(), mapping);
    if (result.errors.length) throw new Error(result.errors.join('\n'));
    if (!preview) preview = ss.insertSheet(SHEET_NAMES.RAKUTEN_MIGRATION_CSV);
    ensureNumberMigrationSheetSize_(preview, result.data.length, result.data[0].length);
    preview.clearContents();
    preview.getRange(1, 1, result.data.length, result.data[0].length).setValues(result.data);
    preview.setFrozenRows(1);
    recordOperationResult_({ operation: '楽天番号移行対象CSV', mode: 'シート生成', status: '完了', success: result.data.length - 1 });
    notifyMessage_(ui, ss, '生成完了', '対象商品: ' + result.productCount + '件\nデータ行: ' + (result.data.length - 1) + '行');
  } catch (error) {
    if (preview) preview.clearContents();
    var message = error && error.message ? error.message : String(error);
    recordOperationResult_({ operation: '楽天番号移行対象CSV', mode: 'シート生成', status: '失敗', errors: 1, detail: message });
    notifyMessage_(ui, ss, '生成エラー', message);
  }
}
```

- [ ] **Step 4: 生成テストを実行して成功を確認する**

Run:

```bash
node --test --test-name-pattern='generateRakutenMigrationCsv' test/number-migration.test.js
```

Expected: 追加テストがPASS。

### Task 3: 確認用シートのダウンロード

**Files:**
- Modify: `src/NumberMigration.js`
- Test: `test/number-migration.test.js`

- [ ] **Step 1: ダウンロード元を固定する失敗テストを書く**

`downloadRakutenMigrationCsv()`が`rakuten_migration_csv`を読み、`rakuten_csv`は読まず、確認後に`downloadCsvShiftJis_(data, 'normal-item.csv', ...)`を1回呼ぶことを検証する。空シート、必須ヘッダー不足、現在の対照表にない商品混入ではダウンロード0回とする。

- [ ] **Step 2: テストを実行して失敗を確認する**

Run:

```bash
node --test --test-name-pattern='downloadRakutenMigrationCsv' test/number-migration.test.js
```

Expected: 関数未定義でFAIL。

- [ ] **Step 3: 再検証付きダウンロード関数を実装する**

```js
function downloadRakutenMigrationCsv() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ui = SpreadsheetApp.getUi();
  var sheet = ss.getSheetByName(SHEET_NAMES.RAKUTEN_MIGRATION_CSV);
  if (!sheet || sheet.getLastRow() < 2) {
    notifyMessage_(ui, ss, 'エラー', '⑤ 楽天番号移行対象CSVを生成してください');
    return;
  }
  var data = sheet.getDataRange().getValues();
  var mapping = loadNumberMapping_();
  var rebuilt = buildRakutenMigrationTargetCsv_(data, mapping);
  var errors = rebuilt.errors.slice();
  if (rebuilt.data.length !== data.length) errors.push('確認用シートに番号移行対象外の商品が含まれています');
  errors = errors.concat(validateRakutenExportRows_(data, getRakutenCsvHeaders()));
  if (errors.length) {
    notifyMessage_(ui, ss, '出力前チェックエラー', errors.slice(0, 20).join('\n'));
    return;
  }
  var confirm = ui.alert('CSVダウンロード（楽天番号移行対象）',
    '確認済みシートをnormal-item.csvとして出力します。\n対象行数: ' + (data.length - 1) + '行',
    ui.ButtonSet.YES_NO);
  if (confirm !== ui.Button.YES) return;
  downloadCsvShiftJis_(data, 'normal-item.csv', '楽天番号移行対象CSV作成中...');
  recordOperationResult_({ operation: '楽天番号移行対象CSV', mode: 'ダウンロード', status: '生成完了', success: data.length - 1 });
}
```

- [ ] **Step 4: ダウンロードテストを実行して成功を確認する**

Run:

```bash
node --test --test-name-pattern='downloadRakutenMigrationCsv' test/number-migration.test.js
```

Expected: 追加テストがPASS。

### Task 4: メニュー・ドキュメント・全体検証

**Files:**
- Modify: `src/Menu.js`
- Modify: `README.md`
- Test: `test/smoke.test.js`または`test/number-migration.test.js`

- [ ] **Step 1: メニュー関数参照の失敗テストを追加する**

番号移行メニューに`⑤ 楽天番号移行対象CSVを生成`と`⑥ 楽天番号移行対象CSVをダウンロード`があり、対応するグローバル関数が存在することを静的テストで確認する。

- [ ] **Step 2: メニューを更新する**

`src/Menu.js`の番号移行サブメニューを次の順序へ変更する。

```js
.addItem('⑤ 楽天番号移行対象CSVを生成', 'generateRakutenMigrationCsv')
.addItem('⑥ 楽天番号移行対象CSVをダウンロード', 'downloadRakutenMigrationCsv')
.addItem('⑦ ANAドライラン', 'dryRunAnaNumberMigration')
.addItem('⑧ ANA備考反映実行', 'executeAnaNumberMigration')
.addItem('⑨ 番号移行ダッシュボード', 'showNumberMigrationDashboard')
```

- [ ] **Step 3: READMEへ操作順と抽出条件を追加する**

番号移行の実行順序へ⑤・⑥を追加し、対象URLの商品ブロック全体だけを`rakuten_migration_csv`へ生成すること、元シートを変更しないこと、確認後にShift-JISでダウンロードすることを記載する。

- [ ] **Step 4: 全テストと構文確認を実行する**

Run:

```bash
node --test test/*.test.js
for f in src/*.js test/*.js; do node --check "$f" || exit 1; done
```

Expected: 全テストPASS、構文エラー0件。

- [ ] **Step 5: デプロイ先を確認してGASへ反映する**

Run:

```bash
cat .clasp.json
npx --yes @google/clasp push --force
```

Expected: `scriptId`が`12xVenQQgR8xGbDQh-tw-iGYI9NrVuHYQgrm299U1g9kCuFiVUDvh-WO8`、`parentId`が対象スプレッドシート、12ファイル以上のpush成功。

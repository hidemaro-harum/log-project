# Sado Portal Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 弥彦の実績ある変換ロジックを限定移植し、佐渡の楽天HTML変換、CSV出力、ANA JPEG配置、バッチ管理を修正する。

**Architecture:** GAS APIに依存しない変換を小さな純粋関数へ分離し、Node標準テストで検証する。GASのシート・Drive処理は既存エントリーポイントを維持し、純粋関数の結果だけを書き込む。

**Tech Stack:** Google Apps Script V8、Node.js `node:test`、`vm`、clasp

**Repository note:** このプロジェクトはGit管理外のため、各タスクのコミット手順は検証チェックポイントに置き換える。

---

## File Structure

- Create: `test/load-gas.js` - GASグローバルスクリプトをNode VMへ読み込む。
- Create: `test/csv.test.js` - CSVエスケープと列射影を検証する。
- Create: `test/rakuten-template.test.js` - Choice照合、テンプレート置換、画像列検出を検証する。
- Create: `test/choice-batches.test.js` - 内部列と古いバッチシート処理を検証する。
- Create: `test/ana.test.js` - JPEG変換計画とANA列射影を検証する。
- Create: `test/reset-progress.test.js` - リセット対象のプロパティとトリガーを検証する。
- Modify: `src/Utils.js` - 共通CSV文字列、ダウンロード、列射影を実装する。
- Modify: `src/DistributorRakuten.js` - 弥彦由来のHTML変換ヘルパーと画像列検出を実装する。
- Modify: `src/DistributorANA.js` - JPEG変換、CSV列制限、マーキング再利用を実装する。
- Modify: `src/Distributor.js` - Choice内部列除外と古いバッチシート削除を実装する。
- Modify: `src/Menu.js` - 楽天ログシート初期化とANA進捗リセットを実装する。
- Modify: `src/Config.js` - 楽天初期画像ヘッダー順を修正する。
- Modify: `README.md` - 変換契約と出力仕様を記載する。

### Task 1: Node回帰テスト基盤

**Files:**
- Create: `test/load-gas.js`
- Create: `test/smoke.test.js`

- [ ] **Step 1: GASローダーと最初のテストを書く**

```js
// test/load-gas.js
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadGas(files, globals) {
  const context = vm.createContext(Object.assign({ console }, globals || {}));
  files.forEach((file) => {
    const fullPath = path.resolve(__dirname, '..', file);
    vm.runInContext(fs.readFileSync(fullPath, 'utf8'), context, { filename: fullPath });
  });
  return context;
}

module.exports = { loadGas };
```

```js
// test/smoke.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadGas } = require('./load-gas');

test('loads GAS utility functions in a Node VM', () => {
  const gas = loadGas(['src/Config.js', 'src/Utils.js']);
  assert.equal(gas.padNumber_(7, 3), '007');
});
```

- [ ] **Step 2: テストを実行して基盤が通ることを確認する**

Run: `node --test test/smoke.test.js`

Expected: `1` test passes.

- [ ] **Step 3: 検証チェックポイント**

Run: `node --check test/load-gas.js && node --check test/smoke.test.js`

Expected: exit code `0`.

### Task 2: 共通CSV生成・ダウンロード

**Files:**
- Create: `test/csv.test.js`
- Modify: `src/Utils.js`

- [ ] **Step 1: CSVエスケープと列射影の失敗テストを書く**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadGas } = require('./load-gas');
const gas = loadGas(['src/Config.js', 'src/Utils.js']);

test('buildCsvText_ quotes commas, quotes and newlines with CRLF rows', () => {
  const actual = gas.buildCsvText_([['a,b', 'x"y'], ['line\nbreak', 'plain']]);
  assert.equal(actual, '"a,b","x""y"\r\n"line\nbreak",plain');
});

test('projectTableByHeaders_ keeps only requested headers in requested order', () => {
  const data = [['B', '内部列', 'A'], ['b', 'secret', 'a']];
  assert.deepEqual(
    JSON.parse(JSON.stringify(gas.projectTableByHeaders_(data, ['A', 'B']))),
    [['A', 'B'], ['a', 'b']]
  );
});
```

- [ ] **Step 2: 失敗を確認する**

Run: `node --test test/csv.test.js`

Expected: FAIL because `buildCsvText_` is not defined.

- [ ] **Step 3: 純粋関数を実装する**

```js
function escapeCsvField_(field) {
  var str = String(field === null || field === undefined ? '' : field);
  if (/[",\r\n]/.test(str)) return '"' + str.replace(/"/g, '""') + '"';
  return str;
}

function buildCsvText_(data) {
  return data.map(function(row) {
    return row.map(escapeCsvField_).join(',');
  }).join('\r\n');
}

function projectTableByHeaders_(data, targetHeaders) {
  if (!data || data.length === 0) return [targetHeaders.slice()];
  var sourceMap = createColumnMap_(data[0]);
  var missing = targetHeaders.filter(function(header) { return sourceMap[header] === undefined; });
  if (missing.length > 0) throw new Error('必須ヘッダー不足: ' + missing.join(', '));
  return [targetHeaders.slice()].concat(data.slice(1).map(function(row) {
    return targetHeaders.map(function(header) { return row[sourceMap[header]]; });
  }));
}
```

- [ ] **Step 4: UTF-8とShift-JISのダウンロード関数を追加する**

`downloadCsvUtf8_` は `buildCsvText_` の結果へブラウザ側でBOMを付与する。`downloadCsvShiftJis_` は弥彦の `ConvertChoiceToRakuten.js:2090-2136` と同じ `encoding-japanese@2.0.0` 変換を使う。両関数とも `JSON.stringify(csvText)` と `JSON.stringify(filename)` でHTMLへ埋め込む。

- [ ] **Step 5: テストを通す**

Run: `node --test test/csv.test.js`

Expected: `2` tests pass.

- [ ] **Step 6: 検証チェックポイント**

Run: `node --check src/Utils.js`

Expected: exit code `0`.

### Task 3: 楽天Choice照合・テンプレート変換

**Files:**
- Create: `test/rakuten-template.test.js`
- Modify: `src/DistributorRakuten.js`

- [ ] **Step 1: Choice Mapとテンプレート変換の失敗テストを書く**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadGas } = require('./load-gas');
const gas = loadGas(['src/Config.js', 'src/Utils.js', 'src/DistributorRakuten.js']);

test('buildFullChoiceMapFromValues_ keys rows by 管理コード', () => {
  const result = gas.buildFullChoiceMapFromValues_(
    ['管理コード', '（必須）お礼の品名'],
    [['sado-1', '品名｜補足']]
  );
  assert.equal(result['sado-1']['（必須）お礼の品名'], '品名｜補足');
});

test('renderRakutenTemplate_ replaces Choice fields and virtual delivery type', () => {
  const result = gas.renderRakutenTemplate_(
    '{{（必須）お礼の品名}}/{{説明}}/{{配送温度帯}}/{{空欄}}',
    {
      '（必須）お礼の品名': '佐渡米｜令和8年',
      '説明': '一行目\n二行目',
      '（必須）常温配送': '1',
      '（必須）冷蔵配送': '0',
      '（必須）冷凍配送': '1',
      '空欄': ''
    }
  );
  assert.equal(result.html, '佐渡米/一行目<br>二行目/常温配送、冷凍配送/-');
  assert.deepEqual(JSON.parse(JSON.stringify(result.warnings)), ['空欄']);
});
```

- [ ] **Step 2: 失敗を確認する**

Run: `node --test test/rakuten-template.test.js`

Expected: FAIL because `buildFullChoiceMapFromValues_` is not defined.

- [ ] **Step 3: 弥彦由来の純粋ヘルパーを実装する**

```js
function buildFullChoiceMapFromValues_(headers, rows, mgmtHeader) {
  var colMap = createColumnMap_(headers);
  var keyHeader = mgmtHeader || CHOICE_COLUMNS.MGMT_CODE;
  var mgmtIdx = colMap[keyHeader];
  if (mgmtIdx === undefined) throw new Error('choice_tsvに「' + keyHeader + '」列がありません。');
  var map = {};
  rows.forEach(function(row) {
    var code = String(row[mgmtIdx]).trim();
    if (!code) return;
    var values = {};
    headers.forEach(function(header, index) {
      var name = String(header).trim();
      if (name) values[name] = row[index];
    });
    map[code] = values;
  });
  return map;
}

function generateDeliveryType_(choiceData) {
  var types = [];
  if (String(choiceData['（必須）常温配送']) === '1') types.push('常温配送');
  if (String(choiceData['（必須）冷蔵配送']) === '1') types.push('冷蔵配送');
  if (String(choiceData['（必須）冷凍配送']) === '1') types.push('冷凍配送');
  return types.length ? types.join('、') : '-';
}

function renderRakutenTemplate_(template, choiceData) {
  var warnings = [];
  var html = String(template).replace(/{{\s*([^}]+)\s*}}/g, function(_, name) {
    var key = name.trim();
    if (key === '配送温度帯') return generateDeliveryType_(choiceData);
    var value = choiceData[key];
    if (value === undefined || value === null || String(value).trim() === '') {
      warnings.push(key);
      return '-';
    }
    var result = String(value);
    if (key === '（必須）お礼の品名') result = result.split(/[|｜]/)[0].trim();
    return result.replace(/\r?\n/g, '<br>');
  });
  return { html: html, warnings: warnings };
}
```

`buildFullChoiceMap_` は `sheet.getDataRange().getValues()` を取得し、`buildFullChoiceMapFromValues_(data[0], data.slice(1), CHOICE_COLUMNS.MGMT_CODE)` へ委譲する。

- [ ] **Step 4: 不足している商品ブロック・画像Mapヘルパーを弥彦から移植する**

`parseProductBlocks_`、`buildImageUrlMap_`、`buildImagePathMapForTemplate_`、`buildImageMappingMap_`、`resolveImageKey_` を弥彦の同名関数から移植し、シート名を `SHEET_NAMES.RAKUTEN_IMAGE_GRID`、`RAKUTEN_IMAGE_PATHS`、`RAKUTEN_IMAGE_MAPPING` に置換する。

- [ ] **Step 5: `runTemplateInjection_` を純粋レンダラーへ接続する**

各テンプレートで `renderRakutenTemplate_` を呼び、`warnings` を `[timestamp, productRow, sysNum, '空プレースホルダー: {{' + key + '}}', 'WARNING']` として蓄積する。100,000文字を超えたテンプレートだけ書き込みを止め、他テンプレートと他商品は継続する。

- [ ] **Step 6: テストを通す**

Run: `node --test test/rakuten-template.test.js`

Expected: `2` tests pass.

### Task 4: 楽天画像列とログ

**Files:**
- Modify: `test/rakuten-template.test.js`
- Modify: `src/DistributorRakuten.js`
- Modify: `src/Config.js`
- Modify: `src/Menu.js`

- [ ] **Step 1: 画像列順に依存しない失敗テストを書く**

```js
test('findRakutenImageColumns_ detects type, path and alt by header name', () => {
  const headers = ['商品画像タイプ1', '商品画像パス1', '商品画像名（ALT）1'];
  assert.deepEqual(
    JSON.parse(JSON.stringify(gas.findRakutenImageColumns_(headers, 1))),
    [{ type: 1, path: 2, alt: 3 }]
  );
});
```

- [ ] **Step 2: 失敗を確認する**

Run: `node --test test/rakuten-template.test.js`

Expected: FAIL because `findRakutenImageColumns_` is not defined.

- [ ] **Step 3: ヘッダー検出を実装して画像書き込みを置換する**

```js
function findRakutenImageColumns_(headers, maxImages) {
  var map = createColumnMap_(headers);
  var result = [];
  for (var n = 1; n <= maxImages; n++) {
    result.push({
      type: map['商品画像タイプ' + n] === undefined ? null : map['商品画像タイプ' + n] + 1,
      path: map['商品画像パス' + n] === undefined ? null : map['商品画像パス' + n] + 1,
      alt: map['商品画像名（ALT）' + n] === undefined ? null : map['商品画像名（ALT）' + n] + 1
    });
  }
  return result;
}
```

`runTemplateInjection_` は各画像番号の `{type, path, alt}` が全て存在する場合だけ、`CABINET`、パス、商品名を書き込む。不足列はログへ1件記録する。

- [ ] **Step 4: 初期ヘッダーとログシートを修正する**

`getRakutenCsvHeaders()` の画像部分を「タイプN、パスN、ALT N」の順へ変更する。初期設定の補助シートへ `SHEET_NAMES.RAKUTEN_DASHBOARD` を追加し、ヘッダーを `['実行日時', '楽天行番号', '管理コード', '内容', '種別']` とする。ログは一括 `setValues` で追記する。

- [ ] **Step 5: テストを通す**

Run: `node --test test/rakuten-template.test.js`

Expected: `3` tests pass.

### Task 5: Choice内部列とバッチシートの冪等性

**Files:**
- Create: `test/choice-batches.test.js`
- Modify: `src/Distributor.js`

- [ ] **Step 1: 内部列再利用と古いシート選定の失敗テストを書く**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadGas } = require('./load-gas');
const gas = loadGas(['src/Config.js', 'src/Utils.js', 'src/Distributor.js']);

test('getOrAppendHeaderIndex_ reuses 出力バッチ', () => {
  assert.equal(gas.getOrAppendHeaderIndex_(['A', '出力バッチ'], '出力バッチ'), 1);
  assert.equal(gas.getOrAppendHeaderIndex_(['A'], '出力バッチ'), 1);
});

test('stripInternalColumns_ removes 出力バッチ from header and rows', () => {
  const result = gas.stripInternalColumns_(['A', '出力バッチ', 'B'], [['a', 'batch_001', 'b']], ['出力バッチ']);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), { headers: ['A', 'B'], rows: [['a', 'b']] });
});

test('findBatchSheetNames_ returns every stale sheet for a batch number', () => {
  assert.deepEqual(
    JSON.parse(JSON.stringify(gas.findBatchSheetNames_(['tsv_b1_10品', 'tsv_b1_12品', 'tsv_b2_4品'], 1))),
    ['tsv_b1_10品', 'tsv_b1_12品']
  );
});
```

- [ ] **Step 2: 失敗を確認する**

Run: `node --test test/choice-batches.test.js`

Expected: FAIL because `getOrAppendHeaderIndex_` is not defined.

- [ ] **Step 3: 純粋ヘルパーを実装する**

```js
function getOrAppendHeaderIndex_(headers, headerName) {
  var index = headers.indexOf(headerName);
  return index === -1 ? headers.length : index;
}

function stripInternalColumns_(headers, rows, internalHeaders) {
  var keep = headers.map(function(_, i) { return i; }).filter(function(i) {
    return internalHeaders.indexOf(String(headers[i]).trim()) === -1;
  });
  return {
    headers: keep.map(function(i) { return headers[i]; }),
    rows: rows.map(function(row) { return keep.map(function(i) { return row[i]; }); })
  };
}

function findBatchSheetNames_(sheetNames, batchNum) {
  var prefix = 'tsv_b' + batchNum + '_';
  return sheetNames.filter(function(name) { return name.indexOf(prefix) === 0; });
}
```

- [ ] **Step 4: Choice処理へ接続する**

`_writeBackBatchMarkings` は既存の「出力バッチ」列を検索し、存在時は同じ列へ上書きする。`_generateBatchTsvSheet` は内部列除外後のヘッダーと行だけを書き込む。新規シート作成前に同じバッチ番号の全旧シートを削除する。

- [ ] **Step 5: テストを通す**

Run: `node --test test/choice-batches.test.js`

Expected: `3` tests pass.

### Task 6: ANA JPEG変換・CSV列制限・マーキング

**Files:**
- Create: `test/ana.test.js`
- Modify: `src/DistributorANA.js`

- [ ] **Step 1: JPEG変換計画とCSV射影の失敗テストを書く**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadGas } = require('./load-gas');
const gas = loadGas(['src/Config.js', 'src/Utils.js', 'src/DistributorANA.js']);

test('getAnaJpegCopyPlan_ converts non-JPEG extensions', () => {
  assert.deepEqual(
    JSON.parse(JSON.stringify(gas.getAnaJpegCopyPlan_('sado_1.png', 'image/png'))),
    { fileName: 'sado_1.jpg', convert: true }
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(gas.getAnaJpegCopyPlan_('sado_1.jpeg', 'image/jpeg'))),
    { fileName: 'sado_1.jpeg', convert: false }
  );
});

test('buildAnaExportData_ excludes 出力バッチ', () => {
  const headers = gas.getAnaCsvHeaders();
  const row = headers.map((_, i) => 'v' + i);
  const result = gas.buildAnaExportData_([headers.concat(['出力バッチ']), row.concat(['upload_ana_001'])]);
  assert.equal(result[0].length, headers.length);
  assert.equal(result[0].includes('出力バッチ'), false);
});
```

- [ ] **Step 2: 失敗を確認する**

Run: `node --test test/ana.test.js`

Expected: FAIL because `getAnaJpegCopyPlan_` is not defined.

- [ ] **Step 3: 純粋ヘルパーを実装する**

```js
function getAnaJpegCopyPlan_(fileName, mimeType) {
  var isJpeg = mimeType === 'image/jpeg' || /\.jpe?g$/i.test(fileName);
  return {
    fileName: isJpeg ? fileName : fileName.replace(/\.[^.]+$/, '') + '.jpg',
    convert: !isJpeg
  };
}

function buildAnaExportData_(data) {
  return projectTableByHeaders_(data, getAnaCsvHeaders());
}
```

- [ ] **Step 4: Driveコピーを実JPEG変換へ変更する**

各コピーで `plan = getAnaJpegCopyPlan_(name, file.getMimeType())` を作る。`plan.convert` が偽なら既存の `makeCopy` を使う。真なら次を実行する。

```js
var jpegBlob = fileInfoObj.file.getBlob().getAs('image/jpeg').setName(plan.fileName);
targetDir.createFile(jpegBlob);
```

変換例外は `stats.errorFiles` と `batchErrors` へ加算し、CSVへ記録する名前にも `plan.fileName` を使う。

- [ ] **Step 5: CSVとマーキングを修正する**

選択行・全行ダウンロードは `getDisplayValues()` 後に `buildAnaExportData_` を通す。`_writeBackAnaBatchMarkings` はChoiceと同じ既存列再利用方式に変更する。

- [ ] **Step 6: テストを通す**

Run: `node --test test/ana.test.js`

Expected: `2` tests pass.

### Task 7: ANAを含む進捗リセット

**Files:**
- Create: `test/reset-progress.test.js`
- Modify: `src/Menu.js`

- [ ] **Step 1: リセット対象の失敗テストを書く**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadGas } = require('./load-gas');
const gas = loadGas(['src/Config.js', 'src/Menu.js']);

test('reset lists include ANA state and trigger handlers', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(gas.getProgressPropertyKeys_())), [
    gas.PROP_KEYS.PROGRESS, gas.PROP_KEYS.CONFIG, gas.PROP_KEYS.QUEUE_CONFIG,
    gas.PROP_KEYS.DIST_PROGRESS, gas.PROP_KEYS.DIST_CONFIG, gas.PROP_KEYS.DIST_QUEUE_CONFIG,
    gas.PROP_KEYS.ANA_PROGRESS, gas.PROP_KEYS.ANA_CONFIG, gas.PROP_KEYS.ANA_QUEUE_CONFIG
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(gas.getProgressTriggerNames_())), [
    'runQueuedCollect', 'resumeCollect', 'runQueuedDistribute', 'resumeDistribute',
    'runQueuedAnaDistribute', 'resumeAnaDistribute'
  ]);
});
```

- [ ] **Step 2: 失敗を確認する**

Run: `node --test test/reset-progress.test.js`

Expected: FAIL because `getProgressPropertyKeys_` is not defined.

- [ ] **Step 3: 対象一覧とリセット処理を実装する**

```js
function getProgressPropertyKeys_() {
  return [
    PROP_KEYS.PROGRESS, PROP_KEYS.CONFIG, PROP_KEYS.QUEUE_CONFIG,
    PROP_KEYS.DIST_PROGRESS, PROP_KEYS.DIST_CONFIG, PROP_KEYS.DIST_QUEUE_CONFIG,
    PROP_KEYS.ANA_PROGRESS, PROP_KEYS.ANA_CONFIG, PROP_KEYS.ANA_QUEUE_CONFIG
  ];
}

function getProgressTriggerNames_() {
  return [
    'runQueuedCollect', 'resumeCollect', 'runQueuedDistribute', 'resumeDistribute',
    'runQueuedAnaDistribute', 'resumeAnaDistribute'
  ];
}
```

`resetProgress` は両配列をループし、プロパティ削除と `deleteTriggersByFunction_` を実行する。

- [ ] **Step 4: テストを通す**

Run: `node --test test/reset-progress.test.js`

Expected: `1` test passes.

### Task 8: 文書・静的検証・総合回帰

**Files:**
- Modify: `README.md`
- Create: `test/undefined-helpers.test.js`

- [ ] **Step 1: 未定義の内部ヘルパーを検出するテストを書く**

全 `src/*.js` から `function name(` の定義と `name_(` の呼び出しを収集し、呼び出された末尾 `_` 関数が全て定義済みであることをassertする。GASメソッド呼び出しはドット直後の名前を対象外にする。

- [ ] **Step 2: READMEを更新する**

次を明記する。

- 楽天HTML照合は `choice_tsv.管理コード = rakuten_csv.システム連携用SKU番号`。
- テンプレートはA列キー、C列本文、Choiceヘッダー名プレースホルダー。
- ANA非JPEGはJPEG変換して配置。
- ANAはUTF-8 BOM付き、楽天はShift-JIS。
- 内部列「出力バッチ」はCSV/TSVへ出力しない。

- [ ] **Step 3: 全Nodeテストを実行する**

Run: `node --test test/*.test.js`

Expected: all tests pass with zero failures.

- [ ] **Step 4: 全GAS JavaScriptの構文を検証する**

Run: `for f in src/*.js; do node --check "$f" || exit 1; done`

Expected: exit code `0`.

- [ ] **Step 5: 未定義内部関数がないことを確認する**

Run: `node --test test/undefined-helpers.test.js`

Expected: test passes and reports no missing helper names.

- [ ] **Step 6: clasp対象を確認する**

Run: `cat .clasp.json && cat src/appsscript.json`

Expected: 佐渡のscriptId `12xVenQQgR8xGbDQh-tw-iGYI9NrVuHYQgrm299U1g9kCuFiVUDvh-WO8` と parentId `1rri4ZVCPszLIreCuPA36_W1p12HXmHmJuzSK4HRVlgM` が表示される。ユーザーからデプロイ指示がないため `clasp push` は実行しない。

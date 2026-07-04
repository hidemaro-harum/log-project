const test = require('node:test');
const assert = require('node:assert/strict');
const { loadGas } = require('./load-gas');

function plain(value) { return JSON.parse(JSON.stringify(value)); }

test('validateAnaExportRows_ rejects blank identifiers and explicit placement errors', () => {
  const gas = loadGas(['src/Operations.js']);
  const issues = plain(gas.validateAnaExportRows_([
    ['返礼品識別コード', '出力バッチ'],
    ['', 'upload_ana_001'],
    ['A-2', 'エラー'],
  ], ['返礼品識別コード']));
  assert.deepEqual(issues, ['2行目: 返礼品識別コードが空欄', '3行目: 出力バッチがエラー']);
});

test('validateRakutenExportRows_ rejects duplicate required headers and blank product keys', () => {
  const gas = loadGas(['src/Operations.js']);
  const issues = plain(gas.validateRakutenExportRows_([
    ['商品管理番号（商品URL）', '商品名', '商品名', 'システム連携用SKU番号'],
    ['', '商品A', '商品A', 'sku-a'],
  ], ['商品管理番号（商品URL）', '商品名', 'システム連携用SKU番号']));
  assert.deepEqual(issues, [
    '必須ヘッダー重複: 商品名',
    '2行目: 商品管理番号（商品URL）が空欄',
  ]);
});

test('buildRakutenCsvDownloadMessage_ keeps validation issues as warnings without blocking output', () => {
  const gas = loadGas(['src/Operations.js']);
  const message = gas.buildRakutenCsvDownloadMessage_('全行', 10, [
    '必須ヘッダー不足: 商品名',
    'マルチSKU画像が不足しています: 24件',
  ]);

  assert.match(message, /CSVとしてダウンロードします/);
  assert.match(message, /対象行数: 10行/);
  assert.match(message, /出力前チェック警告/);
  assert.match(message, /必須ヘッダー不足: 商品名/);
  assert.match(message, /マルチSKU画像が不足しています: 24件/);
});

test('fetchWithRetry_ retries 429 and 5xx but not ordinary 4xx', () => {
  const sleeps = [];
  const responses = [429, 503, 200].map((code) => ({
    getResponseCode: () => code,
    getContentText: () => 'body-' + code,
  }));
  const gas = loadGas(['src/Config.js', 'src/Operations.js'], {
    UrlFetchApp: { fetch: () => responses.shift() },
    Utilities: { sleep: (ms) => sleeps.push(ms) },
  });
  assert.equal(gas.fetchWithRetry_('https://example.test', {}, 'test').getResponseCode(), 200);
  assert.deepEqual(sleeps, [2000, 8000]);

  let calls = 0;
  gas.UrlFetchApp.fetch = () => {
    calls++;
    return { getResponseCode: () => 401, getContentText: () => 'unauthorized' };
  };
  assert.throws(() => gas.fetchWithRetry_('https://example.test', {}, 'test'), /401/);
  assert.equal(calls, 1);
});

test('recordOperationResult_ appends a stable history row and never throws on logging failure', () => {
  const writes = [];
  const sheet = {
    getLastRow: () => 1,
    getRange: (...args) => ({ setValues: (values) => writes.push([args, values]) }),
  };
  const gas = loadGas(['src/Config.js', 'src/Operations.js'], {
    SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: () => sheet }) },
    Utilities: { formatDate: () => '2026-06-20 10:00:00' },
    Session: { getActiveUser: () => ({ getEmail: () => 'user@example.com' }) },
    Logger: { log: () => {} },
  });
  gas.recordOperationResult_({ operation: 'ANA CSV', mode: '全行', status: '失敗', errors: 2, detail: 'invalid' });
  assert.equal(writes.length, 1);
  assert.deepEqual(plain(writes[0][1][0].slice(0, 5)), ['2026-06-20 10:00:00', 'user@example.com', 'ANA CSV', '全行', '失敗']);

  gas.SpreadsheetApp.getActiveSpreadsheet = () => { throw new Error('history unavailable'); };
  assert.doesNotThrow(() => gas.recordOperationResult_({ operation: 'x' }));
});

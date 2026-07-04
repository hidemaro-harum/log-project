const test = require('node:test');
const assert = require('node:assert/strict');
const { loadGas } = require('./load-gas');

test('dry run writes folder access errors and final summary to dashboard without copying', () => {
  const events = [];
  let copyCalls = 0;
  const badFolderUrl = 'https://drive.google.com/drive/folders/source-bad';
  const data = [
    ['管理番号', 'フォルダリンク'],
    ['195949-0001', badFolderUrl],
  ];
  const masterSheet = {
    getDataRange() {
      return { getValues: () => data };
    },
  };
  const spreadsheet = {
    getSheetByName(name) {
      assert.equal(name, 'master');
      return masterSheet;
    },
  };
  const props = {
    getProperty: () => null,
    deleteProperty() {},
  };

  const gas = loadGas(['src/Config.js', 'src/Collector.js'], {
    SpreadsheetApp: {
      getActiveSpreadsheet: () => spreadsheet,
      getUi: () => ({ ButtonSet: { OK: 'OK' } }),
    },
    PropertiesService: { getScriptProperties: () => props },
    DriveApp: {
      getFolderById(id) {
        if (id === 'dest') {
          return {
            getFiles() {
              return { hasNext: () => false };
            },
          };
        }
        throw new Error('アクセス権がありません');
      },
    },
    getSettingValue_: () => 'https://drive.google.com/drive/folders/dest',
    extractFolderIdFromUrl_(url) {
      const match = String(url).match(/\/folders\/([^/?]+)/);
      if (!match) throw new Error('フォルダIDを抽出できません');
      return match[1];
    },
    createColumnMap_: (headers) => Object.fromEntries(headers.map((header, index) => [header, index])),
    buildExistingFileSet_: (folder) => {
      folder.getFiles();
      return {};
    },
    initDashboard_: (totalRows) => events.push(['init', totalRows]),
    updateDashboardStatus_: (status) => events.push(['status', status]),
    updateDashboardSummary_: (stats) => events.push(['summary', { ...stats }]),
    addDashboardRow_: (...args) => events.push(['row', ...args]),
    notifyMessage_: (_ui, _ss, title, message) => events.push(['notify', title, message]),
    deleteTriggersByFunction_: () => {},
    sendNotificationEmail_: () => {},
    recordOperationResult_: () => {},
    ScriptApp: {},
    Logger: { log: () => {} },
  });

  gas._copyFilesFromFolder = () => {
    copyCalls++;
    return { copied: 0, duplicates: 0, errors: 0, total: 0, details: [] };
  };

  gas._runCollect({ isDryRun: true }, null, false);

  assert.deepEqual(events[0], ['init', 1]);
  assert.deepEqual(events[1], ['status', '📋 ドライラン実行中']);
  assert.deepEqual(events.find((event) => event[0] === 'row'), [
    'row',
    2,
    '195949-0001',
    badFolderUrl,
    '0/0',
    '❌ エラー',
    'フォルダアクセス失敗: アクセス権がありません',
  ]);
  const summaries = events.filter((event) => event[0] === 'summary');
  assert.equal(summaries.length, 1);
  assert.equal(summaries[0][1].processedRows, 1);
  assert.equal(summaries[0][1].errorCount, 1);
  assert.deepEqual(events.find((event) => event[0] === 'status' && event[1] === '📋 ドライラン完了'), [
    'status',
    '📋 ドライラン完了',
  ]);
  const notification = events.find((event) => event[0] === 'notify');
  assert.match(notification[2], /✅ コピー予定: 0枚/);
  assert.doesNotMatch(notification[2], /コピー成功/);
  assert.equal(copyCalls, 0);
});

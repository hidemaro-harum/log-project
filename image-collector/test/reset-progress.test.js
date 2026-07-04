const test = require('node:test');
const assert = require('node:assert/strict');
const { loadGas } = require('./load-gas');

const expectedPropertyKeys = [
  'IMG_COLLECT_PROGRESS',
  'IMG_COLLECT_CONFIG',
  'IMG_COLLECT_QUEUE_CONFIG',
  'IMG_DIFF_PROGRESS',
  'IMG_DIFF_CONFIG',
  'IMG_DIFF_QUEUE_CONFIG',
  'CHOICE_DIST_PROGRESS',
  'CHOICE_DIST_CONFIG',
  'CHOICE_DIST_QUEUE_CONFIG',
  'ANA_DIST_PROGRESS',
  'ANA_DIST_CONFIG',
  'ANA_DIST_QUEUE_CONFIG',
  'RAKUTEN_IMAGE_NORMALIZE_PROGRESS',
  'RAKUTEN_IMAGE_NORMALIZE_CONFIG',
  'RAKUTEN_IMAGE_NORMALIZE_QUEUE_CONFIG',
  'RAKUTEN_TEMPLATE_PROGRESS',
];

const expectedTriggerNames = [
  'runQueuedCollect',
  'resumeCollect',
  'runQueuedDifferenceCollect',
  'resumeDifferenceCollect',
  'runQueuedDistribute',
  'resumeDistribute',
  'runQueuedAnaDistribute',
  'resumeAnaDistribute',
  'runQueuedRakutenImageNormalization',
  'resumeRakutenImageNormalization',
  'resumeRakutenTemplateInjection',
];

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function runCancelledReset(buttonName) {
  const deletedPropertyKeys = [];
  const deletedTriggerNames = [];
  const dashboardStatuses = [];
  const alerts = [];
  const ui = {
    Button: { YES: 'YES', NO: 'NO', CLOSE: 'CLOSE' },
    ButtonSet: { YES_NO: 'YES_NO' },
    alert() {
      alerts.push(Array.from(arguments));
      return this.Button[buttonName];
    },
  };
  const gas = loadGas(['src/Config.js', 'src/Menu.js'], {
    SpreadsheetApp: { getUi: () => ui },
    PropertiesService: {
      getScriptProperties: () => ({
        deleteProperty: (key) => deletedPropertyKeys.push(key),
      }),
    },
    deleteTriggersByFunction_: (name) => deletedTriggerNames.push(name),
    updateDashboardStatus_: (status) => dashboardStatuses.push(status),
  });

  gas.resetProgress();

  return { deletedPropertyKeys, deletedTriggerNames, dashboardStatuses, alerts };
}

test('progress reset helpers return all property keys and trigger names in order', () => {
  const gas = loadGas(['src/Config.js', 'src/Menu.js']);

  assert.deepEqual(plain(gas.getProgressPropertyKeys_()), expectedPropertyKeys);
  assert.deepEqual(plain(gas.getProgressTriggerNames_()), expectedTriggerNames);
});

test('resetProgress deletes every progress key and trigger exactly once after confirmation', () => {
  const deletedPropertyKeys = [];
  const deletedTriggerNames = [];
  const dashboardStatuses = [];
  const alerts = [];
  const ui = {
    Button: { YES: 'YES' },
    ButtonSet: { YES_NO: 'YES_NO' },
    alert() {
      const args = Array.from(arguments);
      alerts.push(args);
      return args[0] === '確認' ? this.Button.YES : undefined;
    },
  };
  const gas = loadGas(['src/Config.js', 'src/Menu.js'], {
    SpreadsheetApp: { getUi: () => ui },
    PropertiesService: {
      getScriptProperties: () => ({
        deleteProperty: (key) => deletedPropertyKeys.push(key),
      }),
    },
    deleteTriggersByFunction_: (name) => deletedTriggerNames.push(name),
    updateDashboardStatus_: (status) => dashboardStatuses.push(status),
  });

  gas.resetProgress();

  assert.deepEqual(deletedPropertyKeys, expectedPropertyKeys);
  assert.deepEqual(deletedTriggerNames, expectedTriggerNames);
  assert.equal(new Set(deletedPropertyKeys).size, expectedPropertyKeys.length);
  assert.equal(new Set(deletedTriggerNames).size, expectedTriggerNames.length);
  assert.deepEqual(dashboardStatuses, ['🔄 リセット済み']);
  assert.deepEqual(alerts, [
    [
      '確認',
      '進捗データと自動再開トリガーをすべて削除しますか？\n次回実行時は1行目から開始されます。',
      'YES_NO',
    ],
    ['✅ 進捗をリセットしました。'],
  ]);
});

test('resetProgress does nothing destructive when NO is selected', () => {
  const result = runCancelledReset('NO');

  assert.deepEqual(result.deletedPropertyKeys, []);
  assert.deepEqual(result.deletedTriggerNames, []);
  assert.deepEqual(result.dashboardStatuses, []);
  assert.deepEqual(result.alerts, [[
    '確認',
    '進捗データと自動再開トリガーをすべて削除しますか？\n次回実行時は1行目から開始されます。',
    'YES_NO',
  ]]);
});

test('resetProgress does nothing destructive when the dialog is closed', () => {
  const result = runCancelledReset('CLOSE');

  assert.deepEqual(result.deletedPropertyKeys, []);
  assert.deepEqual(result.deletedTriggerNames, []);
  assert.deepEqual(result.dashboardStatuses, []);
  assert.deepEqual(result.alerts, [[
    '確認',
    '進捗データと自動再開トリガーをすべて削除しますか？\n次回実行時は1行目から開始されます。',
    'YES_NO',
  ]]);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadGas } = require('./load-gas');

let activeSpreadsheet;
const gas = loadGas(['src/Config.js', 'src/Utils.js', 'src/Distributor.js', 'src/Menu.js'], {
  SpreadsheetApp: {
    getActiveSpreadsheet() {
      return activeSpreadsheet;
    },
  },
});

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function createSheet(name, initialValues = [], initialNumberFormats = [], initialDisplayValues = null) {
  const data = initialValues.map((row) => row.slice());
  const numberFormats = initialNumberFormats.map((row) => row.slice());
  const displayValues = initialDisplayValues && initialDisplayValues.map((row) => row.slice());

  function ensureCell(row, column) {
    while (data.length < row) data.push([]);
    while (data[row - 1].length < column) data[row - 1].push('');
  }

  return {
    data,
    numberFormats,
    getName() {
      return name;
    },
    getDataRange() {
      const width = data.reduce((max, row) => Math.max(max, row.length), 0);
      return this.getRange(1, 1, data.length, width);
    },
    getLastRow() {
      return data.length;
    },
    getLastColumn() {
      return data.reduce((max, row) => Math.max(max, row.length), 0);
    },
    getRange(row, column, numRows = 1, numColumns = 1) {
      return {
        getValues() {
          return Array.from({ length: numRows }, (_, rowOffset) =>
            Array.from({ length: numColumns }, (_, columnOffset) =>
              data[row - 1 + rowOffset]?.[column - 1 + columnOffset] ?? ''
            )
          );
        },
        getDisplayValues() {
          return Array.from({ length: numRows }, (_, rowOffset) =>
            Array.from({ length: numColumns }, (_, columnOffset) =>
              String(
                displayValues?.[row - 1 + rowOffset]?.[column - 1 + columnOffset]
                ?? data[row - 1 + rowOffset]?.[column - 1 + columnOffset]
                ?? ''
              )
            )
          );
        },
        getNumberFormats() {
          return Array.from({ length: numRows }, (_, rowOffset) =>
            Array.from({ length: numColumns }, (_, columnOffset) =>
              numberFormats[row - 1 + rowOffset]?.[column - 1 + columnOffset] ?? ''
            )
          );
        },
        setValue(value) {
          ensureCell(row, column);
          data[row - 1][column - 1] = value;
          return this;
        },
        setValues(values) {
          values.forEach((sourceRow, rowOffset) => {
            sourceRow.forEach((value, columnOffset) => {
              ensureCell(row + rowOffset, column + columnOffset);
              data[row - 1 + rowOffset][column - 1 + columnOffset] = value;
            });
          });
          return this;
        },
        setNumberFormats(values) {
          values.forEach((sourceRow, rowOffset) => {
            sourceRow.forEach((value, columnOffset) => {
              while (numberFormats.length < row + rowOffset) numberFormats.push([]);
              while (numberFormats[row - 1 + rowOffset].length < column + columnOffset) {
                numberFormats[row - 1 + rowOffset].push('');
              }
              numberFormats[row - 1 + rowOffset][column - 1 + columnOffset] = value;
            });
          });
          return this;
        },
        setBackground() { return this; },
        setFontColor() { return this; },
        setFontWeight() { return this; },
      };
    },
    autoResizeColumn() {},
    setFrozenRows() {},
  };
}

function createSpreadsheet(sheetList) {
  const sheets = sheetList.slice();
  const deletedNames = [];
  const insertedNames = [];
  const toasts = [];
  return {
    deletedNames,
    insertedNames,
    toasts,
    getSheets() {
      return sheets.slice();
    },
    getSheetByName(name) {
      return sheets.find((sheet) => sheet.getName() === name) || null;
    },
    deleteSheet(sheet) {
      deletedNames.push(sheet.getName());
      sheets.splice(sheets.indexOf(sheet), 1);
    },
    insertSheet(name) {
      insertedNames.push(name);
      const sheet = createSheet(name);
      sheets.push(sheet);
      return sheet;
    },
    toast(message, title, timeout) {
      toasts.push({ message, title, timeout });
    },
  };
}

function captureChoiceStartSideEffects() {
  const effects = {
    lockAcquisitions: 0,
    triggerDeletions: 0,
    propertyWrites: 0,
    triggerCreations: 0,
  };
  const originals = {
    LockService: gas.LockService,
    PropertiesService: gas.PropertiesService,
    ScriptApp: gas.ScriptApp,
    deleteTriggersByFunction_: gas.deleteTriggersByFunction_,
  };
  gas.LockService = {
    getScriptLock() {
      effects.lockAcquisitions++;
      return {
        tryLock() { return true; },
        releaseLock() {},
      };
    },
  };
  gas.PropertiesService = {
    getScriptProperties() {
      return {
        setProperty() {
          effects.propertyWrites++;
        },
      };
    },
  };
  gas.ScriptApp = {
    newTrigger() {
      return {
        timeBased() { return this; },
        after() { return this; },
        create() {
          effects.triggerCreations++;
        },
      };
    },
  };
  gas.deleteTriggersByFunction_ = function() {
    effects.triggerDeletions++;
  };

  let error;
  try {
    gas.startChoiceDistribute('{}');
  } catch (caught) {
    error = caught;
  } finally {
    gas.LockService = originals.LockService;
    gas.PropertiesService = originals.PropertiesService;
    gas.ScriptApp = originals.ScriptApp;
    gas.deleteTriggersByFunction_ = originals.deleteTriggersByFunction_;
  }
  return { effects, error };
}

test('findMissingHeaders_ reports a sparse configured Choice image header', () => {
  assert.deepEqual(
    plain(gas.findMissingHeaders_(
      ['管理コード', 'スライド画像1', 'スライド画像3'],
      ['スライド画像1', 'スライド画像2', 'スライド画像3']
    )),
    ['スライド画像2']
  );
});

test('findDuplicateNames_ trim-normalizes names and reports each duplicate exactly once', () => {
  assert.deepEqual(
    plain(gas.findDuplicateNames_([
      'スライド画像1',
      ' スライド画像1 ',
      'スライド画像2',
      'スライド画像2',
      'スライド画像2',
      '',
      ' ',
    ])),
    ['スライド画像1', 'スライド画像2']
  );
});

test('_validateChoicePreRequisites alerts and returns null for a sparse configured image header', () => {
  const settingSheet = createSheet('setting', [
    [gas.SETTING_KEYS.DEST_FOLDER_URL, 'dest-folder'],
    [gas.SETTING_KEYS.CHOICE_IMAGE_COLS, 'スライド画像1,スライド画像2,スライド画像3'],
  ]);
  const choiceSheet = createSheet('choice_tsv', [
    ['管理コード', 'スライド画像1', 'スライド画像3'],
    ['sado-1', '', ''],
  ]);
  activeSpreadsheet = createSpreadsheet([settingSheet, choiceSheet]);
  const alerts = [];
  const ui = {
    alert(...args) {
      alerts.push(args);
    },
  };

  const actual = gas._validateChoicePreRequisites(ui);

  assert.equal(actual, null);
  assert.equal(alerts.length, 1);
  assert.match(alerts[0].join('\n'), /不足: スライド画像2/);
  assert.doesNotMatch(alerts[0].join('\n'), /不足:.*スライド画像3/);
});

test('_validateChoicePreRequisites rejects duplicate configured image names after trimming', () => {
  const settingSheet = createSheet('setting', [
    [gas.SETTING_KEYS.DEST_FOLDER_URL, 'dest-folder'],
    [gas.SETTING_KEYS.CHOICE_IMAGE_COLS, 'スライド画像1, スライド画像1 ,スライド画像2'],
  ]);
  const choiceSheet = createSheet('choice_tsv', [
    ['管理コード', 'スライド画像1', 'スライド画像2'],
    ['sado-1', '', ''],
  ]);
  activeSpreadsheet = createSpreadsheet([settingSheet, choiceSheet]);
  const alerts = [];

  const actual = gas._validateChoicePreRequisites({ alert(...args) { alerts.push(args); } });

  assert.equal(actual, null);
  assert.equal(alerts.length, 1);
  assert.match(alerts[0].join('\n'), /設定された画像カラム重複: スライド画像1/);
  assert.doesNotMatch(alerts[0].join('\n'), /重複:.*スライド画像2/);
});

test('_validateChoicePreRequisites rejects duplicate configured image headers in the TSV', () => {
  const settingSheet = createSheet('setting', [
    [gas.SETTING_KEYS.DEST_FOLDER_URL, 'dest-folder'],
    [gas.SETTING_KEYS.CHOICE_IMAGE_COLS, 'スライド画像1,スライド画像2'],
  ]);
  const choiceSheet = createSheet('choice_tsv', [
    ['管理コード', 'スライド画像1', ' スライド画像1 ', 'スライド画像2'],
    ['sado-1', '', '', ''],
  ]);
  activeSpreadsheet = createSpreadsheet([settingSheet, choiceSheet]);
  const alerts = [];

  const actual = gas._validateChoicePreRequisites({ alert(...args) { alerts.push(args); } });

  assert.equal(actual, null);
  assert.equal(alerts.length, 1);
  assert.match(alerts[0].join('\n'), /TSVの画像カラム重複: スライド画像1/);
  assert.doesNotMatch(alerts[0].join('\n'), /重複:.*スライド画像2/);
});

test('_validateChoicePreRequisites rejects a configured image list with no valid names', () => {
  const settingSheet = createSheet('setting', [
    [gas.SETTING_KEYS.DEST_FOLDER_URL, 'dest-folder'],
    [gas.SETTING_KEYS.CHOICE_IMAGE_COLS, ',,'],
  ]);
  const choiceSheet = createSheet('choice_tsv', [
    ['管理コード', 'スライド画像1'],
    ['sado-1', ''],
  ]);
  activeSpreadsheet = createSpreadsheet([settingSheet, choiceSheet]);
  const alerts = [];

  const actual = gas._validateChoicePreRequisites({ alert(...args) { alerts.push(args); } });

  assert.equal(actual, null);
  assert.equal(alerts.length, 1);
  assert.match(
    alerts[0].join('\n'),
    /Choice画像カラム名リストに有効なカラム名がありません。.*Choice画像カラム名リスト/s
  );
});

test('validateChoicePreRequisitesReadOnly_ uses default image columns for an empty setting', () => {
  const settingSheet = createSheet('setting', [
    [gas.SETTING_KEYS.DEST_FOLDER_URL, 'dest-folder'],
    [gas.SETTING_KEYS.CHOICE_IMAGE_COLS, ''],
    [gas.SETTING_KEYS.CHOICE_BATCH_SIZE_MB, '70'],
  ]);
  const choiceSheet = createSheet('choice_tsv', [
    ['管理コード'].concat(gas.CHOICE_COLUMNS.IMAGE_COLS),
    ['sado-1'].concat(gas.CHOICE_COLUMNS.IMAGE_COLS.map(() => '')),
  ]);
  activeSpreadsheet = createSpreadsheet([settingSheet, choiceSheet]);

  const actual = gas.validateChoicePreRequisitesReadOnly_();

  assert.deepEqual(plain(actual.targetImageCols), plain(gas.CHOICE_COLUMNS.IMAGE_COLS));
});

test('validateChoicePreRequisitesReadOnly_ captures every displayed source value for batch output', () => {
  const settingSheet = createSheet('setting', [
    [gas.SETTING_KEYS.DEST_FOLDER_URL, 'dest-folder'],
    [gas.SETTING_KEYS.CHOICE_IMAGE_COLS, 'スライド画像1'],
    [gas.SETTING_KEYS.CHOICE_BATCH_SIZE_MB, '70'],
  ]);
  const choiceSheet = createSheet(
    'choice_tsv',
    [
      ['管理コード', '商品名', '公開日', 'スライド画像1'],
      ['sado-1', '', new Date('2026-06-21T00:00:00+09:00'), 'old.jpg'],
    ],
    [],
    [
      ['管理コード', '商品名', '公開日', 'スライド画像1'],
      ['sado-1', '数式で表示された商品名', '2026/06/21', 'old.jpg'],
    ]
  );
  activeSpreadsheet = createSpreadsheet([settingSheet, choiceSheet]);

  const actual = gas.validateChoicePreRequisitesReadOnly_();

  assert.deepEqual(plain(actual.tsvDisplayData), [
    ['管理コード', '商品名', '公開日', 'スライド画像1'],
    ['sado-1', '数式で表示された商品名', '2026/06/21', 'old.jpg'],
  ]);
});

test('startChoiceDistribute rejects sparse headers before queue side effects', () => {
  activeSpreadsheet = createSpreadsheet([
    createSheet('setting', [
      [gas.SETTING_KEYS.DEST_FOLDER_URL, 'dest-folder'],
      [gas.SETTING_KEYS.CHOICE_IMAGE_COLS, 'スライド画像1,スライド画像2,スライド画像3'],
    ]),
    createSheet('choice_tsv', [
      ['管理コード', 'スライド画像1', 'スライド画像3'],
      ['sado-1', '', ''],
    ]),
  ]);

  const actual = captureChoiceStartSideEffects();

  assert.match(actual.error && actual.error.message, /画像カラム不足: スライド画像2/);
  assert.deepEqual(actual.effects, {
    lockAcquisitions: 0,
    triggerDeletions: 0,
    propertyWrites: 0,
    triggerCreations: 0,
  });
  assert.deepEqual(activeSpreadsheet.toasts, []);
});

test('startChoiceDistribute rejects duplicate configured image names before queue side effects', () => {
  activeSpreadsheet = createSpreadsheet([
    createSheet('setting', [
      [gas.SETTING_KEYS.DEST_FOLDER_URL, 'dest-folder'],
      [gas.SETTING_KEYS.CHOICE_IMAGE_COLS, 'スライド画像1, スライド画像1 ,スライド画像2'],
    ]),
    createSheet('choice_tsv', [
      ['管理コード', 'スライド画像1', 'スライド画像2'],
      ['sado-1', '', ''],
    ]),
  ]);

  const actual = captureChoiceStartSideEffects();

  assert.match(actual.error && actual.error.message, /画像カラム重複: スライド画像1/);
  assert.deepEqual(actual.effects, {
    lockAcquisitions: 0,
    triggerDeletions: 0,
    propertyWrites: 0,
    triggerCreations: 0,
  });
  assert.deepEqual(activeSpreadsheet.toasts, []);
});

test('startChoiceDistribute rejects an effectively empty configured image list before queue side effects', () => {
  activeSpreadsheet = createSpreadsheet([
    createSheet('setting', [
      [gas.SETTING_KEYS.DEST_FOLDER_URL, 'dest-folder'],
      [gas.SETTING_KEYS.CHOICE_IMAGE_COLS, ',,'],
    ]),
    createSheet('choice_tsv', [
      ['管理コード', 'スライド画像1'],
      ['sado-1', ''],
    ]),
  ]);

  const actual = captureChoiceStartSideEffects();

  assert.match(actual.error && actual.error.message, /Choice画像カラム名リストに有効なカラム名がありません/);
  assert.deepEqual(actual.effects, {
    lockAcquisitions: 0,
    triggerDeletions: 0,
    propertyWrites: 0,
    triggerCreations: 0,
  });
  assert.deepEqual(activeSpreadsheet.toasts, []);
});

test('runQueuedDistribute rejects an effectively empty configured image list after only reading the queue', () => {
  activeSpreadsheet = createSpreadsheet([
    createSheet('setting', [
      [gas.SETTING_KEYS.DEST_FOLDER_URL, 'dest-folder'],
      [gas.SETTING_KEYS.CHOICE_IMAGE_COLS, ',,'],
    ]),
    createSheet('choice_tsv', [
      ['管理コード', 'スライド画像1'],
      ['sado-1', ''],
    ]),
    createSheet('tsv_b1_1品', [['keep']]),
  ]);

  const effects = {
    propertyReads: 0,
    propertyDeletes: 0,
    propertyWrites: 0,
    triggerDeletions: 0,
    lockAcquisitions: 0,
    lockReleases: 0,
    triggerCreations: 0,
    driveAccesses: 0,
    dashboardInitializations: 0,
  };
  const logs = [];
  const originals = {
    PropertiesService: gas.PropertiesService,
    deleteTriggersByFunction_: gas.deleteTriggersByFunction_,
    LockService: gas.LockService,
    ScriptApp: gas.ScriptApp,
    DriveApp: gas.DriveApp,
    Logger: gas.Logger,
    initChoiceDashboard_: gas.initChoiceDashboard_,
  };
  gas.PropertiesService = {
    getScriptProperties() {
      return {
        getProperty() {
          effects.propertyReads++;
          return '{}';
        },
        deleteProperty() {
          effects.propertyDeletes++;
        },
        setProperty() {
          effects.propertyWrites++;
        },
      };
    },
  };
  gas.deleteTriggersByFunction_ = function() {
    effects.triggerDeletions++;
  };
  gas.LockService = {
    getScriptLock() {
      effects.lockAcquisitions++;
      return {
        tryLock() { return true; },
        releaseLock() { effects.lockReleases++; },
      };
    },
  };
  gas.ScriptApp = {
    newTrigger() {
      return {
        timeBased() { return this; },
        after() { return this; },
        create() { effects.triggerCreations++; },
      };
    },
  };
  gas.DriveApp = {
    getFolderById() {
      effects.driveAccesses++;
      throw new Error('Drive access must not start');
    },
  };
  gas.Logger = { log(message) { logs.push(message); } };
  gas.initChoiceDashboard_ = function() {
    effects.dashboardInitializations++;
  };

  try {
    gas.runQueuedDistribute();

    assert.deepEqual(effects, {
      propertyReads: 1,
      propertyDeletes: 0,
      propertyWrites: 0,
      triggerDeletions: 0,
      lockAcquisitions: 0,
      lockReleases: 0,
      triggerCreations: 0,
      driveAccesses: 0,
      dashboardInitializations: 0,
    });
    assert.deepEqual(activeSpreadsheet.deletedNames, []);
    assert.deepEqual(activeSpreadsheet.insertedNames, []);
    assert.deepEqual(activeSpreadsheet.toasts, []);
    assert.equal(logs.length, 1);
    assert.match(logs[0], /Choice画像カラム名リストに有効なカラム名がありません/);
  } finally {
    gas.PropertiesService = originals.PropertiesService;
    gas.deleteTriggersByFunction_ = originals.deleteTriggersByFunction_;
    gas.LockService = originals.LockService;
    gas.ScriptApp = originals.ScriptApp;
    gas.DriveApp = originals.DriveApp;
    gas.Logger = originals.Logger;
    gas.initChoiceDashboard_ = originals.initChoiceDashboard_;
  }
});

test('runQueuedDistribute keeps valid queue cleanup before lock and execution', () => {
  activeSpreadsheet = createSpreadsheet([
    createSheet('setting', [
      [gas.SETTING_KEYS.DEST_FOLDER_URL, 'dest-folder'],
      [gas.SETTING_KEYS.CHOICE_IMAGE_COLS, 'スライド画像1'],
      [gas.SETTING_KEYS.CHOICE_BATCH_SIZE_MB, '70'],
    ]),
    createSheet('choice_tsv', [
      ['管理コード', 'スライド画像1'],
      ['sado-1', ''],
    ]),
  ]);
  const order = [];
  const originals = {
    PropertiesService: gas.PropertiesService,
    deleteTriggersByFunction_: gas.deleteTriggersByFunction_,
    LockService: gas.LockService,
    _runDistribute: gas._runDistribute,
  };
  gas.PropertiesService = {
    getScriptProperties() {
      return {
        getProperty() {
          order.push('property-read');
          return '{"isDryRun":true}';
        },
        deleteProperty() { order.push('property-delete'); },
      };
    },
  };
  gas.deleteTriggersByFunction_ = function() { order.push('trigger-delete'); };
  gas.LockService = {
    getScriptLock() {
      order.push('lock-acquire');
      return {
        tryLock() { return true; },
        releaseLock() { order.push('lock-release'); },
      };
    },
  };
  gas._runDistribute = function(config, suppressUi, isResume) {
    order.push('run:' + config.isDryRun + ':' + suppressUi + ':' + isResume);
  };

  try {
    gas.runQueuedDistribute();

    assert.deepEqual(order, [
      'property-read',
      'trigger-delete',
      'property-delete',
      'lock-acquire',
      'run:true:true:false',
      'lock-release',
    ]);
  } finally {
    gas.PropertiesService = originals.PropertiesService;
    gas.deleteTriggersByFunction_ = originals.deleteTriggersByFunction_;
    gas.LockService = originals.LockService;
    gas._runDistribute = originals._runDistribute;
  }
});

test('resolveChoiceRunProgress_ ignores stale progress for fresh runs and restores it only for resume', () => {
  const props = {
    getProperty(key) {
      assert.equal(key, gas.PROP_KEYS.DIST_PROGRESS);
      return JSON.stringify({ batchIndex: 3, processedBatches: 2, copiedFiles: 8 });
    },
  };

  assert.deepEqual(
    plain(gas.resolveChoiceRunProgress_(props, false)),
    { startBatchIdx: 0, savedProgress: null }
  );
  assert.deepEqual(
    plain(gas.resolveChoiceRunProgress_(props, true)),
    {
      startBatchIdx: 3,
      savedProgress: { batchIndex: 3, processedBatches: 2, copiedFiles: 8 },
    }
  );
});

test('buildChoiceProgressCheckpoint_ preserves the next file offset inside a partial batch', () => {
  assert.deepEqual(
    plain(gas.buildChoiceProgressCheckpoint_(2, 37, {
      processedBatches: 2,
      copiedFiles: 25,
      skippedFiles: 4,
      errorFiles: 1,
    })),
    {
      batchIndex: 2,
      fileOffset: 37,
      processedBatches: 2,
      copiedFiles: 25,
      skippedFiles: 4,
      errorFiles: 1,
    }
  );
});

test('pauseChoiceDuringBatchIfNeeded_ checkpoints the current file and schedules automatic resume', () => {
  const events = [];
  const props = {
    setProperty(key, value) {
      events.push(['set', key, JSON.parse(value)]);
    },
  };
  const originals = {
    ScriptApp: gas.ScriptApp,
    deleteTriggersByFunction_: gas.deleteTriggersByFunction_,
    updateChoiceDashboardStatus_: gas.updateChoiceDashboardStatus_,
    _updateChoiceStats: gas._updateChoiceStats,
  };
  gas.ScriptApp = {
    newTrigger(name) {
      events.push('trigger:' + name);
      return { timeBased() { return this; }, after() { return this; }, create() { return this; } };
    },
  };
  gas.deleteTriggersByFunction_ = (name) => events.push('delete:' + name);
  gas.updateChoiceDashboardStatus_ = (status) => events.push('status:' + status);
  gas._updateChoiceStats = () => events.push('stats');

  try {
    const paused = gas.pauseChoiceDuringBatchIfNeeded_(
      0,
      gas.EXEC_CONFIG.TIME_LIMIT_MS + 1,
      3,
      12,
      { processedBatches: 3, copiedFiles: 10, skippedFiles: 2, errorFiles: 0 },
      { isDryRun: false },
      props,
      { toast() { events.push('toast'); } }
    );

    assert.equal(paused, true);
    const checkpoint = events.find((event) => Array.isArray(event) && event[1] === gas.PROP_KEYS.DIST_PROGRESS);
    assert.deepEqual(checkpoint[2], {
      batchIndex: 3,
      fileOffset: 12,
      processedBatches: 3,
      copiedFiles: 10,
      skippedFiles: 2,
      errorFiles: 0,
    });
    assert.equal(events.includes('trigger:resumeDistribute'), true);
    assert.equal(events.includes('status:⏸️ 中断(再開待ち)'), true);
  } finally {
    gas.ScriptApp = originals.ScriptApp;
    gas.deleteTriggersByFunction_ = originals.deleteTriggersByFunction_;
    gas.updateChoiceDashboardStatus_ = originals.updateChoiceDashboardStatus_;
    gas._updateChoiceStats = originals._updateChoiceStats;
  }
});

test('startChoiceDistribute rejects pending progress without deleting or replacing it', () => {
  activeSpreadsheet = createSpreadsheet([
    createSheet('setting', [
      [gas.SETTING_KEYS.DEST_FOLDER_URL, 'dest-folder'],
      [gas.SETTING_KEYS.CHOICE_IMAGE_COLS, 'スライド画像1'],
      [gas.SETTING_KEYS.CHOICE_BATCH_SIZE_MB, '70'],
    ]),
    createSheet('choice_tsv', [
      ['管理コード', 'スライド画像1'],
      ['sado-1', ''],
    ]),
  ]);
  const effects = {
    propertyWrites: 0,
    triggerDeletions: 0,
    triggerCreations: 0,
    lockReleases: 0,
  };
  const originals = {
    PropertiesService: gas.PropertiesService,
    LockService: gas.LockService,
    ScriptApp: gas.ScriptApp,
    deleteTriggersByFunction_: gas.deleteTriggersByFunction_,
  };
  gas.PropertiesService = {
    getScriptProperties() {
      return {
        getProperty(key) {
          return key === gas.PROP_KEYS.DIST_PROGRESS ? '{"batchIndex":2}' : null;
        },
        setProperty() { effects.propertyWrites++; },
      };
    },
  };
  gas.LockService = {
    getScriptLock() {
      return {
        tryLock() { return true; },
        releaseLock() { effects.lockReleases++; },
      };
    },
  };
  gas.ScriptApp = {
    getProjectTriggers() { return []; },
    newTrigger() {
      effects.triggerCreations++;
      return { timeBased() { return this; }, after() { return this; }, create() {} };
    },
  };
  gas.deleteTriggersByFunction_ = function() { effects.triggerDeletions++; };

  try {
    assert.throws(
      () => gas.startChoiceDistribute('{}'),
      /Choice画像配置が予約または再開待ちです/
    );
    assert.deepEqual(effects, {
      propertyWrites: 0,
      triggerDeletions: 0,
      triggerCreations: 0,
      lockReleases: 1,
    });
    assert.deepEqual(activeSpreadsheet.toasts, []);
  } finally {
    gas.PropertiesService = originals.PropertiesService;
    gas.LockService = originals.LockService;
    gas.ScriptApp = originals.ScriptApp;
    gas.deleteTriggersByFunction_ = originals.deleteTriggersByFunction_;
  }
});

test('runQueuedDistribute keeps cleanup and logging when the queue is empty', () => {
  const effects = {
    propertyReads: 0,
    propertyDeletes: 0,
    triggerDeletions: 0,
    lockAcquisitions: 0,
  };
  const logs = [];
  const originals = {
    PropertiesService: gas.PropertiesService,
    deleteTriggersByFunction_: gas.deleteTriggersByFunction_,
    LockService: gas.LockService,
    Logger: gas.Logger,
  };
  gas.PropertiesService = {
    getScriptProperties() {
      return {
        getProperty() {
          effects.propertyReads++;
          return '';
        },
        deleteProperty() { effects.propertyDeletes++; },
      };
    },
  };
  gas.deleteTriggersByFunction_ = function() { effects.triggerDeletions++; };
  gas.LockService = {
    getScriptLock() {
      effects.lockAcquisitions++;
      throw new Error('Lock must not be acquired');
    },
  };
  gas.Logger = { log(message) { logs.push(message); } };

  try {
    gas.runQueuedDistribute();

    assert.deepEqual(effects, {
      propertyReads: 1,
      propertyDeletes: 1,
      triggerDeletions: 1,
      lockAcquisitions: 0,
    });
    assert.deepEqual(logs, ['予約されたChoice配置設定がありません。']);
  } finally {
    gas.PropertiesService = originals.PropertiesService;
    gas.deleteTriggersByFunction_ = originals.deleteTriggersByFunction_;
    gas.LockService = originals.LockService;
    gas.Logger = originals.Logger;
  }
});

test('_runDistribute rejects sparse configured image headers before side effects', () => {
  const settingSheet = createSheet('setting', [
    [gas.SETTING_KEYS.DEST_FOLDER_URL, 'dest-folder'],
    [gas.SETTING_KEYS.CHOICE_IMAGE_COLS, 'スライド画像1,スライド画像2,スライド画像3'],
  ]);
  const choiceSheet = createSheet('choice_tsv', [
    ['管理コード', 'スライド画像1', 'スライド画像3'],
    ['sado-1', '', ''],
  ]);
  const staleBatchSheet = createSheet('tsv_b1_1品', [['keep']]);
  activeSpreadsheet = createSpreadsheet([settingSheet, choiceSheet, staleBatchSheet]);

  let driveScans = 0;
  let dashboardInitializations = 0;
  let batchMarkings = 0;
  const originalDriveApp = gas.DriveApp;
  const originalLogger = gas.Logger;
  const originalInitChoiceDashboard = gas.initChoiceDashboard_;
  const originalWriteBackBatchMarkings = gas._writeBackBatchMarkings;
  gas.DriveApp = {
    getFolderById() {
      return {
        getFiles() {
          driveScans++;
          throw new Error('Drive scan must not start');
        },
      };
    },
  };
  gas.Logger = { log() {} };
  gas.initChoiceDashboard_ = function() {
    dashboardInitializations++;
  };
  gas._writeBackBatchMarkings = function() {
    batchMarkings++;
  };

  try {
    gas._runDistribute({ isDryRun: true }, true);

    assert.equal(driveScans, 0);
    assert.equal(dashboardInitializations, 0);
    assert.equal(batchMarkings, 0);
    assert.deepEqual(activeSpreadsheet.deletedNames, []);
    assert.deepEqual(activeSpreadsheet.insertedNames, []);
    assert.match(activeSpreadsheet.toasts[0].message, /不足: スライド画像2/);
  } finally {
    gas.DriveApp = originalDriveApp;
    gas.Logger = originalLogger;
    gas.initChoiceDashboard_ = originalInitChoiceDashboard;
    gas._writeBackBatchMarkings = originalWriteBackBatchMarkings;
  }
});

test('_runDistribute rejects duplicate TSV image headers before Drive or sheet side effects', () => {
  const settingSheet = createSheet('setting', [
    [gas.SETTING_KEYS.DEST_FOLDER_URL, 'dest-folder'],
    [gas.SETTING_KEYS.CHOICE_IMAGE_COLS, 'スライド画像1,スライド画像2'],
  ]);
  const choiceSheet = createSheet('choice_tsv', [
    ['管理コード', 'スライド画像1', 'スライド画像1', 'スライド画像2'],
    ['sado-1', '', '', ''],
  ]);
  activeSpreadsheet = createSpreadsheet([settingSheet, choiceSheet]);

  let driveAccesses = 0;
  let dashboardInitializations = 0;
  let batchMarkings = 0;
  const originalDriveApp = gas.DriveApp;
  const originalLogger = gas.Logger;
  const originalInitChoiceDashboard = gas.initChoiceDashboard_;
  const originalWriteBackBatchMarkings = gas._writeBackBatchMarkings;
  gas.DriveApp = {
    getFolderById() {
      driveAccesses++;
      throw new Error('Drive access must not start');
    },
  };
  gas.Logger = { log() {} };
  gas.initChoiceDashboard_ = function() {
    dashboardInitializations++;
  };
  gas._writeBackBatchMarkings = function() {
    batchMarkings++;
  };

  try {
    gas._runDistribute({ isDryRun: true }, true);

    assert.equal(driveAccesses, 0);
    assert.equal(dashboardInitializations, 0);
    assert.equal(batchMarkings, 0);
    assert.deepEqual(activeSpreadsheet.deletedNames, []);
    assert.deepEqual(activeSpreadsheet.insertedNames, []);
    assert.match(activeSpreadsheet.toasts[0].message, /TSVの画像カラム重複: スライド画像1/);
  } finally {
    gas.DriveApp = originalDriveApp;
    gas.Logger = originalLogger;
    gas.initChoiceDashboard_ = originalInitChoiceDashboard;
    gas._writeBackBatchMarkings = originalWriteBackBatchMarkings;
  }
});

test('_runDistribute rejects an effectively empty configured image list before Drive or sheet side effects', () => {
  const settingSheet = createSheet('setting', [
    [gas.SETTING_KEYS.DEST_FOLDER_URL, 'dest-folder'],
    [gas.SETTING_KEYS.CHOICE_IMAGE_COLS, ',,'],
  ]);
  const choiceSheet = createSheet('choice_tsv', [
    ['管理コード', 'スライド画像1'],
    ['sado-1', ''],
  ]);
  const staleBatchSheet = createSheet('tsv_b1_1品', [['keep']]);
  activeSpreadsheet = createSpreadsheet([settingSheet, choiceSheet, staleBatchSheet]);

  let driveAccesses = 0;
  let dashboardInitializations = 0;
  let batchMarkings = 0;
  const originalDriveApp = gas.DriveApp;
  const originalLogger = gas.Logger;
  const originalInitChoiceDashboard = gas.initChoiceDashboard_;
  const originalWriteBackBatchMarkings = gas._writeBackBatchMarkings;
  gas.DriveApp = {
    getFolderById() {
      driveAccesses++;
      throw new Error('Drive access must not start');
    },
  };
  gas.Logger = { log() {} };
  gas.initChoiceDashboard_ = function() {
    dashboardInitializations++;
  };
  gas._writeBackBatchMarkings = function() {
    batchMarkings++;
  };

  try {
    gas._runDistribute({ isDryRun: true }, true);

    assert.equal(driveAccesses, 0);
    assert.equal(dashboardInitializations, 0);
    assert.equal(batchMarkings, 0);
    assert.deepEqual(activeSpreadsheet.deletedNames, []);
    assert.deepEqual(activeSpreadsheet.insertedNames, []);
    assert.match(activeSpreadsheet.toasts[0].message, /Choice画像カラム名リストに有効なカラム名がありません/);
  } finally {
    gas.DriveApp = originalDriveApp;
    gas.Logger = originalLogger;
    gas.initChoiceDashboard_ = originalInitChoiceDashboard;
    gas._writeBackBatchMarkings = originalWriteBackBatchMarkings;
  }
});

test('getOrAppendHeaderIndex_ reuses an exact output-batch header and otherwise returns the append index', () => {
  const existing = ['A', '出力バッチ'];
  const absent = ['A'];

  assert.equal(gas.getOrAppendHeaderIndex_(existing, '出力バッチ'), 1);
  assert.equal(gas.getOrAppendHeaderIndex_(absent, '出力バッチ'), 1);
  assert.equal(gas.getOrAppendHeaderIndex_(['A', '出力バッチ '], '出力バッチ'), 2);
  assert.deepEqual(existing, ['A', '出力バッチ']);
  assert.deepEqual(absent, ['A']);
});

test('stripInternalColumns_ removes output-batch cells without changing order or inputs', () => {
  const headers = ['A', '出力バッチ', 'B'];
  const rows = [['a', 'batch_001', 'b'], ['c', '未マッチ', 'd']];

  const actual = gas.stripInternalColumns_(headers, rows, ['出力バッチ']);

  assert.deepEqual(plain(actual), {
    headers: ['A', 'B'],
    rows: [['a', 'b'], ['c', 'd']],
  });
  assert.deepEqual(headers, ['A', '出力バッチ', 'B']);
  assert.deepEqual(rows, [['a', 'batch_001', 'b'], ['c', '未マッチ', 'd']]);
});

test('buildChoiceImageMatch_ prefers the product-specific _9 image', () => {
  const fallback = { name: 'Sado,_Niigata.jpg', size: 10 };
  const product1 = { name: 'code_1.jpg', size: 20 };
  const product9 = { name: 'code_9.png', size: 30 };

  const result = gas.buildChoiceImageMatch_('CODE', {
    'code_1.jpg': product1,
    'code_9.png': product9,
    'sado,_niigata.jpg': fallback,
  }, 9, 'Sado,_Niigata.jpg');

  assert.deepEqual(plain(result.files.map(file => [file.imageNum, file.fileInfo.name])), [
    [1, 'code_1.jpg'],
    [9, 'code_9.png'],
  ]);
  assert.equal(result.usedFallback, false);
  assert.equal(result.error, '');
});

test('buildChoiceImageMatch_ uses the common packing image when _9 is absent', () => {
  const result = gas.buildChoiceImageMatch_('code', {
    'code_1.jpg': { name: 'code_1.jpg', size: 20 },
    'sado,_niigata.jpg': { name: 'Sado,_Niigata.jpg', size: 10 },
  }, 9, 'Sado,_Niigata.jpg');

  assert.deepEqual(plain(result.files.map(file => [file.imageNum, file.fileInfo.name])), [
    [1, 'code_1.jpg'],
    [9, 'Sado,_Niigata.jpg'],
  ]);
  assert.equal(result.usedFallback, true);
  assert.equal(result.error, '');
});

test('buildChoiceImageMatch_ reports a missing common image only for otherwise matched products', () => {
  const missingFallback = gas.buildChoiceImageMatch_('code', {
    'code_1.jpg': { name: 'code_1.jpg', size: 20 },
  }, 9, 'Sado,_Niigata.jpg');
  const unmatched = gas.buildChoiceImageMatch_('missing', {
    'sado,_niigata.jpg': { name: 'Sado,_Niigata.jpg', size: 10 },
  }, 9, 'Sado,_Niigata.jpg');

  assert.match(missingFallback.error, /Sado,_Niigata\.jpg/);
  assert.deepEqual(plain(unmatched.files), []);
  assert.equal(unmatched.usedFallback, false);
  assert.equal(unmatched.error, '');
});

test('buildChoiceMatchPlan_ aggregates fallback use, unmatched codes, and fallback errors', () => {
  const tsvData = [
    ['管理コード'],
    ['with-fallback'],
    ['unmatched'],
    ['missing-fallback'],
  ];
  const fileMap = {
    'with-fallback_1.jpg': { name: 'with-fallback_1.jpg', size: 20 },
    'missing-fallback_1.jpg': { name: 'missing-fallback_1.jpg', size: 30 },
    'sado,_niigata.jpg': { name: 'Sado,_Niigata.jpg', size: 10 },
  };
  const withoutFallback = Object.assign({}, fileMap);
  delete withoutFallback['sado,_niigata.jpg'];

  const success = gas.buildChoiceMatchPlan_(tsvData.slice(0, 3), 0, fileMap, 9, 'Sado,_Niigata.jpg');
  const failure = gas.buildChoiceMatchPlan_([tsvData[0], tsvData[3]], 0, withoutFallback, 9, 'Sado,_Niigata.jpg');

  assert.equal(success.matchResults.length, 1);
  assert.deepEqual(plain(success.unmatchedCodes), ['unmatched']);
  assert.equal(success.fallbackCount, 1);
  assert.deepEqual(plain(success.errors), []);
  assert.equal(failure.matchResults.length, 0);
  assert.match(failure.errors[0], /missing-fallback/);
  assert.match(failure.errors[0], /Sado,_Niigata\.jpg/);
});

test('parseChoiceBatchSizeMb_ accepts 1 through 80 and rejects invalid settings', () => {
  assert.equal(gas.parseChoiceBatchSizeMb_('70'), 70);
  assert.equal(gas.parseChoiceBatchSizeMb_('1'), 1);
  assert.equal(gas.parseChoiceBatchSizeMb_('80'), 80);
  assert.throws(() => gas.parseChoiceBatchSizeMb_(''), /Choiceバッチサイズ/);
  assert.throws(() => gas.parseChoiceBatchSizeMb_('abc'), /Choiceバッチサイズ/);
  assert.throws(() => gas.parseChoiceBatchSizeMb_('0'), /1〜80/);
  assert.throws(() => gas.parseChoiceBatchSizeMb_('81'), /1〜80/);
});

test('_splitIntoBatches uses the configured Choice byte limit', () => {
  const MB = 1024 * 1024;
  const items = [1, 2].map((rowIndex) => ({
    rowIndex,
    files: [{ fileInfo: { size: 40 * MB } }],
  }));

  assert.deepEqual(
    plain(gas._splitIntoBatches(items, 70 * MB)).map((batch) => batch.items.length),
    [1, 1]
  );
  assert.deepEqual(
    plain(gas._splitIntoBatches(items, 80 * MB)).map((batch) => batch.items.length),
    [2]
  );
});

test('_buildChoiceDistDialogHtml displays the configured Choice batch size', () => {
  const html = gas._buildChoiceDistDialogHtml({
    tsvRowCount: 1,
    imageColCount: 9,
    mgmtCodeFound: true,
    batchSizeMB: 70,
  }, false);

  assert.match(html, /70MB/);
  assert.doesNotMatch(html, /80MB単位/);
});

test('buildChoiceCompletedBatch_ excludes a product when any matched image failed', () => {
  const file1 = { imageNum: 1, fileInfo: { name: 'sado-1_1.jpg', size: 10 } };
  const file2 = { imageNum: 2, fileInfo: { name: 'sado-1_2.jpg', size: 20 } };
  const file3 = { imageNum: 1, fileInfo: { name: 'sado-2_1.jpg', size: 30 } };
  const batch = {
    items: [
      { rowIndex: 1, mgmtCode: 'sado-1', files: [file1, file2], tsvRowData: ['sado-1'] },
      { rowIndex: 2, mgmtCode: 'sado-2', files: [file3], tsvRowData: ['sado-2'] },
    ],
    totalFiles: 3,
    totalSize: 60,
  };

  const actual = plain(gas.buildChoiceCompletedBatch_(batch, {
    1: [file1],
    2: [file3],
  }));

  assert.deepEqual(actual.failedRowIndices, [1]);
  assert.equal(actual.completedBatch.items.length, 1);
  assert.equal(actual.completedBatch.items[0].rowIndex, 2);
  assert.deepEqual(actual.completedBatch.items[0].files, [file3]);
  assert.equal(actual.completedBatch.totalFiles, 1);
  assert.equal(actual.completedBatch.totalSize, 30);
});

test('writeChoiceBatchOutcomeMarkings_ marks only fully placed products as upload-ready', () => {
  const sheet = createSheet('choice_tsv', [
    ['管理コード', '出力バッチ'],
    ['sado-1', '未マッチ'],
    ['sado-2', '未マッチ'],
  ]);
  const headers = sheet.data[0].slice();

  gas.writeChoiceBatchOutcomeMarkings_(sheet, plain(sheet.data), headers, 1, [2], [1]);

  assert.deepEqual(sheet.data, [
    ['管理コード', '出力バッチ'],
    ['sado-1', 'エラー'],
    ['sado-2', 'batch_001'],
  ]);
});

test('deleteBatchTsvSheets_ removes stale output when an entire batch failed', () => {
  const staleA = createSheet('tsv_b2_1品', [['stale']]);
  const staleB = createSheet('tsv_b2_3品', [['stale']]);
  const keep = createSheet('tsv_b20_1品', [['keep']]);
  const spreadsheet = createSpreadsheet([staleA, staleB, keep]);

  gas.deleteBatchTsvSheets_(spreadsheet, 2);

  assert.deepEqual(spreadsheet.deletedNames, ['tsv_b2_1品', 'tsv_b2_3品']);
  assert.equal(spreadsheet.getSheetByName('tsv_b20_1品'), keep);
});

test('findBatchSheetNames_ returns all exact-prefix sheets without matching batch 10', () => {
  const actual = gas.findBatchSheetNames_([
    'tsv_b1_10品',
    'tsv_b1_12品',
    'tsv_b10_3品',
    'prefix_tsv_b1_4品',
    'tsv_b2_4品',
  ], 1);

  assert.deepEqual(plain(actual), ['tsv_b1_10品', 'tsv_b1_12品']);
});

test('_writeBackBatchMarkings overwrites the existing output-batch column on repeated runs', () => {
  const sheet = createSheet('choice_tsv', [
    ['管理コード', '出力バッチ'],
    ['sado-1', 'old'],
    ['sado-2', 'old'],
  ]);
  const headers = ['管理コード', '出力バッチ'];
  const tsvData = plain(sheet.data);
  const batches = [{ items: [{ rowIndex: 1 }] }];

  gas._writeBackBatchMarkings(sheet, tsvData, headers, batches);
  gas._writeBackBatchMarkings(sheet, plain(sheet.data), headers, batches);

  assert.deepEqual(sheet.data, [
    ['管理コード', '出力バッチ'],
    ['sado-1', 'batch_001'],
    ['sado-2', '未マッチ'],
  ]);
  assert.equal(sheet.data[0].length, 2);
});

test('_generateBatchTsvSheet writes every upload cell as plain text and excludes the internal column', () => {
  const staleA = createSheet('tsv_b1_1品', [['stale-a']]);
  const staleB = createSheet('tsv_b1_99品', [['stale-b']]);
  const batchTen = createSheet('tsv_b10_1品', [['keep']]);
  activeSpreadsheet = createSpreadsheet([staleA, staleB, batchTen]);
  const headers = ['管理コード', 'スライド画像1', '出力バッチ', 'お礼の品画像', '備考'];
  const sourceRow = ['sado-1', 'old-slide.jpg', 'batch_001', 'old-main.jpg', 'keep'];
  const batch = {
    items: [{
      tsvRowData: sourceRow,
      tsvRowNumberFormats: ['@', '@', '@', '@', 'yyyy/MM/dd'],
      files: [{ imageNum: 1, fileInfo: { name: 'sado-1_1.jpg' } }],
    }],
    totalFiles: 1,
    totalSize: 1234,
  };

  gas._generateBatchTsvSheet(
    activeSpreadsheet,
    1,
    batch,
    headers,
    [{ index: 1, name: 'スライド画像1' }],
    0
  );

  assert.deepEqual(activeSpreadsheet.deletedNames, ['tsv_b1_1品', 'tsv_b1_99品']);
  assert.equal(activeSpreadsheet.getSheetByName('tsv_b10_1品'), batchTen);
  const currentSheets = activeSpreadsheet.getSheets().filter((sheet) => sheet.getName().startsWith('tsv_b1_'));
  assert.equal(currentSheets.length, 1);
  assert.deepEqual(currentSheets[0].data.slice(0, 2), [
    ['管理コード', 'スライド画像1', 'お礼の品画像', '備考'],
    ['sado-1', 'sado-1_1.jpg', 'sado-1_1.jpg', 'keep'],
  ]);
  assert.equal(gas.getBatchTsvText(1), 'sado-1\tsado-1_1.jpg\tsado-1_1.jpg\tkeep');
  assert.deepEqual(currentSheets[0].numberFormats[1], ['@', '@', '@', '@']);
  assert.deepEqual(headers, ['管理コード', 'スライド画像1', '出力バッチ', 'お礼の品画像', '備考']);
  assert.deepEqual(sourceRow, ['sado-1', 'old-slide.jpg', 'batch_001', 'old-main.jpg', 'keep']);
});

test('batch output preserves all displayed non-image values from choice_tsv', () => {
  activeSpreadsheet = createSpreadsheet([]);
  const headers = ['管理コード', '商品名', '説明', '公開日', 'スライド画像1', 'お礼の品画像'];
  const rawData = [
    headers,
    ['sado-1', '', '', new Date('2026-06-21T00:00:00+09:00'), 'old-slide.jpg', 'old-main.jpg'],
  ];
  const displayData = [
    headers,
    ['sado-1', '商品名A', '1行目\n2行目', '2026/06/21', 'old-slide.jpg', 'old-main.jpg'],
  ];
  const fileMap = {
    'sado-1_1.jpg': { name: 'sado-1_1.jpg', size: 100 },
  };
  const plan = gas.buildChoiceMatchPlan_(rawData, 0, fileMap, 1, '', displayData);
  const batch = { items: plan.matchResults, totalFiles: 1, totalSize: 100 };

  gas._generateBatchTsvSheet(
    activeSpreadsheet,
    1,
    batch,
    headers,
    [{ index: 4, name: 'スライド画像1' }],
    0
  );

  assert.deepEqual(activeSpreadsheet.getSheetByName('tsv_b1_1品').data.slice(0, 2), [
    headers,
    ['sado-1', '商品名A', '1行目\n2行目', '2026/06/21', 'sado-1_1.jpg', 'sado-1_1.jpg'],
  ]);
});

test('_generateBatchTsvSheet maps each image number to its exact configured header slot', () => {
  activeSpreadsheet = createSpreadsheet([]);
  const headers = ['管理コード', 'スライド画像3', 'スライド画像1', 'スライド画像2', 'お礼の品画像'];
  const batch = {
    items: [{
      tsvRowData: ['sado-1', 'old-3.jpg', 'old-1.jpg', 'old-2.jpg', 'old-main.jpg'],
      files: [
        { imageNum: 1, fileInfo: { name: 'sado-1_1.jpg' } },
        { imageNum: 2, fileInfo: { name: 'sado-1_2.jpg' } },
        { imageNum: 3, fileInfo: { name: 'sado-1_3.jpg' } },
      ],
    }],
    totalFiles: 3,
    totalSize: 1234,
  };

  gas._generateBatchTsvSheet(
    activeSpreadsheet,
    1,
    batch,
    headers,
    [
      { index: 2, name: 'スライド画像1' },
      { index: 3, name: 'スライド画像2' },
      { index: 1, name: 'スライド画像3' },
    ],
    0
  );

  assert.deepEqual(activeSpreadsheet.getSheetByName('tsv_b1_1品').data.slice(0, 2), [
    headers,
    ['sado-1', 'sado-1_3.jpg', 'sado-1_1.jpg', 'sado-1_2.jpg', 'sado-1_1.jpg'],
  ]);
});

test('_generateBatchTsvSheet writes the common _9 fallback only to the packing-image column', () => {
  activeSpreadsheet = createSpreadsheet([]);
  const headers = [
    '管理コード',
    'スライド画像1', 'スライド画像2', 'スライド画像3', 'スライド画像4',
    'スライド画像5', 'スライド画像6', 'スライド画像7', 'スライド画像8',
    '品梱包画像', 'お礼の品画像'
  ];
  const imageColumns = headers.slice(1, 10).map((name, index) => ({ index: index + 1, name }));
  const batch = {
    items: [{
      tsvRowData: ['sado-1'].concat(Array(10).fill('old')),
      files: [
        { imageNum: 1, fileInfo: { name: 'sado-1_1.jpg' } },
        { imageNum: 9, fileInfo: { name: 'Sado,_Niigata.jpg' }, isPackingFallback: true },
      ],
    }],
    totalFiles: 2,
    totalSize: 1234,
  };

  gas._generateBatchTsvSheet(activeSpreadsheet, 1, batch, headers, imageColumns, 0);

  const row = activeSpreadsheet.getSheetByName('tsv_b1_1品').data[1];
  assert.equal(row[1], 'sado-1_1.jpg');
  assert.equal(row[9], 'Sado,_Niigata.jpg');
  assert.equal(row[10], 'sado-1_1.jpg');
});

test('getBatchTsvText preserves multiline cells with TSV quoting', () => {
  activeSpreadsheet = createSpreadsheet([
    createSheet('tsv_b1_1品', [
      ['管理コード', '説明', '備考'],
      ['sado-1', '1行目\n2行目', '引用符"と\tタブ'],
      [],
      ['--- バッチ 1 情報 ---'],
    ]),
  ]);

  assert.equal(
    gas.getBatchTsvText(1),
    'sado-1\t"1行目\n2行目"\t"引用符""と\tタブ"'
  );
});

test('getBatchTsvText uses displayed date text instead of serializing a Date object', () => {
  const dateValue = new Date('2026-06-21T00:00:00+09:00');
  const batchSheet = {
    getName() { return 'tsv_b1_1品'; },
    getDataRange() {
      return {
        getValues() { return [['日付'], [dateValue], [], ['--- バッチ 1 情報 ---']]; },
        getDisplayValues() { return [['日付'], ['2026/06/21'], [], ['--- バッチ 1 情報 ---']]; },
      };
    },
  };
  activeSpreadsheet = createSpreadsheet([batchSheet]);

  assert.equal(gas.getBatchTsvText(1), '2026/06/21');
});

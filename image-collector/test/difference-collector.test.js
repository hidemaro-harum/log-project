const test = require('node:test');
const assert = require('node:assert/strict');
const { loadGas } = require('./load-gas');

function plain(value) { return JSON.parse(JSON.stringify(value)); }
function iterator(values) {
  let index = 0;
  return { hasNext: () => index < values.length, next: () => values[index++] };
}

test('difference classification is case-insensitive and checks integrated first', () => {
  const gas = loadGas(['src/Config.js', 'src/DifferenceCollector.js']);
  assert.equal(gas.SETTING_KEYS.DIFF_DEST_FOLDER_URL, '差分画像保存先フォルダURL');
  assert.equal(gas.classifyDifferenceFile_('A.JPG', { 'a.jpg': true }, { 'a.jpg': true }), 'INTEGRATED');
  assert.equal(gas.classifyDifferenceFile_('A.JPG', {}, { 'a.jpg': true }), 'DIFF_EXISTS');
  assert.equal(gas.classifyDifferenceFile_('A.JPG', {}, {}), 'NEW');
  assert.equal(gas.classifyDifferenceFile_(' A.JPG ', {}, { 'a.jpg': true }), 'NEW');
});

test('difference copy handles categories and reserves names only after success', () => {
  let copies = 0;
  const files = [
    ['A.JPG', 'image/jpeg'], ['b.png', 'image/png'], ['C.webp', 'image/webp'],
    ['d.txt', 'text/plain'], ['E.jpg', 'image/jpeg'], ['e.JPG', 'image/jpeg'],
  ].map(([name, mime]) => ({
    getName: () => name,
    getMimeType: () => mime,
    makeCopy() { copies++; if (name === 'E.jpg') throw new Error('denied'); },
  }));
  const gas = loadGas(['src/Config.js', 'src/DifferenceCollector.js'], { Logger: { log() {} } });
  const difference = { 'b.png': true };
  const result = gas.copyDifferenceFilesFromFolder_(
    { getFiles: () => iterator(files) }, {}, { 'a.jpg': true }, difference, false
  );
  assert.deepEqual(plain(result), {
    copied: 2, integratedSkipped: 1, diffExistingSkipped: 1, nonImages: 1,
    errors: 1, total: 6,
    details: [
      'A.JPG: 統合済み', 'b.png: 差分コピー済み', 'd.txt: 画像以外 (text/plain)',
      'E.jpg: コピー失敗 - denied',
    ],
  });
  assert.equal(copies, 3);
  assert.equal(difference['c.webp'], true);
  assert.equal(difference['e.jpg'], true);
});

test('dry run virtually reserves a new name once', () => {
  const gas = loadGas(['src/Config.js', 'src/DifferenceCollector.js']);
  const files = ['X.JPG', 'x.jpg'].map((name) => ({
    getName: () => name, getMimeType: () => 'image/jpeg', makeCopy: () => assert.fail('must not copy'),
  }));
  const difference = {};
  const result = gas.copyDifferenceFilesFromFolder_({ getFiles: () => iterator(files) }, {}, {}, difference, true);
  assert.equal(result.copied, 1);
  assert.equal(result.diffExistingSkipped, 1);
  assert.equal(difference['x.jpg'], true);
});

test('stats checkpoint round-trips cumulative categories', () => {
  const gas = loadGas(['src/Config.js', 'src/DifferenceCollector.js']);
  const stats = { processedRows: 3, copied: 4, integratedSkipped: 5, diffExistingSkipped: 6, otherSkipped: 7, errorCount: 8 };
  const checkpoint = gas.buildDifferenceCheckpoint_(9, stats);
  assert.deepEqual(plain(checkpoint), { targetIndex: 9, stats });
  assert.deepEqual(plain(gas.restoreDifferenceStats_(checkpoint)), stats);
});

test('pending difference work detects properties and dedicated triggers', () => {
  const gas = loadGas(['src/Config.js', 'src/DifferenceCollector.js']);
  const empty = { getProperty: () => null };
  assert.equal(gas.hasPendingDifferenceWork_(empty, []), false);
  assert.equal(gas.hasPendingDifferenceWork_({ getProperty: (k) => k === gas.PROP_KEYS.DIFF_PROGRESS ? '{}' : null }, []), true);
  assert.equal(gas.hasPendingDifferenceWork_(empty, [{ getHandlerFunction: () => 'resumeDifferenceCollect' }]), true);
});

test('row processor scans a source folder once and continues after access errors', () => {
  const rows = [
    ['001', 'folder-1'], ['002', 'folder-1'], ['', ''], ['003', 'bad'], ['004', 'folder-2'],
  ];
  const logs = [];
  const gas = loadGas(['src/Config.js', 'src/DifferenceCollector.js'], {
    DriveApp: { getFolderById(id) { if (id === 'bad') throw new Error('blocked'); return { id }; } },
    extractFolderIdFromUrl_: (value) => value,
    addDashboardRow_: (...args) => logs.push(args),
  });
  gas.copyDifferenceFilesFromFolder_ = (folder) => ({ copied: folder.id === 'folder-1' ? 1 : 2, integratedSkipped: 0, diffExistingSkipped: 0, nonImages: 0, errors: 0, total: 1, details: [] });
  const stats = gas.restoreDifferenceStats_(null);
  const result = gas.processDifferenceCollectRows_({ data: [['h1', 'h2'], ...rows], targetRows: [1, 2, 3, 4, 5], startIndex: 0,
    mgmtCodeIdx: 0, folderLinkIdx: 1, integratedFiles: {}, differenceFiles: {}, differenceFolder: {}, isDryRun: true,
    stats, seenSourceFolderIds: {}, shouldStop: () => false });
  assert.equal(result.completed, true);
  assert.deepEqual(plain(stats), { processedRows: 5, copied: 3, integratedSkipped: 0, diffExistingSkipped: 0, otherSkipped: 2, errorCount: 1 });
  assert.match(logs[1][5], /同一ソースフォルダの重複行/);
  assert.match(logs[3][5], /フォルダアクセス失敗/);
});

test('context rejects identical destinations before Drive access', () => {
  let driveAccesses = 0;
  const gas = loadGas(['src/Config.js', 'src/DifferenceCollector.js'], {
    SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: () => ({ getDataRange: () => ({ getValues: () => [['管理番号', 'フォルダリンク']] }) }) }) },
    getSettingValue_: () => 'same-folder',
    createColumnMap_: (headers) => Object.fromEntries(headers.map((value, index) => [value, index])),
    extractFolderIdFromUrl_: (value) => value,
    DriveApp: { getFolderById() { driveAccesses++; return {}; } },
  });
  assert.throws(() => gas.loadDifferenceCollectContext_(), /same|same-folder|同じフォルダ/);
  assert.equal(driveAccesses, 0);
});

test('startDifferenceCollect lock failure performs no writes and does not release an unowned lock', () => {
  let releases = 0;
  let writes = 0;
  let triggers = 0;
  const gas = loadGas(['src/Config.js', 'src/DifferenceCollector.js'], {
    LockService: { getScriptLock: () => ({ tryLock: () => false, releaseLock: () => releases++ }) },
    PropertiesService: { getScriptProperties: () => ({ setProperty: () => writes++ }) },
    ScriptApp: { getProjectTriggers: () => [], newTrigger: () => { triggers++; } },
  });
  assert.throws(() => gas.startDifferenceCollect('{}'), /実行中/);
  assert.equal(releases, 0);
  assert.equal(writes, 0);
  assert.equal(triggers, 0);
});

test('preflight rejects every missing input before Drive access', () => {
  const cases = [
    { name: 'integrated URL', settings: { diff: 'diff' }, sheet: [['管理番号', 'フォルダリンク']], message: /統合先/ },
    { name: 'difference URL', settings: { integrated: 'integrated' }, sheet: [['管理番号', 'フォルダリンク']], message: /差分画像保存先/ },
    { name: 'master', settings: { integrated: 'integrated', diff: 'diff' }, sheet: null, message: /master/ },
    { name: 'management header', settings: { integrated: 'integrated', diff: 'diff' }, sheet: [['フォルダリンク']], message: /管理番号/ },
    { name: 'folder header', settings: { integrated: 'integrated', diff: 'diff' }, sheet: [['管理番号']], message: /フォルダリンク/ },
  ];
  for (const item of cases) {
    let driveAccesses = 0;
    const gas = loadGas(['src/Config.js', 'src/DifferenceCollector.js'], {
      SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: () => item.sheet === null ? null : ({ getDataRange: () => ({ getValues: () => item.sheet }) }) }) },
      getSettingValue_: (key) => key === '統合先フォルダURL' ? (item.settings.integrated || '') : (item.settings.diff || ''),
      createColumnMap_: (headers) => Object.fromEntries(headers.map((value, index) => [value, index])),
      extractFolderIdFromUrl_: (value) => value,
      DriveApp: { getFolderById() { driveAccesses++; return {}; } },
    });
    assert.throws(() => gas.loadDifferenceCollectContext_(), item.message, item.name);
    assert.equal(driveAccesses, 0, item.name);
  }
});

test('failure detail includes current position and every cumulative category', () => {
  const gas = loadGas(['src/Config.js', 'src/DifferenceCollector.js']);
  const detail = gas.buildDifferenceFailureDetail_(new Error('boom'), {
    targetIndex: 3,
    stats: { processedRows: 3, copied: 4, integratedSkipped: 5, diffExistingSkipped: 6, otherSkipped: 7, errorCount: 8 },
  }, 10);
  assert.match(detail, /boom/);
  assert.match(detail, /4\/10/);
  assert.match(detail, /コピー: 4/);
  assert.match(detail, /統合済み: 5/);
  assert.match(detail, /差分コピー済み: 6/);
  assert.match(detail, /その他スキップ: 7/);
  assert.match(detail, /エラー: 8/);
});

test('fresh preflight failure clears all difference state and both triggers', () => {
  const values = new Map([['IMG_DIFF_CONFIG', '{}'], ['IMG_DIFF_QUEUE_CONFIG', '{}']]);
  const deletedTriggers = [];
  const gas = loadGas(['src/Config.js', 'src/DifferenceCollector.js'], {
    SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: () => null }) },
    PropertiesService: { getScriptProperties: () => ({
      getProperty: (key) => values.get(key) || null,
      setProperty: (key, value) => values.set(key, value),
      deleteProperty: (key) => values.delete(key),
    }) },
    getSettingValue_: () => '',
    deleteTriggersByFunction_: (name) => deletedTriggers.push(name),
  });
  assert.throws(() => gas.runDifferenceCollect_({}, true), /統合先/);
  assert.deepEqual([...values.keys()], []);
  assert.deepEqual(deletedTriggers, ['runQueuedDifferenceCollect', 'resumeDifferenceCollect']);
});

test('recoverable preflight failure keeps a valid checkpoint and exactly one resume trigger', () => {
  const checkpoint = { targetIndex: 2, stats: { processedRows: 2, copied: 1, integratedSkipped: 2, diffExistingSkipped: 3, otherSkipped: 4, errorCount: 5 } };
  const values = new Map([['IMG_DIFF_PROGRESS', JSON.stringify(checkpoint)], ['IMG_DIFF_CONFIG', '{}']]);
  const deletedTriggers = [];
  const created = [];
  const gas = loadGas(['src/Config.js', 'src/DifferenceCollector.js'], {
    SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: () => null }) },
    PropertiesService: { getScriptProperties: () => ({
      getProperty: (key) => values.get(key) || null,
      setProperty: (key, value) => values.set(key, value),
      deleteProperty: (key) => values.delete(key),
    }) },
    getSettingValue_: () => '',
    deleteTriggersByFunction_: (name) => deletedTriggers.push(name),
    ScriptApp: { newTrigger: (name) => ({ timeBased: () => ({ after: () => ({ create: () => created.push(name) }) }) }) },
  });
  assert.throws(() => gas.runDifferenceCollect_({}, true), /統合先/);
  assert.deepEqual(plain(JSON.parse(values.get('IMG_DIFF_PROGRESS'))), checkpoint);
  assert.ok(values.has('IMG_DIFF_CONFIG'));
  assert.deepEqual(deletedTriggers, ['runQueuedDifferenceCollect', 'resumeDifferenceCollect']);
  assert.deepEqual(created, ['resumeDifferenceCollect']);
});

test('timeout checkpoints current row and resume rebuilds both name sets without duplicate copies', () => {
  const values = new Map();
  const triggerNames = [];
  const copied = [];
  const completed = [];
  const deletedHandlers = [];
  const enumerations = { integrated: 0, diff: 0 };
  let nowValues = [0, 0, 20];
  const makeIterator = (items) => iterator(items);
  const integratedFolder = { getFiles() { enumerations.integrated++; return makeIterator([]); } };
  const differenceFolder = { getFiles() { enumerations.diff++; return makeIterator(copied.map((name) => ({ getName: () => name }))); } };
  const sourceFolders = {
    source1: { getFiles: () => makeIterator([{ getName: () => 'A.JPG', getMimeType: () => 'image/jpeg', makeCopy: (name) => copied.push(name) }]) },
    source2: { getFiles: () => makeIterator([{ getName: () => 'B.JPG', getMimeType: () => 'image/jpeg', makeCopy: (name) => copied.push(name) }]) },
  };
  const props = {
    getProperty: (key) => values.get(key) || null,
    setProperty: (key, value) => values.set(key, value),
    deleteProperty: (key) => values.delete(key),
  };
  const gas = loadGas(['src/Config.js', 'src/Utils.js', 'src/DifferenceCollector.js'], {
    Date: { now: () => nowValues.length > 1 ? nowValues.shift() : nowValues[0] },
    SpreadsheetApp: { getActiveSpreadsheet: () => ({
      getSheetByName: (name) => name === 'master' ? ({ getDataRange: () => ({ getValues: () => [['管理番号', 'フォルダリンク'], ['1', 'source1'], ['2', 'source2']] }) }) : null,
    }) },
    PropertiesService: { getScriptProperties: () => props },
    getSettingValue_: (key) => key === '統合先フォルダURL' ? 'integrated' : 'diff',
    DriveApp: { getFolderById: (id) => id === 'integrated' ? integratedFolder : id === 'diff' ? differenceFolder : sourceFolders[id] },
    initDashboard_: () => {}, updateDashboardStatus_: () => {}, updateDashboardSummary_: () => {}, addDashboardRow_: () => {},
    completeOperation_: (...args) => completed.push(args), recordOperationResult_: () => {},
    ScriptApp: {
      getProjectTriggers: () => triggerNames.map((name) => ({ getHandlerFunction: () => name })),
      deleteTrigger: (trigger) => { const i = triggerNames.indexOf(trigger.getHandlerFunction()); if (i >= 0) triggerNames.splice(i, 1); },
      newTrigger: (name) => ({ timeBased: () => ({ after: () => ({ create: () => triggerNames.push(name) }) }) }),
    },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    Logger: { log() {} },
  });
  gas.getSettingValue_ = (key) => key === '統合先フォルダURL' ? 'integrated' : 'diff';
  gas.deleteTriggersByFunction_ = (name) => {
    deletedHandlers.push(name);
    for (let i = triggerNames.length - 1; i >= 0; i--) if (triggerNames[i] === name) triggerNames.splice(i, 1);
  };
  gas.EXEC_CONFIG.TIME_LIMIT_MS = 10;
  const paused = gas.runDifferenceCollect_({}, true);
  assert.equal(paused.paused, true);
  assert.deepEqual(plain(JSON.parse(values.get('IMG_DIFF_PROGRESS'))), {
    targetIndex: 1,
    stats: { processedRows: 1, copied: 1, integratedSkipped: 0, diffExistingSkipped: 0, otherSkipped: 0, errorCount: 0 },
  });
  assert.deepEqual(triggerNames, ['resumeDifferenceCollect']);
  assert.deepEqual(copied, ['A.JPG']);

  nowValues = [0, 0, 0];
  gas.resumeDifferenceCollect();
  assert.deepEqual(copied, ['A.JPG', 'B.JPG']);
  assert.equal(enumerations.integrated, 2);
  assert.equal(enumerations.diff, 2);
  for (const key of ['IMG_DIFF_PROGRESS', 'IMG_DIFF_CONFIG', 'IMG_DIFF_QUEUE_CONFIG']) assert.equal(values.has(key), false);
  assert.deepEqual(triggerNames, []);
  assert.deepEqual(deletedHandlers.slice(-2), ['runQueuedDifferenceCollect', 'resumeDifferenceCollect']);
  assert.equal(completed.length, 1);
  assert.deepEqual(plain(completed[0][0]), {
    operation: '画像差分抽出', mode: '本実行', status: '完了', success: 2, skipped: 0, errors: 0,
    detail: completed[0][0].detail,
  });
  assert.equal(completed[0][0].detail, completed[0][2]);
  assert.match(completed[0][2], /統合済み: 0/);
  assert.match(completed[0][2], /差分コピー済み: 0/);
  assert.match(completed[0][2], /その他スキップ: 0/);
});

test('start guards preserve every pending state and perform zero mutation', () => {
  for (const pending of ['IMG_DIFF_PROGRESS', 'IMG_DIFF_CONFIG', 'IMG_DIFF_QUEUE_CONFIG', 'runQueuedDifferenceCollect', 'resumeDifferenceCollect']) {
    for (const entry of ['startDifferenceCollect', 'startDifferenceDryRun']) {
      let writes = 0;
      let triggers = 0;
      const props = { getProperty: (key) => key === pending ? '{}' : null, setProperty: () => writes++ };
      const gas = loadGas(['src/Config.js', 'src/DifferenceCollector.js'], {
        LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
        PropertiesService: { getScriptProperties: () => props },
        ScriptApp: {
          getProjectTriggers: () => pending.indexOf('DifferenceCollect') !== -1 ? [{ getHandlerFunction: () => pending }] : [],
          newTrigger: () => { triggers++; },
        },
      });
      assert.throws(() => gas[entry]('{}'), /再開待ち/);
      assert.equal(writes, 0, entry + ':' + pending);
      assert.equal(triggers, 0, entry + ':' + pending);
    }
  }
});

test('queued and resume lock contention preserve state and create one retry trigger', () => {
  for (const entry of ['runQueuedDifferenceCollect', 'resumeDifferenceCollect']) {
    const values = new Map(entry === 'runQueuedDifferenceCollect'
      ? [['IMG_DIFF_QUEUE_CONFIG', '{}']]
      : [['IMG_DIFF_PROGRESS', JSON.stringify({ targetIndex: 1, stats: {} })], ['IMG_DIFF_CONFIG', '{}']]);
    const created = [];
    const gas = loadGas(['src/Config.js', 'src/DifferenceCollector.js'], {
      PropertiesService: { getScriptProperties: () => ({
        getProperty: (key) => values.get(key) || null,
        setProperty: (key, value) => values.set(key, value),
        deleteProperty: (key) => values.delete(key),
      }) },
      LockService: { getScriptLock: () => ({ tryLock: () => false, releaseLock: () => assert.fail('unowned release') }) },
      deleteTriggersByFunction_: () => {},
      ScriptApp: { newTrigger: (name) => ({ timeBased: () => ({ after: () => ({ create: () => created.push(name) }) }) }) },
    });
    gas[entry]();
    assert.ok(values.size > 0);
    assert.deepEqual(created, [entry]);
  }
});

test('start UI occurs after release and dialogs do not acquire locks', () => {
  const events = [];
  const gas = loadGas(['src/Config.js', 'src/DifferenceCollector.js'], {
    LockService: { getScriptLock: () => ({ tryLock: () => { events.push('lock'); return true; }, releaseLock: () => events.push('release') }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => null, setProperty: () => events.push('write') }) },
    ScriptApp: { getProjectTriggers: () => [], newTrigger: () => ({ timeBased: () => ({ after: () => ({ create: () => events.push('trigger') }) }) }) },
    deleteTriggersByFunction_: () => {},
    SpreadsheetApp: { getActiveSpreadsheet: () => ({ toast: () => events.push('ui') }) },
  });
  gas.startDifferenceCollect('{}');
  assert.ok(events.indexOf('release') < events.indexOf('ui'));

  let lockCalls = 0;
  const menuGas = loadGas(['src/Config.js', 'src/Menu.js'], {
    LockService: { getScriptLock: () => { lockCalls++; } },
    SpreadsheetApp: { getUi: () => ({ showModalDialog() {} }) },
    HtmlService: { createHtmlOutput: () => ({ setWidth() { return this; }, setHeight() { return this; } }) },
  });
  menuGas.validateDifferencePreRequisites_ = () => ({ dataRowCount: 2 });
  menuGas.buildGenericDialogHtml_ = () => '<html>';
  menuGas.showDifferenceDryRunDialog();
  menuGas.showDifferenceCollectDialog();
  assert.equal(lockCalls, 0);
});

test('queued and resume abnormal history and email share position and cumulative detail', () => {
  for (const entry of ['runQueuedDifferenceCollect', 'resumeDifferenceCollect']) {
    const completed = [];
    const values = new Map(entry === 'runQueuedDifferenceCollect'
      ? [['IMG_DIFF_QUEUE_CONFIG', '{}']]
      : [['IMG_DIFF_PROGRESS', '{}'], ['IMG_DIFF_CONFIG', '{}']]);
    const gas = loadGas(['src/Config.js', 'src/DifferenceCollector.js'], {
      PropertiesService: { getScriptProperties: () => ({
        getProperty: (key) => values.get(key) || null,
        setProperty: (key, value) => values.set(key, value), deleteProperty: (key) => values.delete(key),
      }) },
      LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
      deleteTriggersByFunction_: () => {},
      updateDashboardStatus_: () => {},
      completeOperation_: (...args) => completed.push(args),
    });
    gas.runDifferenceCollect_ = () => { const e = new Error('boom'); e.differenceDetail = '現在位置: 3/9\nコピー: 2\n統合済み: 1\n差分コピー済み: 4\nその他スキップ: 5\nエラー: 6'; throw e; };
    assert.throws(() => gas[entry](), /boom/);
    assert.equal(completed.length, 1);
    assert.equal(completed[0][0].detail, completed[0][2]);
    assert.match(completed[0][2], /現在位置: 3\/9/);
    assert.match(completed[0][2], /差分コピー済み: 4/);
  }
});

function createPagedRunHarness(stopAt, summaryFailsOnce = false, integratedFiles = null, initialDifferenceFiles = null, sourceFiles = null) {
  const values = new Map();
  const triggers = [];
  const copied = [];
  const rows = [];
  let now = 0;
  let summaryFailure = summaryFailsOnce;
  const props = {
    getProperty: (key) => values.get(key) || null,
    setProperty: (key, value) => values.set(key, value),
    deleteProperty: (key) => values.delete(key),
  };
  const folder = (id) => ({ id, getFiles: () => iterator([]) });
  const gas = loadGas(['src/Config.js', 'src/Utils.js', 'src/DifferenceCollector.js'], {
    Date: { now: () => now },
    SpreadsheetApp: { getActiveSpreadsheet: () => ({
      getSheetByName: (name) => name === 'master' ? ({ getDataRange: () => ({ getValues: () => [['管理番号', 'フォルダリンク'], ['1', 'source']] }) }) : null,
    }) },
    PropertiesService: { getScriptProperties: () => props },
    Drive: { Files: { list(options) {
      const query = options.q;
      if (query.includes("'integrated'")) {
        if (stopAt === 'integrated' && !values.has('stopped')) { values.set('stopped', '1'); now = 20; }
        return { files: integratedFiles || [{ id: 'i', name: 'old.jpg', mimeType: 'image/jpeg' }] };
      }
      if (query.includes("'diff'")) {
        if (stopAt === 'diff' && !values.has('stopped')) { values.set('stopped', '1'); now = 20; }
        return { files: (initialDifferenceFiles || []).concat(copied.map((name, index) => ({ id: 'd' + index, name, mimeType: 'image/jpeg' }))) };
      }
      return { files: sourceFiles || [
        { id: 'a', name: 'A.JPG', mimeType: 'image/jpeg' },
        { id: 'b', name: 'B.JPG', mimeType: 'image/jpeg' },
      ] };
    } } },
    DriveApp: {
      getFolderById: (id) => folder(id),
      getFileById: (id) => ({ makeCopy(name) { copied.push(name); if (stopAt === 'source' && id === 'a' && !values.has('stopped')) { values.set('stopped', '1'); now = 20; } } }),
    },
    initDashboard_: () => {}, updateDashboardStatus_: () => {},
    updateDashboardSummary_: () => { if (summaryFailure) { summaryFailure = false; throw new Error('summary failed'); } },
    addDashboardRow_: (...args) => rows.push(args), completeOperation_: () => {}, recordOperationResult_: () => {},
    ScriptApp: {
      getProjectTriggers: () => triggers.map((name) => ({ getHandlerFunction: () => name })),
      deleteTrigger: (trigger) => { const index = triggers.indexOf(trigger.getHandlerFunction()); if (index >= 0) triggers.splice(index, 1); },
      newTrigger: (name) => ({ timeBased: () => ({ after: () => ({ create: () => triggers.push(name) }) }) }),
    },
    Logger: { log() {} },
  });
  gas.getSettingValue_ = (key) => key === '統合先フォルダURL' ? 'integrated' : 'diff';
  gas.EXEC_CONFIG.TIME_LIMIT_MS = 10;
  return { gas, values, triggers, copied, rows, resetDeadline() { now = 0; } };
}

for (const phase of ['integrated', 'diff', 'source']) {
  test(`paged job resumes after deadline during ${phase} processing`, () => {
    const harness = createPagedRunHarness(phase);
    const first = harness.gas.runDifferenceCollect_({}, true);
    assert.equal(first.paused, true);
    const checkpoint = JSON.parse(harness.values.get('IMG_DIFF_PROGRESS'));
    if (phase === 'integrated') assert.equal(checkpoint.phase, 'INTEGRATED_SCAN');
    if (phase === 'diff') assert.equal(checkpoint.phase, 'INTEGRATED_SCAN');
    if (phase === 'source') {
      assert.equal(checkpoint.phase, 'INTEGRATED_SCAN');
      assert.equal(checkpoint.resumeSourceOffset, 1);
      assert.deepEqual(harness.copied, ['A.JPG']);
    }
    assert.deepEqual(harness.triggers, ['resumeDifferenceCollect']);
    harness.resetDeadline();
    const second = harness.gas.runDifferenceCollect_({}, true);
    assert.equal(second.paused, false);
    assert.deepEqual(harness.copied, ['A.JPG', 'B.JPG']);
    assert.deepEqual(harness.triggers, []);
    assert.equal(harness.values.has('IMG_DIFF_PROGRESS'), false);
  });
}

test('trigger creation failures clear queue or recovery state instead of leaving an orphan', () => {
  for (const mode of ['queue', 'resume']) {
    const values = new Map();
    const props = { getProperty: () => null, setProperty: (key, value) => values.set(key, value), deleteProperty: (key) => values.delete(key) };
    const gas = loadGas(['src/Config.js', 'src/DifferenceCollector.js'], {
      PropertiesService: { getScriptProperties: () => props },
      LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
      ScriptApp: { getProjectTriggers: () => [], newTrigger: () => { throw new Error('trigger quota'); } },
      deleteTriggersByFunction_: () => {},
    });
    if (mode === 'queue') assert.throws(() => gas.startDifferenceCollect('{}'), /trigger quota/);
    else assert.throws(() => gas.persistDifferenceRecoveryState_(props, {}, gas.buildDifferenceCheckpoint_(1, {})), /trigger quota/);
    assert.deepEqual([...values.keys()], []);
  }
});

test('final summary failure leaves terminal checkpoint and one retry, then resume completes', () => {
  const harness = createPagedRunHarness(null, true);
  assert.throws(() => harness.gas.runDifferenceCollect_({}, true), /summary failed/);
  const checkpoint = JSON.parse(harness.values.get('IMG_DIFF_PROGRESS'));
  assert.equal(checkpoint.resumeTargetIndex, 1);
  assert.deepEqual(harness.triggers, ['resumeDifferenceCollect']);
  harness.resetDeadline();
  const result = harness.gas.runDifferenceCollect_({}, true);
  assert.equal(result.paused, false);
  assert.deepEqual(harness.copied, ['A.JPG', 'B.JPG']);
  assert.deepEqual(harness.triggers, []);
});

test('thousands of detail lines are capped below the Sheets cell limit with omitted count', () => {
  const gas = loadGas(['src/Config.js', 'src/DifferenceCollector.js']);
  const files = Array.from({ length: 5000 }, (_, index) => ({
    getName: () => `document-${index}-${'x'.repeat(30)}.txt`, getMimeType: () => 'text/plain',
  }));
  const result = gas.copyDifferenceFilesFromFolder_({ getFiles: () => iterator(files) }, {}, {}, {}, true);
  const notes = gas.buildDifferenceRowNotes_(result);
  assert.equal(result.nonImages, 5000);
  assert.ok(result.details.length <= 101);
  assert.match(result.details.at(-1), /他4900件省略/);
  assert.ok(notes.length < 50000);
  assert.equal(gas.buildDifferenceCheckpoint_(1, { processedRows: 1, otherSkipped: 5000 }).stats.otherSkipped, 5000);
});

test('paged checkpoint never serializes destination names or row detail text', () => {
  const gas = loadGas(['src/Config.js', 'src/DifferenceCollector.js']);
  const longNames = Object.fromEntries(Array.from({ length: 220 }, (_, index) => [
    `${index}-${'Long-File-Name-'.repeat(6)}.JPG`, true,
  ]));
  const checkpoint = gas.sanitizeDifferencePagedCheckpoint_({
    targetIndex: 7, phase: 'ROWS', scanPageToken: 'token', integratedNames: longNames, differenceNames: longNames,
    resumeTargetIndex: 7, resumeSourcePageToken: 'source-token', resumeSourceOffset: 123,
    resumeRowResult: { copied: 5, integratedSkipped: 6, diffExistingSkipped: 7, nonImages: 8, errors: 9, total: 35,
      details: Array.from({ length: 200 }, (_, index) => `${index}-${'detail'.repeat(100)}`) },
  }, { processedRows: 7, copied: 5 });
  const serialized = JSON.stringify(checkpoint);
  assert.ok(Buffer.byteLength(serialized, 'utf8') < 9000, serialized.length);
  assert.doesNotMatch(serialized, /Long-File-Name/);
  assert.doesNotMatch(serialized, /detaildetail/);
  assert.deepEqual(plain(checkpoint.resumeRowResult.details), []);
});

test('200 long destination names pause and resume with a sub-9KB checkpoint', () => {
  const files = Array.from({ length: 220 }, (_, index) => ({
    id: `long-${index}`, name: `${index}-${'Long-File-Name-'.repeat(6)}.JPG`, mimeType: 'image/jpeg',
  }));
  const harness = createPagedRunHarness('integrated', false, files);
  assert.equal(harness.gas.runDifferenceCollect_({}, true).paused, true);
  const serialized = harness.values.get('IMG_DIFF_PROGRESS');
  assert.ok(Buffer.byteLength(serialized, 'utf8') < 9000);
  assert.doesNotMatch(serialized, /Long-File-Name/);
  harness.resetDeadline();
  assert.equal(harness.gas.runDifferenceCollect_({}, true).paused, false);
  assert.deepEqual(harness.copied, ['A.JPG', 'B.JPG']);
});

test('paged destination indexes classify actual returned names case-insensitively in integrated-first order', () => {
  const source = [{ id: 'source-a', name: 'a.jpg', mimeType: 'image/jpeg' }];
  const integratedHarness = createPagedRunHarness(null, false,
    [{ id: 'integrated-a', name: 'A.JPG', mimeType: 'image/jpeg' }], [], source);
  const integratedResult = integratedHarness.gas.runDifferenceCollect_({}, true);
  assert.equal(integratedResult.stats.integratedSkipped, 1);
  assert.equal(integratedResult.stats.diffExistingSkipped, 0);
  assert.deepEqual(integratedHarness.copied, []);

  const diffHarness = createPagedRunHarness(null, false, [],
    [{ id: 'diff-a', name: 'A.JPG', mimeType: 'image/jpeg' }], source);
  const diffResult = diffHarness.gas.runDifferenceCollect_({}, true);
  assert.equal(diffResult.stats.integratedSkipped, 0);
  assert.equal(diffResult.stats.diffExistingSkipped, 1);
  assert.deepEqual(diffHarness.copied, []);
});

test('resume rebuilds case-insensitive destination index and skips a prior case-variant copy', () => {
  const source = [
    { id: 'a', name: 'A.JPG', mimeType: 'image/jpeg' },
    { id: 'b', name: 'a.jpg', mimeType: 'image/jpeg' },
  ];
  const harness = createPagedRunHarness('source', false, [], [], source);
  assert.equal(harness.gas.runDifferenceCollect_({}, true).paused, true);
  assert.deepEqual(harness.copied, ['A.JPG']);
  const checkpointText = harness.values.get('IMG_DIFF_PROGRESS');
  assert.ok(Buffer.byteLength(checkpointText, 'utf8') < 9000);
  assert.doesNotMatch(checkpointText, /A\.JPG|a\.jpg/);
  harness.resetDeadline();
  const result = harness.gas.runDifferenceCollect_({}, true);
  assert.equal(result.stats.copied, 1);
  assert.equal(result.stats.diffExistingSkipped, 1);
  assert.deepEqual(harness.copied, ['A.JPG']);
});

for (const failurePoint of ['init', 'status']) {
  test(`initial dashboard ${failurePoint} failure leaves one actionable retry and no config-only orphan`, () => {
    const harness = createPagedRunHarness(null);
    let fail = true;
    if (failurePoint === 'init') {
      harness.gas.initDashboard_ = () => { if (fail) throw new Error('init failed'); };
    } else {
      harness.gas.updateDashboardStatus_ = () => { if (fail) throw new Error('status failed'); };
    }
    assert.throws(() => harness.gas.runDifferenceCollect_({}, true), new RegExp(failurePoint));
    assert.ok(harness.values.has('IMG_DIFF_PROGRESS'));
    assert.ok(harness.values.has('IMG_DIFF_CONFIG'));
    assert.equal(harness.values.has('IMG_DIFF_QUEUE_CONFIG'), false);
    assert.deepEqual(harness.triggers, ['resumeDifferenceCollect']);
    fail = false;
    harness.resetDeadline();
    const result = harness.gas.runDifferenceCollect_({}, true);
    assert.equal(result.paused, false);
    assert.deepEqual(harness.triggers, []);
    assert.equal(harness.values.size, 0);
    assert.equal(harness.values.has('IMG_DIFF_CONFIG'), false);
  });
}

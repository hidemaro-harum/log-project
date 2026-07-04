const test = require('node:test');
const assert = require('node:assert/strict');
const { loadGas } = require('./load-gas');

const gas = loadGas(['src/Config.js', 'src/Utils.js', 'src/DistributorANA.js'], {
  Logger: { log() {} },
});

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function createSheet(initialValues) {
  const data = initialValues.map((row) => row.slice());
  const writeCalls = [];
  const backgroundCalls = [];

  function ensureCell(row, column) {
    while (data.length < row) data.push([]);
    while (data[row - 1].length < column) data[row - 1].push('');
  }

  return {
    data,
    writeCalls,
    backgroundCalls,
    getLastRow() { return data.length; },
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
        setValues(values) {
          writeCalls.push({ row, column, numRows, numColumns, values: plain(values) });
          values.forEach((sourceRow, rowOffset) => {
            sourceRow.forEach((value, columnOffset) => {
              ensureCell(row + rowOffset, column + columnOffset);
              data[row - 1 + rowOffset][column - 1 + columnOffset] = value;
            });
          });
          return this;
        },
        setBackground(value) {
          backgroundCalls.push({ row, column, numRows, numColumns, value });
          return this;
        },
        setBackgrounds(values) {
          backgroundCalls.push({ row, column, numRows, numColumns, values: plain(values) });
          return this;
        },
        setFontColor() { return this; },
        setFontWeight() { return this; },
      };
    },
    autoResizeColumn() {},
  };
}

function createIterator(items) {
  let index = 0;
  return {
    hasNext() { return index < items.length; },
    next() { return items[index++]; },
  };
}

test('getAnaJpegCopyPlan_ uses MIME for conversion and extension for the placed name', () => {
  assert.deepEqual(
    plain(gas.getAnaJpegCopyPlan_('sado_1.png', 'image/png')),
    { fileName: 'sado_1.jpg', convert: true }
  );
  assert.deepEqual(
    plain(gas.getAnaJpegCopyPlan_('sado_1.jpeg', 'image/jpeg')),
    { fileName: 'sado_1.jpeg', convert: false }
  );
  assert.deepEqual(
    plain(gas.getAnaJpegCopyPlan_('sado_1.jpg', 'image/png')),
    { fileName: 'sado_1.jpg', convert: true }
  );
  assert.deepEqual(
    plain(gas.getAnaJpegCopyPlan_('sado_1.jpeg', 'image/png')),
    { fileName: 'sado_1.jpg', convert: true }
  );
  assert.deepEqual(
    plain(gas.getAnaJpegCopyPlan_('sado_1.png', 'image/jpeg')),
    { fileName: 'sado_1.jpg', convert: false }
  );
  assert.deepEqual(
    plain(gas.getAnaJpegCopyPlan_('sado_1.webp', '')),
    { fileName: 'sado_1.jpg', convert: true }
  );
});

test('buildAnaExportData_ projects exactly the standard ANA columns in standard order', () => {
  const headers = plain(gas.getAnaCsvHeaders());
  const reversed = headers.slice().reverse();
  const valuesByHeader = Object.fromEntries(headers.map((header, index) => [header, 'v' + index]));
  const sourceHeaders = ['出力バッチ'].concat(reversed);
  const sourceRow = ['upload_ana_001'].concat(reversed.map((header) => valuesByHeader[header]));

  const actual = plain(gas.buildAnaExportData_([sourceHeaders, sourceRow]));

  assert.equal(headers.length, 100);
  assert.deepEqual(actual[0], headers);
  assert.deepEqual(actual[1], headers.map((header) => valuesByHeader[header]));
  assert.equal(actual[0].includes('出力バッチ'), false);
});

test('buildAnaExportData_ fills optional ANA columns when source sheet omits them', () => {
  const headers = plain(gas.getAnaCsvHeaders());
  const optional = ['C画像ファイル', 'C画像説明', 'ギフティ商品ID'];
  const sourceHeaders = headers.filter((header) => !optional.includes(header));
  const valuesByHeader = Object.fromEntries(sourceHeaders.map((header, index) => [header, 'v' + index]));
  const sourceRow = sourceHeaders.map((header) => valuesByHeader[header]);

  const actual = plain(gas.buildAnaExportData_([sourceHeaders, sourceRow]));

  assert.deepEqual(actual[0], headers);
  optional.forEach((header) => {
    assert.equal(actual[1][headers.indexOf(header)], '');
  });
  assert.equal(actual[1][headers.indexOf('返礼品識別コード')], valuesByHeader['返礼品識別コード']);
});

test('buildAnaExportData_ rejects a missing standard header before export', () => {
  const headers = plain(gas.getAnaCsvHeaders());
  const missing = headers[37];
  const sourceHeaders = headers.filter((header) => header !== missing);

  assert.throws(
    () => gas.buildAnaExportData_([sourceHeaders, sourceHeaders.map(() => '')]),
    { message: '必須ヘッダー不足: ' + missing }
  );
});

test('normalizeAnaSalesStartDateTime_ appends midnight only to valid date-only values', () => {
  assert.equal(gas.normalizeAnaSalesStartDateTime_('2020/01/01'), '2020/01/01 00:00:00');
  assert.equal(gas.normalizeAnaSalesStartDateTime_('2020-1-2'), '2020/01/02 00:00:00');
  assert.equal(gas.normalizeAnaSalesStartDateTime_('2025/09/25 1:00:00'), '2025/09/25 01:00:00');
  assert.equal(gas.normalizeAnaSalesStartDateTime_('2025-9-5 1:02:03'), '2025/09/05 01:02:03');
  assert.equal(gas.normalizeAnaSalesStartDateTime_(new Date(2020, 0, 3)), '2020/01/03 00:00:00');
  assert.equal(gas.normalizeAnaSalesStartDateTime_(new Date(2020, 0, 3, 1, 2, 3)), null);
  assert.equal(gas.normalizeAnaSalesStartDateTime_('2020/01/01 00:00:00'), null);
  assert.equal(gas.normalizeAnaSalesStartDateTime_('2020/01/01 12:34:56'), null);
  assert.equal(gas.normalizeAnaSalesStartDateTime_('2020/01/01 24:00:00'), null);
  assert.equal(gas.normalizeAnaSalesStartDateTime_('2020/02/31'), null);
  assert.equal(gas.normalizeAnaSalesStartDateTime_(''), null);
  assert.equal(gas.normalizeAnaSalesStartDateTime_('販売中'), null);
});

test('validateAnaDistributionHeaders_ rejects missing and duplicate required image headers', () => {
  const required = ['備考(内部用)'];
  for (const imageNum of Object.keys(gas.ANA_CONFIG.IMAGE_NUMBER_MAP)) {
    required.push(...gas.ANA_CONFIG.IMAGE_NUMBER_MAP[imageNum]);
  }

  assert.doesNotThrow(() => gas.validateAnaDistributionHeaders_(required));
  assert.throws(
    () => gas.validateAnaDistributionHeaders_(required.filter((header) => header !== 'D10画像ファイル')),
    /ANA必須カラム不足: D10画像ファイル/
  );
  assert.throws(
    () => gas.validateAnaDistributionHeaders_(required.concat('S画像ファイル')),
    /ANA必須カラム重複: S画像ファイル/
  );
});

test('_runAnaDistribute rejects missing image headers before Drive access', () => {
  const required = ['備考(内部用)'];
  for (const imageNum of Object.keys(gas.ANA_CONFIG.IMAGE_NUMBER_MAP)) {
    required.push(...gas.ANA_CONFIG.IMAGE_NUMBER_MAP[imageNum]);
  }
  const incompleteHeaders = required.filter((header) => header !== 'Ｌ画像ファイル');
  const settingValues = [
    [gas.SETTING_KEYS.DEST_FOLDER_URL, 'source-folder'],
    [gas.SETTING_KEYS.ANA_DEST_FOLDER_URL, 'target-folder'],
  ];
  const makeReadOnlySheet = (values) => ({
    getDataRange() { return { getValues() { return values; } }; },
  });
  const spreadsheet = {
    toasts: [],
    getSheetByName(name) {
      if (name === gas.SHEET_NAMES.SETTING) return makeReadOnlySheet(settingValues);
      if (name === gas.SHEET_NAMES.ANA_CSV) {
        return makeReadOnlySheet([incompleteHeaders, incompleteHeaders.map(() => '')]);
      }
      return null;
    },
    toast(message, title, timeout) { this.toasts.push({ message, title, timeout }); },
  };
  let driveAccesses = 0;
  const freshGas = loadGas(['src/Config.js', 'src/Utils.js', 'src/DistributorANA.js'], {
    Logger: { log() {} },
    SpreadsheetApp: {
      getActiveSpreadsheet() { return spreadsheet; },
    },
    DriveApp: {
      getFolderById() {
        driveAccesses++;
        throw new Error('Drive access must not start');
      },
    },
  });

  const actual = freshGas._runAnaDistribute({}, true, false);

  assert.equal(driveAccesses, 0);
  assert.match(actual.message, /ANA必須カラム不足: Ｌ画像ファイル/);
  assert.match(spreadsheet.toasts[0].message, /ANA必須カラム不足: Ｌ画像ファイル/);
});

test('copyAnaJpegFile_ converts non-JPEG bytes, names the blob and creates the target file', () => {
  const calls = [];
  const convertedBlob = {
    setName(name) {
      calls.push(['setName', name]);
      return this;
    },
  };
  const file = {
    getBlob() {
      calls.push(['getBlob']);
      return {
        getAs(mimeType) {
          calls.push(['getAs', mimeType]);
          return convertedBlob;
        },
      };
    },
    makeCopy() {
      assert.fail('makeCopy must not be used for conversion');
    },
  };
  const targetDir = {
    createFile(blob) {
      calls.push(['createFile', blob]);
      return { id: 'converted' };
    },
  };

  const actual = gas.copyAnaJpegFile_(
    file,
    targetDir,
    { fileName: 'sado_1.jpg', convert: true },
    'image/png'
  );

  assert.deepEqual(calls, [
    ['getBlob'],
    ['getAs', 'image/jpeg'],
    ['setName', 'sado_1.jpg'],
    ['createFile', convertedBlob],
  ]);
  assert.deepEqual(actual, { id: 'converted' });
});

test('copyAnaJpegFile_ converts WebP through a JPEG thumbnail', () => {
  const calls = [];
  const thumbnail = {
    getContentType() {
      calls.push(['getContentType']);
      return 'image/jpeg';
    },
    getAs() {
      assert.fail('a JPEG thumbnail must not be converted again');
    },
    setName(name) {
      calls.push(['setName', name]);
      return this;
    },
  };
  const file = {
    getBlob() {
      assert.fail('WebP must use the thumbnail fallback');
    },
    getThumbnail() {
      calls.push(['getThumbnail']);
      return thumbnail;
    },
  };
  const targetDir = {
    createFile(blob) {
      calls.push(['createFile', blob]);
      return { id: 'thumbnail-copy' };
    },
  };

  const actual = gas.copyAnaJpegFile_(
    file,
    targetDir,
    { fileName: 'sado_1.jpg', convert: true },
    'image/webp'
  );

  assert.deepEqual(calls, [
    ['getThumbnail'],
    ['getContentType'],
    ['setName', 'sado_1.jpg'],
    ['createFile', thumbnail],
  ]);
  assert.deepEqual(actual, { id: 'thumbnail-copy' });
});

test('copyAnaJpegFile_ fails clearly when an unsupported file has no thumbnail', () => {
  const file = {
    getBlob() {
      assert.fail('unsupported input must not use native conversion');
    },
    getThumbnail() {
      return null;
    },
  };

  assert.throws(
    () => gas.copyAnaJpegFile_(
      file,
      { createFile() { assert.fail('no file should be created'); } },
      { fileName: 'sado_1.jpg', convert: true },
      'image/webp'
    ),
    { message: 'JPEG変換用のサムネイルを取得できません: sado_1.jpg' }
  );
});

test('copyAnaJpegFile_ converts a supported thumbnail after native conversion fails', () => {
  const calls = [];
  const jpegBlob = {
    setName(name) {
      calls.push(['setName', name]);
      return this;
    },
  };
  const thumbnail = {
    getContentType() {
      calls.push(['getContentType']);
      return 'image/png';
    },
    getAs(mimeType) {
      calls.push(['thumbnail.getAs', mimeType]);
      return jpegBlob;
    },
  };
  const file = {
    getBlob() {
      calls.push(['getBlob']);
      return {
        getAs(mimeType) {
          calls.push(['blob.getAs', mimeType]);
          throw new Error('native conversion failed');
        },
      };
    },
    getThumbnail() {
      calls.push(['getThumbnail']);
      return thumbnail;
    },
  };
  const targetDir = {
    createFile(blob) {
      calls.push(['createFile', blob]);
      return { id: 'fallback-copy' };
    },
  };

  const actual = gas.copyAnaJpegFile_(
    file,
    targetDir,
    { fileName: 'sado_1.jpg', convert: true },
    'image/png'
  );

  assert.deepEqual(calls, [
    ['getBlob'],
    ['blob.getAs', 'image/jpeg'],
    ['getThumbnail'],
    ['getContentType'],
    ['thumbnail.getAs', 'image/jpeg'],
    ['setName', 'sado_1.jpg'],
    ['createFile', jpegBlob],
  ]);
  assert.deepEqual(actual, { id: 'fallback-copy' });
});

test('copyAnaJpegFile_ copies JPEG bytes without requesting a converted blob', () => {
  const calls = [];
  const copiedFile = { id: 'copied' };
  const file = {
    getBlob() {
      assert.fail('getBlob must not be used for JPEG copy');
    },
    makeCopy(name, targetDir) {
      calls.push([name, targetDir]);
      return copiedFile;
    },
  };
  const targetDir = {};

  const actual = gas.copyAnaJpegFile_(
    file,
    targetDir,
    { fileName: 'sado_1.jpg', convert: false }
  );

  assert.deepEqual(calls, [['sado_1.jpg', targetDir]]);
  assert.equal(actual, copiedFile);
});

test('placeAnaImageInFolder_ checks the planned name and skips an existing JPEG', () => {
  const checkedNames = [];
  const stats = { copiedFiles: 0, skippedFiles: 0, errorFiles: 0 };
  const batchErrors = [];
  const fileInfo = {
    name: 'sado_1.png',
    file: {
      getMimeType() { return 'image/png'; },
      getBlob() { assert.fail('existing target must not be converted'); },
    },
  };
  const targetDir = {
    getFilesByName(name) {
      checkedNames.push(name);
      return createIterator([{
        getMimeType() { return 'image/jpeg'; },
      }]);
    },
  };

  const actual = gas.placeAnaImageInFolder_(
    fileInfo,
    targetDir,
    stats,
    batchErrors,
    'sado',
    'S'
  );

  assert.equal(actual, 'skipped');
  assert.deepEqual(checkedNames, ['sado_1.jpg']);
  assert.deepEqual(stats, { copiedFiles: 0, skippedFiles: 1, errorFiles: 0 });
  assert.deepEqual(batchErrors, []);
});

test('placeAnaImageTarget_ trashes a legacy non-JPEG .jpg and creates a real JPEG', () => {
  const events = [];
  const stats = { copiedFiles: 0, skippedFiles: 0, errorFiles: 0 };
  const batchErrors = [];
  const convertedBlob = {
    setName(name) { events.push('setName:' + name); return this; },
  };
  const legacy = {
    getMimeType() { events.push('inspect:legacy'); return 'image/png'; },
    setTrashed(value) { events.push('trash:' + value); },
  };
  const fileInfo = {
    name: 'sado_1.png',
    file: {
      getMimeType() { return 'image/png'; },
      getBlob() {
        return { getAs() { events.push('convert'); return convertedBlob; } };
      },
    },
  };
  const targetDir = {
    getFilesByName() { return createIterator([legacy]); },
    createFile(blob) { events.push('create'); assert.equal(blob, convertedBlob); return {}; },
  };

  const result = gas.placeAnaImageTarget_(fileInfo, targetDir, stats, batchErrors, 'sado', 'S');

  assert.deepEqual(plain(result), { status: 'copied', fileName: 'sado_1.jpg' });
  assert.deepEqual(events, [
    'inspect:legacy',
    'trash:true',
    'convert',
    'setName:sado_1.jpg',
    'create',
  ]);
  assert.deepEqual(stats, { copiedFiles: 1, skippedFiles: 0, errorFiles: 0 });
  assert.deepEqual(batchErrors, []);
});

test('placeAnaImageTarget_ skips when a valid JPEG already exists', () => {
  const stats = { copiedFiles: 0, skippedFiles: 0, errorFiles: 0 };
  let inspections = 0;
  const valid = {
    getMimeType() { inspections++; return 'image/jpeg'; },
    setTrashed() { assert.fail('valid JPEG must not be trashed'); },
  };
  const result = gas.placeAnaImageTarget_(
    {
      name: 'sado_1.png',
      file: {
        getMimeType() { return 'image/png'; },
        getBlob() { assert.fail('valid existing JPEG must prevent conversion'); },
      },
    },
    {
      getFilesByName() { return createIterator([valid]); },
      createFile() { assert.fail('valid existing JPEG must prevent creation'); },
    },
    stats,
    [],
    'sado',
    'S'
  );

  assert.deepEqual(plain(result), { status: 'skipped', fileName: 'sado_1.jpg' });
  assert.equal(inspections, 1);
  assert.deepEqual(stats, { copiedFiles: 0, skippedFiles: 1, errorFiles: 0 });
});

test('placeAnaImageTarget_ cleans invalid duplicates and skips when any valid JPEG exists', () => {
  const events = [];
  const stats = { copiedFiles: 0, skippedFiles: 0, errorFiles: 0 };
  const invalid = {
    getMimeType() { events.push('inspect:invalid'); return 'image/png'; },
    setTrashed(value) { events.push('trash:' + value); },
  };
  const valid = {
    getMimeType() { events.push('inspect:valid'); return 'image/jpeg'; },
  };
  const result = gas.placeAnaImageTarget_(
    { name: 'sado_1.png', file: { getMimeType() { return 'image/png'; } } },
    {
      getFilesByName() { return createIterator([invalid, valid]); },
      createFile() { assert.fail('valid duplicate must prevent creation'); },
    },
    stats,
    [],
    'sado',
    'S'
  );

  assert.deepEqual(plain(result), { status: 'skipped', fileName: 'sado_1.jpg' });
  assert.deepEqual(events, ['inspect:invalid', 'inspect:valid', 'trash:true']);
  assert.deepEqual(stats, { copiedFiles: 0, skippedFiles: 1, errorFiles: 0 });
});

test('placeAnaImageTarget_ reports a trash failure without copy or skip success', () => {
  const stats = { copiedFiles: 0, skippedFiles: 0, errorFiles: 0 };
  const batchErrors = [];
  const invalid = {
    getMimeType() { return 'image/png'; },
    setTrashed() { throw new Error('trash failed'); },
  };
  const result = gas.placeAnaImageTarget_(
    { name: 'sado_1.png', file: { getMimeType() { return 'image/png'; } } },
    {
      getFilesByName() { return createIterator([invalid]); },
      createFile() { assert.fail('copy must not run after trash failure'); },
    },
    stats,
    batchErrors,
    'sado',
    'S'
  );

  assert.deepEqual(plain(result), { status: 'error', fileName: 'sado_1.jpg' });
  assert.deepEqual(stats, { copiedFiles: 0, skippedFiles: 0, errorFiles: 1 });
  assert.deepEqual(batchErrors, ['sado/sado_1.jpg -> S: trash failed']);
});

test('placeAnaImageInFolder_ counts and reports a conversion failure without counting a copy', () => {
  const stats = { copiedFiles: 0, skippedFiles: 0, errorFiles: 0 };
  const batchErrors = [];
  const fileInfo = {
    name: 'sado_1.png',
    file: {
      getMimeType() { return 'image/png'; },
      getBlob() {
        return {
          getAs() { throw new Error('conversion failed'); },
        };
      },
      getThumbnail() { return null; },
    },
  };
  const targetDir = {
    getFilesByName() {
      return { hasNext() { return false; } };
    },
    createFile() {
      assert.fail('createFile must not run after a conversion error');
    },
  };

  const actual = gas.placeAnaImageInFolder_(
    fileInfo,
    targetDir,
    stats,
    batchErrors,
    'sado',
    'L'
  );

  assert.equal(actual, 'error');
  assert.deepEqual(stats, { copiedFiles: 0, skippedFiles: 0, errorFiles: 1 });
  assert.deepEqual(batchErrors, [
    'sado/sado_1.jpg -> L: JPEG変換用のサムネイルを取得できません: sado_1.jpg',
  ]);
});

test('placeAnaImageInFolder_ counts a MIME lookup failure and continues', () => {
  const stats = { copiedFiles: 0, skippedFiles: 0, errorFiles: 0 };
  const batchErrors = [];
  const fileInfo = {
    name: 'sado_1.png',
    file: {
      getMimeType() { throw new Error('MIME lookup failed'); },
    },
  };

  const actual = gas.placeAnaImageInFolder_(
    fileInfo,
    { getFilesByName() { assert.fail('duplicate lookup must not run'); } },
    stats,
    batchErrors,
    'sado',
    'S'
  );

  assert.equal(actual, 'error');
  assert.deepEqual(stats, { copiedFiles: 0, skippedFiles: 0, errorFiles: 1 });
  assert.deepEqual(batchErrors, ['sado/sado_1.png -> S: MIME lookup failed']);
});

test('placeAnaImageInFolder_ counts duplicate lookup failures from getFilesByName and hasNext', () => {
  ['getFilesByName', 'hasNext'].forEach((failurePoint) => {
    const stats = { copiedFiles: 0, skippedFiles: 0, errorFiles: 0 };
    const batchErrors = [];
    const fileInfo = {
      name: 'sado_1.png',
      file: {
        getMimeType() { return 'image/png'; },
      },
    };
    const targetDir = {
      getFilesByName() {
        if (failurePoint === 'getFilesByName') throw new Error('duplicate lookup failed');
        return {
          hasNext() { throw new Error('duplicate iterator failed'); },
        };
      },
    };

    const actual = gas.placeAnaImageInFolder_(
      fileInfo,
      targetDir,
      stats,
      batchErrors,
      'sado',
      'S'
    );

    const expectedMessage = failurePoint === 'getFilesByName'
      ? 'duplicate lookup failed'
      : 'duplicate iterator failed';
    assert.equal(actual, 'error');
    assert.deepEqual(stats, { copiedFiles: 0, skippedFiles: 0, errorFiles: 1 });
    assert.deepEqual(batchErrors, ['sado/sado_1.jpg -> S: ' + expectedMessage]);
  });
});

test('summarizeAnaImagePlacement_ requires every target to be copied or skipped', () => {
  assert.deepEqual(
    plain(gas.summarizeAnaImagePlacement_(['S', 'L'], { S: 'copied', L: 'skipped' })),
    { complete: true, success: true, failed: false }
  );
  assert.deepEqual(
    plain(gas.summarizeAnaImagePlacement_(['S', 'L'], { S: 'copied', L: 'error' })),
    { complete: true, success: false, failed: true }
  );
  assert.deepEqual(
    plain(gas.summarizeAnaImagePlacement_(['S', 'L'], { S: 'copied' })),
    { complete: false, success: false, failed: false }
  );
  assert.deepEqual(
    plain(gas.summarizeAnaImagePlacement_(['S', 'L'], { S: 'copied', L: 'pending' })),
    { complete: false, success: false, failed: false }
  );
});

test('WebP without a thumbnail clears the image columns and does not mark the row upload-ready', () => {
  const stats = { copiedFiles: 0, skippedFiles: 0, errorFiles: 0 };
  const errors = [];
  const outcomes = {};
  const fileInfo = {
    name: 'sado_1.webp',
    file: {
      getMimeType() { return 'image/webp'; },
      getThumbnail() { return null; },
    },
  };
  const targetDir = {
    getFilesByName() { return { hasNext() { return false; } }; },
    createFile() { assert.fail('an unavailable conversion must not create a file'); },
  };

  ['S', 'L'].forEach((target) => {
    const result = gas.placeAnaImageTarget_(fileInfo, targetDir, stats, errors, 'sado', target);
    gas.recordAnaTargetPlacement_(outcomes, 1, '1', ['S', 'L'], target, result);
  });

  const matchResults = [{
    rowIndex: 1,
    mgmtCode: 'sado',
    files: [{ fileInfo, imageNum: 1 }],
  }];
  const batches = [{ items: matchResults }];
  const decisions = gas.buildAnaPlacementDecisions_(matchResults, batches, outcomes);
  const sheet = createSheet([
    ['備考(内部用)', 'S画像ファイル', 'Ｌ画像ファイル', '出力バッチ'],
    ['sado', 'sado_1.jpg', 'sado_1.jpg', 'upload_ana_001'],
  ]);

  gas.writeAnaPlacementDecisions_(sheet, plain(sheet.data), sheet.data[0], decisions, false);

  assert.deepEqual(sheet.data[1], ['sado', '', '', 'エラー']);
  assert.equal(stats.errorFiles, 2);
});

test('partial _1 placement clears both filename columns and marks the row as an error', () => {
  const matchResults = [{
    rowIndex: 1,
    mgmtCode: 'sado',
    files: [{ fileInfo: { name: 'sado_1.png' }, imageNum: 1 }],
  }];
  const outcomes = {};
  gas.recordAnaTargetPlacement_(outcomes, 1, '1', ['S', 'L'], 'S', {
    status: 'copied', fileName: 'sado_1.jpg',
  });
  gas.recordAnaTargetPlacement_(outcomes, 1, '1', ['S', 'L'], 'L', {
    status: 'error', fileName: 'sado_1.jpg',
  });

  const decisions = gas.buildAnaPlacementDecisions_(matchResults, [{ items: matchResults }], outcomes);

  assert.equal(decisions[0].rowIndex, 1);
  assert.equal(decisions[0].batchValue, 'エラー');
  assert.deepEqual(plain(decisions[0].images['1']), { success: false, fileName: '' });
  assert.deepEqual(
    Object.keys(decisions[0].images).filter((num) => decisions[0].images[num].fileName),
    []
  );
});

test('retry with an existing S target and a successfully copied L target makes _1 upload-ready', () => {
  const matchResults = [{
    rowIndex: 1,
    mgmtCode: 'sado',
    files: [{ fileInfo: { name: 'sado_1.png' }, imageNum: 1 }],
  }];
  const outcomes = {};
  gas.recordAnaTargetPlacement_(outcomes, 1, '1', ['S', 'L'], 'S', {
    status: 'copied', fileName: 'sado_1.jpg',
  });
  gas.recordAnaTargetPlacement_(outcomes, 1, '1', ['S', 'L'], 'L', {
    status: 'error', fileName: 'sado_1.jpg',
  });
  gas.recordAnaTargetPlacement_(outcomes, 1, '1', ['S', 'L'], 'S', {
    status: 'skipped', fileName: 'sado_1.jpg',
  });
  gas.recordAnaTargetPlacement_(outcomes, 1, '1', ['S', 'L'], 'L', {
    status: 'copied', fileName: 'sado_1.jpg',
  });

  const decisions = gas.buildAnaPlacementDecisions_(matchResults, [{ items: matchResults }], outcomes);

  assert.equal(decisions[0].rowIndex, 1);
  assert.equal(decisions[0].batchValue, 'upload_ana_001');
  assert.deepEqual(
    plain(decisions[0].images['1']),
    { success: true, fileName: 'sado_1.jpg' }
  );
  assert.deepEqual(
    Object.keys(decisions[0].images).filter((num) => num !== '1' && decisions[0].images[num].fileName),
    []
  );
});

test('a matched row with only _2 clears stale S/L names and keeps only the successful current image', () => {
  const matchResults = [{
    rowIndex: 1,
    mgmtCode: 'sado',
    files: [{ fileInfo: { name: 'sado_2.png' }, imageNum: 2 }],
  }];
  const outcomes = {};
  gas.recordAnaTargetPlacement_(outcomes, 1, '2', ['1'], '1', {
    status: 'copied', fileName: 'sado_2.jpg',
  });
  const decisions = gas.buildAnaPlacementDecisions_(matchResults, [{ items: matchResults }], outcomes);
  const sheet = createSheet([
    ['備考(内部用)', 'S画像ファイル', 'Ｌ画像ファイル', '１画像ファイル', '出力バッチ'],
    ['sado', 'stale_1.jpg', 'stale_1.jpg', 'stale_2.jpg', 'old'],
  ]);

  gas.writeAnaPlacementDecisions_(sheet, plain(sheet.data), sheet.data[0], decisions, false);

  assert.deepEqual(sheet.data[1], ['sado', '', '', 'sado_2.jpg', 'upload_ana_001']);
});

test('actual-run reset clears stale ANA image names and upload marking from unmatched rows', () => {
  const matchResults = [{
    rowIndex: 1,
    mgmtCode: 'matched',
    files: [{ fileInfo: { name: 'matched_2.jpg' }, imageNum: 2 }],
  }];
  const decisions = gas.buildAnaPlacementDecisions_(matchResults, [{ items: matchResults }], {});
  const sheet = createSheet([
    ['備考(内部用)', 'S画像ファイル', 'Ｌ画像ファイル', '１画像ファイル', '出力バッチ'],
    ['matched', 'old.jpg', 'old.jpg', 'old_2.jpg', 'upload_ana_001'],
    ['unmatched', 'stale.jpg', 'stale.jpg', 'stale_2.jpg', 'upload_ana_001'],
  ]);

  gas.writeAnaPlacementDecisions_(sheet, plain(sheet.data), sheet.data[0], decisions, true);

  assert.deepEqual(sheet.data[1], ['matched', '', '', '', '']);
  assert.deepEqual(sheet.data[2], ['unmatched', '', '', '', '未マッチ']);
});

test('validateAnaJpegCopyPlan_ checks conversion without creating a destination file', () => {
  let thumbnailCalls = 0;
  const result = gas.validateAnaJpegCopyPlan_({
    getThumbnail() {
      thumbnailCalls++;
      return null;
    },
  }, { fileName: 'sado_1.jpg', convert: true }, 'image/webp');

  assert.equal(thumbnailCalls, 1);
  assert.equal(result.success, false);
  assert.match(result.error, /サムネイルを取得できません/);
});

test('getAnaCompletionStatus_ warns when any placement error was counted', () => {
  assert.equal(gas.getAnaCompletionStatus_(0), '✅ 完了');
  assert.equal(gas.getAnaCompletionStatus_(1), '⚠️ 完了（エラーあり）');
});

test('startAnaDistribute queues a clean run without deleting ANA state', () => {
  const deletedProperties = [];
  const setProperties = [];
  const deletedTriggers = [];
  const freshGas = loadGas(['src/Config.js', 'src/Utils.js', 'src/DistributorANA.js'], {
    Logger: { log() {} },
    LockService: {
      getScriptLock() { return { tryLock() { return true; }, releaseLock() {} }; },
    },
    PropertiesService: {
      getScriptProperties() {
        return {
          getProperty() { return null; },
          deleteProperty(key) { deletedProperties.push(key); },
          setProperty(key, value) { setProperties.push([key, value]); },
        };
      },
    },
    SpreadsheetApp: {
      getActiveSpreadsheet() { return { toast() {} }; },
    },
    ScriptApp: {
      getProjectTriggers() { return []; },
      newTrigger(name) {
        return { timeBased() { return this; }, after() { return this; }, create() { return name; } };
      },
    },
  });
  freshGas.deleteTriggersByFunction_ = (name) => deletedTriggers.push(name);

  freshGas.startAnaDistribute('{"batch":1}');

  assert.deepEqual(deletedProperties, []);
  assert.deepEqual(deletedTriggers, []);
  assert.deepEqual(setProperties, [[freshGas.PROP_KEYS.ANA_QUEUE_CONFIG, '{"batch":1}']]);
});

test('startAnaDistribute rejects pending work without destroying resumable state', () => {
  const effects = { deletes: 0, writes: 0, triggerDeletes: 0, triggerCreates: 0, releases: 0, toasts: 0 };
  const freshGas = loadGas(['src/Config.js', 'src/Utils.js', 'src/DistributorANA.js'], {
    Logger: { log() {} },
    LockService: {
      getScriptLock() {
        return {
          tryLock() { return true; },
          releaseLock() { effects.releases++; },
        };
      },
    },
    PropertiesService: {
      getScriptProperties() {
        return {
          getProperty(key) {
            return key === freshGas.PROP_KEYS.ANA_PROGRESS ? '{"batchIndex":1}' : null;
          },
          deleteProperty() { effects.deletes++; },
          setProperty() { effects.writes++; },
        };
      },
    },
    SpreadsheetApp: {
      getActiveSpreadsheet() { return { toast() { effects.toasts++; } }; },
    },
    ScriptApp: {
      getProjectTriggers() { return []; },
      newTrigger() {
        effects.triggerCreates++;
        return { timeBased() { return this; }, after() { return this; }, create() {} };
      },
    },
  });
  freshGas.deleteTriggersByFunction_ = () => { effects.triggerDeletes++; };

  assert.throws(
    () => freshGas.startAnaDistribute('{}'),
    /ANA画像配置が予約または再開待ちです/
  );
  assert.deepEqual(effects, {
    deletes: 0,
    writes: 0,
    triggerDeletes: 0,
    triggerCreates: 0,
    releases: 1,
    toasts: 0,
  });
});

test('queued ANA run is fresh while resume ANA run is the only saved-progress consumer', () => {
  const runModes = [];
  const props = {
    getProperty(key) {
      if (key === gas.PROP_KEYS.ANA_QUEUE_CONFIG) return '{}';
      if (key === gas.PROP_KEYS.ANA_PROGRESS) return '{"batchIndex":2}';
      if (key === gas.PROP_KEYS.ANA_CONFIG) return '{}';
      return null;
    },
    deleteProperty() {},
    setProperty() {},
  };
  const modeGas = loadGas(['src/Config.js', 'src/Utils.js', 'src/DistributorANA.js'], {
    Logger: { log() {} },
    PropertiesService: { getScriptProperties() { return props; } },
    LockService: {
      getScriptLock() { return { tryLock() { return true; }, releaseLock() {} }; },
    },
    ScriptApp: {
      newTrigger() { return { timeBased() { return this; }, after() { return this; }, create() {} }; },
    },
  });
  modeGas.deleteTriggersByFunction_ = () => {};
  modeGas._runAnaDistribute = (_config, _suppressUi, isResume) => runModes.push(isResume);

  modeGas.runQueuedAnaDistribute();
  modeGas.resumeAnaDistribute();

  assert.deepEqual(runModes, [false, true]);
});

test('getAnaPlannedTargetCount_ counts expanded S/L placement targets', () => {
  assert.equal(gas.getAnaPlannedTargetCount_([
    { totalFiles: 3 },
    { totalFiles: 4 },
  ]), 7);
});

test('resolveAnaRunProgress_ ignores stale progress for fresh runs and resumes the next committed batch', () => {
  const props = {
    getProperty() {
      return JSON.stringify({
        batchIndex: 2,
        processedBatches: 2,
        copiedFiles: 3,
        skippedFiles: 1,
        errorFiles: 0,
      });
    },
  };

  assert.deepEqual(
    plain(gas.resolveAnaRunProgress_(props, false)),
    { startBatchIdx: 0, savedProgress: null }
  );
  assert.deepEqual(
    plain(gas.resolveAnaRunProgress_(props, true)),
    {
      startBatchIdx: 2,
      savedProgress: {
        batchIndex: 2,
        processedBatches: 2,
        copiedFiles: 3,
        skippedFiles: 1,
        errorFiles: 0,
      },
    }
  );
});

test('shouldInitializeAnaDashboard_ preserves dashboard rows only for a real resume', () => {
  assert.equal(gas.shouldInitializeAnaDashboard_(true, { batchIndex: 1 }), true);
  assert.equal(gas.shouldInitializeAnaDashboard_(false, null), true);
  assert.equal(gas.shouldInitializeAnaDashboard_(false, { batchIndex: 1 }), false);
});

test('buildAnaProgressCheckpoint_ records only whole-batch committed totals and next index', () => {
  const checkpoint = plain(gas.buildAnaProgressCheckpoint_(1, {
    processedBatches: 1,
    copiedFiles: 2,
    skippedFiles: 1,
    errorFiles: 1,
    transientAttempts: 9,
  }));

  assert.deepEqual(checkpoint, {
    batchIndex: 1,
    processedBatches: 1,
    copiedFiles: 2,
    errorFiles: 1,
    skippedFiles: 1,
  });
  assert.equal(checkpoint.copiedFiles + checkpoint.skippedFiles + checkpoint.errorFiles <= 4, true);
});

test('validateAnaJpegCopyPlan_ does not materialize native blobs or unsupported thumbnails', () => {
  const nativeFile = {
    getBlob() { assert.fail('native conversion must not be materialized during sync'); },
    getThumbnail() { assert.fail('native conversion must not need a thumbnail'); },
  };
  const unsupportedFile = {
    getThumbnail() {
      return {
        getContentType() { assert.fail('sync only needs thumbnail availability'); },
        getAs() { assert.fail('sync must not convert the thumbnail'); },
      };
    },
  };

  assert.equal(gas.validateAnaJpegCopyPlan_(
    nativeFile,
    { fileName: 'native.jpg', convert: true },
    'image/png'
  ).success, true);
  assert.equal(gas.validateAnaJpegCopyPlan_(
    unsupportedFile,
    { fileName: 'unsupported.jpg', convert: true },
    'image/webp'
  ).success, true);
});

test('syncAnaImageFilenamesToSheet_ clears stale values/backgrounds and batch-writes direct matches', () => {
  const headers = [
    '備考(内部用)',
    'S画像ファイル', 'Ｌ画像ファイル',
    '１画像ファイル', '２画像ファイル', '３画像ファイル', '４画像ファイル', '５画像ファイル',
    'D9画像ファイル', 'D10画像ファイル',
  ];
  const sheet = createSheet([
    headers,
    ['SADO', 'stale.jpg', 'stale.jpg', 'stale_2.jpg', '', '', '', '', '', ''],
    ['removed', 'removed.jpg', 'removed.jpg', 'removed_2.jpg', '', '', '', '', '', ''],
  ]);
  const fileMap = {
    'sado_2.png': {
      name: 'SADO_2.PNG',
      file: {
        getMimeType() { return 'image/png'; },
        getBlob() { assert.fail('sync must not materialize PNG conversion'); },
      },
    },
  };

  const result = gas.syncAnaImageFilenamesToSheet_(sheet, fileMap);

  assert.deepEqual(sheet.data[1], ['SADO', '', '', 'SADO_2.jpg', '', '', '', '', '', '']);
  assert.deepEqual(sheet.data[2], ['removed', '', '', '', '', '', '', '', '', '']);
  assert.equal(result.updated, 1);
  assert.equal(result.unmatched, 1);
  const imageWrites = sheet.writeCalls.filter((call) => call.row === 2);
  assert.equal(imageWrites.length, 9);
  assert.equal(imageWrites.every((call) => call.numRows === 2), true);
  assert.equal(sheet.backgroundCalls.some((call) => call.value === null), true);
});

test('syncAnaImageFilenamesToSheet_ rejects missing ANA image columns instead of silently skipping them', () => {
  const sheet = createSheet([
    ['備考(内部用)', 'S画像ファイル', 'Ｌ画像ファイル', 'D9画像ファイル', 'D10画像ファイル'],
    ['SADO', '', '', '', ''],
  ]);

  assert.throws(
    () => gas.syncAnaImageFilenamesToSheet_(sheet, {}),
    /ANA必須カラム不足: １画像ファイル, ２画像ファイル, ３画像ファイル, ４画像ファイル, ５画像ファイル/
  );
});

test('writeAnaPlacementDecisions_ writes only bounded current-batch row ranges', () => {
  const sheet = createSheet([
    ['備考(内部用)', 'S画像ファイル', 'Ｌ画像ファイル', '１画像ファイル', '出力バッチ'],
    ['old-1', 'keep.jpg', 'keep.jpg', '', 'upload_ana_001'],
    ['current-1', 'stale.jpg', 'stale.jpg', '', 'old'],
    ['current-2', 'stale.jpg', 'stale.jpg', '', 'old'],
    ['old-2', 'keep.jpg', 'keep.jpg', '', 'upload_ana_003'],
  ]);
  const matchResults = [
    { rowIndex: 2, files: [{ imageNum: 2 }] },
    { rowIndex: 3, files: [{ imageNum: 2 }] },
  ];
  const outcomes = {};
  [2, 3].forEach((rowIndex) => {
    gas.recordAnaTargetPlacement_(outcomes, rowIndex, '2', ['1'], '1', {
      status: 'copied', fileName: 'row_' + rowIndex + '.jpg',
    });
  });
  const decisions = gas.buildAnaPlacementDecisions_(matchResults, [{ items: matchResults }], outcomes);
  sheet.writeCalls.length = 0;

  gas.writeAnaPlacementDecisions_(sheet, plain(sheet.data), sheet.data[0], decisions, false);

  assert.equal(sheet.writeCalls.every((call) => call.row === 3 && call.numRows === 2), true);
  assert.deepEqual(sheet.data[1], ['old-1', 'keep.jpg', 'keep.jpg', '', 'upload_ana_001']);
  assert.deepEqual(sheet.data[4], ['old-2', 'keep.jpg', 'keep.jpg', '', 'upload_ana_003']);
});

test('_splitIntoAnaBatches caps target copies per batch while keeping products atomic', () => {
  const items = Array.from({ length: 101 }, (_, index) => ({
    rowIndex: index + 1,
    files: [{ imageNum: 2, fileInfo: { size: 1 } }],
  }));

  const batches = plain(gas._splitIntoAnaBatches(items, 1000));

  assert.deepEqual(batches.map((batch) => batch.totalFiles), [100, 1]);
  assert.deepEqual(batches.map((batch) => batch.items.length), [100, 1]);

  const oversizedProduct = {
    rowIndex: 200,
    files: Array.from({ length: 101 }, () => ({ imageNum: 2, fileInfo: { size: 1 } })),
  };
  const atomic = plain(gas._splitIntoAnaBatches([oversizedProduct], 1000));
  assert.equal(atomic.length, 1);
  assert.equal(atomic[0].items.length, 1);
  assert.equal(atomic[0].totalFiles, 101);
});

test('buildAnaSourceIndex_ matches exact case-insensitive management code and image number', () => {
  const exact = { name: 'AbC_1.JPG' };
  const second = { name: 'abc_2.png' };
  const collision = { name: 'abc2_1.jpg' };
  const index = gas.buildAnaSourceIndex_({ exact, second, collision });

  assert.equal(index.abc['1'], exact);
  assert.equal(index.abc['2'], second);
  assert.equal(index.abc2['1'], collision);
  assert.equal(index.abc['12'], undefined);
});

test('pauseAnaBeforeBatchIfNeeded_ schedules resume at current batch before any batch write', () => {
  const events = [];
  const pauseGas = loadGas(['src/Config.js', 'src/Utils.js', 'src/DistributorANA.js'], {
    Logger: { log() {} },
    ScriptApp: {
      getProjectTriggers() { return []; },
      newTrigger(name) {
        events.push('trigger:' + name);
        return { timeBased() { return this; }, after() { return this; }, create() { return this; } };
      },
    },
  });
  pauseGas.updateAnaDashboardStatus_ = (status) => events.push('status:' + status);
  pauseGas._updateAnaStats = () => events.push('stats');
  const props = {
    setProperty(key, value) { events.push(['set', key, JSON.parse(value)]); },
  };

  const paused = pauseGas.pauseAnaBeforeBatchIfNeeded_(
    0,
    pauseGas.EXEC_CONFIG.TIME_LIMIT_MS + 1,
    2,
    { processedBatches: 2, copiedFiles: 3, skippedFiles: 1, errorFiles: 0 },
    { mode: 'actual' },
    props,
    { toast() { events.push('toast'); } }
  );

  assert.equal(paused, true);
  assert.equal(events.some((event) => event === 'batch-write'), false);
  const progressEvent = events.find((event) => Array.isArray(event) && event[1] === pauseGas.PROP_KEYS.ANA_PROGRESS);
  assert.equal(progressEvent[2].batchIndex, 2);
  assert.equal(events.includes('trigger:resumeAnaDistribute'), true);
});

test('commitAnaCompletedBatchCheckpoint_ flushes outcome writes before advancing checkpoint', () => {
  const events = [];
  const commitGas = loadGas(['src/Config.js', 'src/Utils.js', 'src/DistributorANA.js'], {
    Logger: { log() {} },
    SpreadsheetApp: { flush() { events.push('flush'); } },
  });
  const props = {
    setProperty(key, value) {
      events.push(['checkpoint', key, JSON.parse(value)]);
    },
  };

  commitGas.commitAnaCompletedBatchCheckpoint_(props, 3, {
    processedBatches: 3,
    copiedFiles: 5,
    skippedFiles: 1,
    errorFiles: 0,
  });

  assert.equal(events[0], 'flush');
  assert.equal(events[1][0], 'checkpoint');
  assert.equal(events[1][2].batchIndex, 3);
});

test('runWithAnaPublicGuard_ rejects lock failure and pending work without running mutations', () => {
  const buildGuardGas = ({ lockResult, pendingValue = null, triggers = [] }) => {
    let releases = 0;
    const guardGas = loadGas(['src/Config.js', 'src/Utils.js', 'src/DistributorANA.js'], {
      Logger: { log() {} },
      LockService: {
        getScriptLock() {
          return {
            tryLock() { return lockResult; },
            releaseLock() { releases++; },
          };
        },
      },
      PropertiesService: {
        getScriptProperties() { return { getProperty() { return pendingValue; } }; },
      },
      ScriptApp: { getProjectTriggers() { return triggers; } },
    });
    return { guardGas, releases: () => releases };
  };

  let mutations = 0;
  const locked = buildGuardGas({ lockResult: false });
  assert.throws(() => locked.guardGas.runWithAnaPublicGuard_(() => mutations++), /実行中/);
  assert.equal(mutations, 0);
  assert.equal(locked.releases(), 0);

  const pending = buildGuardGas({ lockResult: true, pendingValue: '{}' });
  assert.throws(() => pending.guardGas.runWithAnaPublicGuard_(() => mutations++), /予約または再開待ち/);
  assert.equal(mutations, 0);
  assert.equal(pending.releases(), 1);
});

test('runWithAnaPublicGuard_ always releases the lock when the guarded operation throws', () => {
  let releases = 0;
  const guardGas = loadGas(['src/Config.js', 'src/Utils.js', 'src/DistributorANA.js'], {
    Logger: { log() {} },
    LockService: {
      getScriptLock() {
        return { tryLock() { return true; }, releaseLock() { releases++; } };
      },
    },
    PropertiesService: {
      getScriptProperties() { return { getProperty() { return null; } }; },
    },
    ScriptApp: { getProjectTriggers() { return []; } },
  });

  assert.throws(
    () => guardGas.runWithAnaPublicGuard_(() => { throw new Error('operation failed'); }),
    /operation failed/
  );
  assert.equal(releases, 1);
});

function createAnaPublicUiGas(events, options = {}) {
  let alertCount = 0;
  const publicGas = loadGas(['src/Config.js', 'src/Utils.js', 'src/DistributorANA.js'], {
    Logger: { log() {} },
    SpreadsheetApp: {
      getUi() {
        return {
          Button: { YES: 'YES' },
          ButtonSet: { YES_NO: 'YES_NO', OK: 'OK' },
          alert(title) {
            alertCount++;
            if (alertCount === 1 && title === '画像ファイル名転記（ANA）') {
              events.push('confirmation');
              return 'YES';
            }
            events.push('alert:' + title);
            return 'OK';
          },
        };
      },
    },
    LockService: {
      getScriptLock() {
        return {
          tryLock() { events.push('lock'); return true; },
          releaseLock() { events.push('release'); },
        };
      },
    },
    PropertiesService: {
      getScriptProperties() {
        return {
          getProperty() {
            events.push('pending-check');
            return options.pending ? '{}' : null;
          },
        };
      },
    },
    ScriptApp: { getProjectTriggers() { return []; } },
  });
  return publicGas;
}

test('syncAnaImageFilenames orders confirmation before lock and result alert after release', () => {
  const events = [];
  const publicGas = createAnaPublicUiGas(events);
  publicGas._syncAnaImageFilenamesLocked_ = () => {
    events.push('mutation');
    return { title: '実行結果', message: 'done' };
  };

  publicGas.syncAnaImageFilenames();

  assert.equal(events[0], 'confirmation');
  assert.equal(events[1], 'lock');
  assert.equal(events.indexOf('pending-check') < events.indexOf('mutation'), true);
  assert.equal(events.indexOf('mutation') < events.indexOf('release'), true);
  assert.equal(events.indexOf('release') < events.indexOf('alert:実行結果'), true);
});

test('syncAnaImageFilenames rejects pending work introduced after confirmation before mutation', () => {
  const events = [];
  const publicGas = createAnaPublicUiGas(events, { pending: true });
  publicGas._syncAnaImageFilenamesLocked_ = () => events.push('mutation');

  publicGas.syncAnaImageFilenames();

  assert.equal(events[0], 'confirmation');
  assert.equal(events.includes('mutation'), false);
  assert.equal(events.indexOf('release') < events.indexOf('alert:エラー'), true);
});

test('syncAnaImageFilenames releases lock before showing a thrown-core error', () => {
  const events = [];
  const publicGas = createAnaPublicUiGas(events);
  publicGas._syncAnaImageFilenamesLocked_ = () => {
    events.push('mutation');
    throw new Error('core failed');
  };

  publicGas.syncAnaImageFilenames();

  assert.equal(events.indexOf('mutation') < events.indexOf('release'), true);
  assert.equal(events.indexOf('release') < events.indexOf('alert:エラー'), true);
});

test('startAnaDryRun suppresses locked UI and alerts only after lock release', () => {
  const events = [];
  const dryGas = createAnaPublicUiGas(events);
  dryGas._runAnaDistribute = (_config, suppressUi) => {
    events.push('mutation:suppress=' + suppressUi);
    return { title: 'ドライラン完了', message: 'dry done' };
  };

  dryGas.startAnaDryRun('{}');

  assert.equal(events[0], 'lock');
  assert.equal(events.includes('mutation:suppress=true'), true);
  assert.equal(events.indexOf('release') < events.indexOf('alert:ドライラン完了'), true);
});

test('startAnaDryRun releases lock before showing a core error', () => {
  const events = [];
  const dryGas = createAnaPublicUiGas(events);
  dryGas._runAnaDistribute = () => { throw new Error('dry failed'); };

  dryGas.startAnaDryRun('{}');

  assert.equal(events.indexOf('release') < events.indexOf('alert:エラー'), true);
});

test('_writeBackAnaBatchMarkings reuses an existing exact output-batch column', () => {
  const sheet = createSheet([
    ['備考(内部用)', '出力バッチ', '任意列'],
    ['sado-1', 'old', 'keep'],
    ['sado-2', 'old', 'keep'],
  ]);
  const data = plain(sheet.data);
  const batches = [{ items: [{ rowIndex: 1 }] }];

  gas._writeBackAnaBatchMarkings(sheet, data, data[0], 0, batches);
  gas._writeBackAnaBatchMarkings(sheet, data, data[0], 0, batches);

  assert.deepEqual(sheet.data, [
    ['備考(内部用)', '出力バッチ', '任意列'],
    ['sado-1', 'upload_ana_001', 'keep'],
    ['sado-2', '未マッチ', 'keep'],
  ]);
  assert.equal(sheet.data[0].length, 3);
});

test('_writeBackAnaBatchMarkings appends the output-batch column only once when absent', () => {
  const sheet = createSheet([
    ['備考(内部用)', '任意列'],
    ['sado-1', 'keep'],
    ['sado-2', 'keep'],
  ]);
  const staleData = plain(sheet.data);
  const staleHeaders = staleData[0].slice();
  const batches = [{ items: [{ rowIndex: 2 }] }];

  gas._writeBackAnaBatchMarkings(sheet, staleData, staleHeaders, 0, batches);
  gas._writeBackAnaBatchMarkings(sheet, staleData, staleHeaders, 0, batches);

  assert.deepEqual(sheet.data, [
    ['備考(内部用)', '任意列', '出力バッチ'],
    ['sado-1', 'keep', '未マッチ'],
    ['sado-2', 'keep', 'upload_ana_001'],
  ]);
  assert.equal(sheet.data[0].length, 3);
});

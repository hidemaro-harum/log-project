const test = require('node:test');
const assert = require('node:assert/strict');
const { loadGas } = require('./load-gas');

function columnFromA1(a1) {
  const match = String(a1).match(/:([A-Z]+)\d+$/) || String(a1).match(/^([A-Z]+)\d+$/);
  return match[1].split('').reduce((value, char) => value * 26 + char.charCodeAt(0) - 64, 0);
}

function createBoundedSheet(name, initialColumns = 26, events = []) {
  let maxColumns = initialColumns;
  const values = [];

  function ensureRow(row) {
    while (values.length < row) values.push([]);
  }

  return {
    name,
    events,
    getMaxColumns() {
      events.push(['getMaxColumns', name, maxColumns]);
      return maxColumns;
    },
    insertColumnsAfter(afterPosition, howMany) {
      events.push(['insertColumnsAfter', name, afterPosition, howMany]);
      assert.equal(afterPosition, maxColumns);
      assert.ok(howMany > 0);
      maxColumns += howMany;
    },
    deleteRow(row) {
      events.push(['deleteRow', name, row]);
      values.splice(row - 1, 1);
    },
    getMaxRows() { return 1000; },
    getLastRow() { return values.length; },
    getLastColumn() {
      return values.reduce((max, row) => Math.max(max, row.length), 0);
    },
    getDataRange() {
      return this.getRange(1, 1, Math.max(values.length, 1), Math.max(maxColumns, 1));
    },
    getRange(rowOrA1, column, numRows = 1, numColumns = 1) {
      const lastColumn = typeof rowOrA1 === 'string'
        ? columnFromA1(rowOrA1)
        : column + numColumns - 1;
      events.push(['getRange', name, lastColumn]);
      if (lastColumn > maxColumns) {
        throw new RangeError(name + ': requested column ' + lastColumn + ', max ' + maxColumns);
      }
      const row = typeof rowOrA1 === 'number' ? rowOrA1 : 1;
      const startColumn = typeof rowOrA1 === 'number' ? column : 1;
      const range = {
        getValues() {
          return Array.from({ length: numRows }, (_, rowOffset) =>
            Array.from({ length: numColumns }, (_, columnOffset) =>
              values[row - 1 + rowOffset]?.[startColumn - 1 + columnOffset] ?? ''
            )
          );
        },
        setValue(value) {
          events.push(['setValue', name, lastColumn]);
          ensureRow(row);
          values[row - 1][startColumn - 1] = value;
          return range;
        },
        setValues(rows) {
          events.push(['setValues', name, lastColumn]);
          rows.forEach((sourceRow, rowOffset) => {
            ensureRow(row + rowOffset);
            sourceRow.forEach((value, columnOffset) => {
              values[row - 1 + rowOffset][startColumn - 1 + columnOffset] = value;
            });
          });
          return range;
        },
        setBackground() { return range; },
        setBorder() { return range; },
        setFontColor() { return range; },
        setFontSize() { return range; },
        setFontStyle() { return range; },
        setFontWeight() { return range; },
        setNumberFormat() { return range; },
      };
      return range;
    },
    activate() {},
    setColumnWidth() {},
    setFrozenRows() {},
  };
}

function createSetupHarness(defaultColumns = 26) {
  const events = [];
  const sheets = {};
  const spreadsheet = {
    getSheetByName(name) { return sheets[name] || null; },
    insertSheet(name) {
      events.push(['insertSheet', name]);
      sheets[name] = createBoundedSheet(name, defaultColumns, events);
      return sheets[name];
    },
    deleteSheet(sheet) { delete sheets[sheet.name]; },
  };
  const ui = {
    ButtonSet: { OK: 'OK' },
    alert() {},
  };
  const gas = loadGas([
    'src/Config.js',
    'src/DistributorANA.js',
    'src/DistributorRakuten.js',
    'src/Menu.js',
  ], {
    SpreadsheetApp: {
      getActiveSpreadsheet() { return spreadsheet; },
      getUi() { return ui; },
    },
  });
  return { gas, sheets, events };
}

test('ensureSheetColumnCapacity_ inserts only the exact missing columns', () => {
  const gas = loadGas(['src/Config.js', 'src/Menu.js']);
  const events = [];
  const sheet = createBoundedSheet('bounded', 26, events);

  const actual = gas.ensureSheetColumnCapacity_(sheet, 100);

  assert.equal(actual, sheet);
  assert.deepEqual(events, [
    ['getMaxColumns', 'bounded', 26],
    ['insertColumnsAfter', 'bounded', 26, 74],
  ]);
});

test('ensureSheetColumnCapacity_ does not insert when capacity is sufficient', () => {
  const gas = loadGas(['src/Config.js', 'src/Menu.js']);
  const events = [];
  const sheet = createBoundedSheet('sufficient', 100, events);

  assert.equal(gas.ensureSheetColumnCapacity_(sheet, 100), sheet);
  assert.deepEqual(events, [['getMaxColumns', 'sufficient', 100]]);
});

test('ensureSheetColumnCapacity_ rejects a non-positive or fractional column count', () => {
  const gas = loadGas(['src/Config.js', 'src/Menu.js']);
  const sheet = createBoundedSheet('invalid');

  for (const requiredColumns of [0, -1, 1.5, NaN]) {
    assert.throws(
      () => gas.ensureSheetColumnCapacity_(sheet, requiredColumns),
      { message: 'requiredColumns must be a positive integer' }
    );
  }
});

test('setupInitialSettings_ replaces the obsolete Rakuten batch setting with Choice 70MB', () => {
  const { gas, sheets, events } = createSetupHarness(26);
  sheets.setting = createBoundedSheet('setting', 26, events);
  sheets.setting.getRange(1, 1, 7, 3).setValues([
    ['title', '', ''],
    ['', '', ''],
    ['', '', ''],
    ['設定項目', '値', '説明'],
    ['統合先フォルダURL', 'keep-folder', 'keep'],
    ['楽天画像バッチサイズ(MB)', '80', 'obsolete'],
    ['通知先メールアドレス', 'keep@example.com', 'keep'],
  ]);
  events.length = 0;

  gas.setupInitialSettings_(false);

  const rows = sheets.setting.getRange(1, 1, sheets.setting.getLastRow(), 3).getValues();
  assert.equal(rows.some((row) => row[0] === '楽天画像バッチサイズ(MB)'), false);
  assert.deepEqual(rows.find((row) => row[0] === 'Choiceバッチサイズ(MB)'), [
    'Choiceバッチサイズ(MB)', '70', 'Choice画像の1バッチあたりの容量制限（1〜80MB）',
  ]);
  assert.deepEqual(rows.find((row) => row[0] === '統合先フォルダURL').slice(0, 2), [
    '統合先フォルダURL', 'keep-folder',
  ]);
  assert.deepEqual(rows.find((row) => row[0] === '通知先メールアドレス').slice(0, 2), [
    '通知先メールアドレス', 'keep@example.com',
  ]);
  assert.deepEqual(rows.find((row) => row[0] === '差分画像保存先フォルダURL'), [
    '差分画像保存先フォルダURL', '', '統合先にない新規画像だけを保存するGoogle DriveフォルダURL',
  ]);
  assert.deepEqual(rows.find((row) => row[0] === '楽天画像変換元フォルダURL').slice(0, 2), [
    '楽天画像変換元フォルダURL', '',
  ]);
  assert.deepEqual(rows.find((row) => row[0] === '楽天画像変換先フォルダURL').slice(0, 2), [
    '楽天画像変換先フォルダURL', '',
  ]);
  assert.equal(events.filter((event) => event[0] === 'deleteRow').length, 1);
});

test('setupInitialSettings_ expands bounded ANA and Rakuten sheets before range access', () => {
  const { gas, sheets, events } = createSetupHarness(26);

  assert.doesNotThrow(() => gas.setupInitialSettings_(false));

  const expectedColumns = {
    ana_csv: gas.getAnaCsvHeaders().length,
    rakuten_csv: gas.getRakutenCsvHeaders().length,
  };
  for (const [name, requiredColumns] of Object.entries(expectedColumns)) {
    const relevantEvents = events.filter((event) => event[1] === name);
    assert.deepEqual(relevantEvents.slice(0, 3), [
      ['insertSheet', name],
      ['getMaxColumns', name, 26],
      ['insertColumnsAfter', name, 26, requiredColumns - 26],
    ]);
    assert.equal(sheets[name].getMaxColumns(), requiredColumns);
    assert.ok(relevantEvents.findIndex((event) => event[0] === 'insertColumnsAfter') <
      relevantEvents.findIndex((event) => event[0] === 'getRange'));
  }
});

test('setupInitialSettings_ expands 20-column Rakuten image helper sheets by one before writing headers', () => {
  const { gas, sheets, events } = createSetupHarness(20);

  assert.doesNotThrow(() => gas.setupInitialSettings_(false));

  for (const name of ['rakuten_image_grid', 'rakuten_image_paths']) {
    const relevantEvents = events.filter((event) => event[1] === name);
    assert.deepEqual(relevantEvents.slice(0, 5), [
      ['insertSheet', name],
      ['getMaxColumns', name, 20],
      ['insertColumnsAfter', name, 20, 1],
      ['getRange', name, 21],
      ['setValues', name, 21],
    ]);
    assert.equal(sheets[name].getMaxColumns(), 21);
  }
});

test('setupInitialSettings_ preserves existing Rakuten image helper sheets and their column counts', () => {
  const { gas, sheets, events } = createSetupHarness(26);
  const existingRows = {
    rakuten_image_grid: ['existing-grid', 'keep-grid'],
    rakuten_image_paths: ['existing-paths', 'keep-paths'],
  };
  for (const [name, row] of Object.entries(existingRows)) {
    sheets[name] = createBoundedSheet(name, 20, events);
    sheets[name].getRange(1, 1, 1, row.length).setValues([row]);
  }
  events.length = 0;

  assert.doesNotThrow(() => gas.setupInitialSettings_(false));

  for (const [name, row] of Object.entries(existingRows)) {
    assert.deepEqual(
      events.filter((event) => event[1] === name && ['insertColumnsAfter', 'setValue', 'setValues'].includes(event[0])),
      []
    );
    assert.equal(sheets[name].getMaxColumns(), 20);
    assert.deepEqual(sheets[name].getRange(1, 1, 1, row.length).getValues(), [row]);
  }
});

test('setupInitialSettings_ repairs existing blank portal sheets without replacing them', () => {
  const { gas, sheets, events } = createSetupHarness(26);
  sheets.ana_csv = createBoundedSheet('ana_csv', 26, events);
  sheets.rakuten_csv = createBoundedSheet('rakuten_csv', 26, events);
  sheets.rakuten_image_grid = createBoundedSheet('rakuten_image_grid', 20, events);
  sheets.rakuten_image_paths = createBoundedSheet('rakuten_image_paths', 20, events);

  assert.doesNotThrow(() => gas.setupInitialSettings_(false));

  const expectedHeaders = {
    ana_csv: gas.getAnaCsvHeaders(),
    rakuten_csv: gas.getRakutenCsvHeaders(),
    rakuten_image_grid: gas.getRakutenImageSlotHeaders_('URL'),
    rakuten_image_paths: gas.getRakutenImageSlotHeaders_('Path'),
  };
  for (const [name, headers] of Object.entries(expectedHeaders)) {
    const relevantEvents = events.filter((event) => event[1] === name);
    assert.equal(relevantEvents.some((event) => event[0] === 'insertSheet'), false);
    assert.equal(sheets[name].getMaxColumns(), headers.length);
    assert.deepEqual(
      JSON.parse(JSON.stringify(sheets[name].getRange(1, 1, 1, headers.length).getValues())),
      [JSON.parse(JSON.stringify(headers))]
    );
    assert.ok(relevantEvents.findIndex((event) => event[0] === 'insertColumnsAfter') <
      relevantEvents.findIndex((event) => event[0] === 'setValues'));
  }
});

test('setupInitialSettings_ repairs a header-only ANA sheet when the existing cells are an exact prefix', () => {
  const { gas, sheets, events } = createSetupHarness(26);
  sheets.ana_csv = createBoundedSheet('ana_csv', 26, events);
  const expectedHeaders = JSON.parse(JSON.stringify(gas.getAnaCsvHeaders()));
  sheets.ana_csv.getRange(1, 1, 1, 2).setValues([[expectedHeaders[0], expectedHeaders[1]]]);
  events.length = 0;

  assert.doesNotThrow(() => gas.setupInitialSettings_(false));

  assert.equal(sheets.ana_csv.getMaxColumns(), expectedHeaders.length);
  assert.deepEqual(
    sheets.ana_csv.getRange(1, 1, 1, expectedHeaders.length).getValues(),
    [expectedHeaders]
  );
});

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadGas } = require('./load-gas');

const gas = loadGas(['src/Config.js', 'src/DistributorRakuten.js']);

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function createSheet(values, writes, batchWrites, beforeSetValue, beforeSetValues, formulas) {
  const data = values.map((row) => row.slice());
  const formulaData = (formulas || []).map((row) => row.slice());
  return {
    getLastRow() {
      return data.length;
    },
    getLastColumn() {
      return data.reduce((max, row) => Math.max(max, row.length), 0);
    },
    getDataRange() {
      return this.getRange(1, 1, data.length, this.getLastColumn());
    },
    getRange(row, column, numRows = 1, numColumns = 1) {
      return {
        getValues() {
          return data.slice(row - 1, row - 1 + numRows).map((sourceRow) =>
            Array.from({ length: numColumns }, (_, offset) => sourceRow[column - 1 + offset] ?? '')
          );
        },
        getFormulas() {
          return Array.from({ length: numRows }, (_, rowOffset) => {
            const sourceRow = formulaData[row - 1 + rowOffset] || [];
            return Array.from({ length: numColumns }, (_, offset) => sourceRow[column - 1 + offset] ?? '');
          });
        },
        setValue(value) {
          if (beforeSetValue) beforeSetValue({ row, column, value });
          if (writes) writes.push({ row, column, value });
          if (!data[row - 1]) data[row - 1] = [];
          data[row - 1][column - 1] = value;
          return this;
        },
        setValues(rows) {
          if (beforeSetValues) beforeSetValues({ row, column, numRows, numColumns, values: plain(rows) });
          if (batchWrites) batchWrites.push({ row, column, numRows, numColumns, values: plain(rows) });
          rows.forEach((sourceRow, rowOffset) => {
            if (!data[row - 1 + rowOffset]) data[row - 1 + rowOffset] = [];
            if (!formulaData[row - 1 + rowOffset]) formulaData[row - 1 + rowOffset] = [];
            sourceRow.forEach((value, columnOffset) => {
              data[row - 1 + rowOffset][column - 1 + columnOffset] = value;
              formulaData[row - 1 + rowOffset][column - 1 + columnOffset] =
                typeof value === 'string' && value.startsWith('=') ? value : '';
            });
          });
          return this;
        },
      };
    },
  };
}

function createSpreadsheet(sheets) {
  return {
    getSheetByName(name) {
      return sheets[name] || null;
    },
    insertSheet(name) {
      const sheet = createSheet([]);
      sheets[name] = sheet;
      return sheet;
    },
  };
}

function runInjectionWithSheets(sheets, previewMode = false, alerts) {
  const harness = loadGas(['src/Config.js', 'src/DistributorRakuten.js'], {
    SpreadsheetApp: {
      getUi() {
        return {
          alert(...args) {
            if (alerts) alerts.push(args);
          },
          ButtonSet: { OK: 'OK' },
        };
      },
      getActiveSpreadsheet() {
        return createSpreadsheet(sheets);
      },
      flush() {},
    },
    Utilities: {
      formatDate() {
        return '2026-06-19 12:00:00';
      },
    },
    Logger: { log() {} },
  });

  harness.runTemplateInjection_(previewMode);
  return harness;
}

test('buildFullChoiceMapFromValues_ maps exact Choice headers by management code', () => {
  const headers = ['管理コード', '（必須）お礼の品名'];
  const rows = [['sado-1', '品名｜補足']];

  const actual = gas.buildFullChoiceMapFromValues_(headers, rows);

  assert.deepEqual(plain(actual), {
    'sado-1': {
      '管理コード': 'sado-1',
      '（必須）お礼の品名': '品名｜補足',
    },
  });
  assert.deepEqual(headers, ['管理コード', '（必須）お礼の品名']);
  assert.deepEqual(rows, [['sado-1', '品名｜補足']]);
});

test('buildFullChoiceMapFromValues_ uses the last duplicate row', () => {
  const actual = gas.buildFullChoiceMapFromValues_(
    ['管理コード', '説明'],
    [['sado-1', '旧説明'], ['sado-1', '新説明']]
  );

  assert.equal(actual['sado-1']['説明'], '新説明');
});

test('buildFullChoiceMapFromValues_ throws when the exact management-code header is missing', () => {
  assert.throws(
    () => gas.buildFullChoiceMapFromValues_(['管理コード（旧）', '説明'], [['sado-1', '説明']]),
    { message: '必須ヘッダー不足: 管理コード' }
  );
});

test('renderRakutenTemplate_ renders Choice and virtual fields and reports empty fields', () => {
  const template = [
    '{{（必須）お礼の品名}}',
    '{{お礼の品名}}',
    '{{配送温度帯}}',
    '{{説明}}',
    '{{空欄}}',
    '{{存在しない}}',
  ].join('|');
  const choiceData = {
    '（必須）お礼の品名': '佐渡米｜定期便',
    'お礼の品名': '朱鷺米|補足',
    '（必須）常温配送': 1,
    '（必須）冷蔵配送': '0',
    '（必須）冷凍配送': '1',
    '説明': '一行目\r\n二行目\n三行目',
    '空欄': '  ',
  };

  const actual = gas.renderRakutenTemplate_(template, choiceData);

  assert.equal(
    actual.html,
    '佐渡米|朱鷺米|補足|常温配送、冷凍配送|一行目<br>二行目<br>三行目|-|-'
  );
  assert.deepEqual(plain(actual.warnings), ['空欄', '存在しない']);
});

test('renderRakutenTemplate_ warns when delivery type is empty, zero, or missing', () => {
  const cases = [
    {
      '（必須）常温配送': '',
      '（必須）冷蔵配送': '',
      '（必須）冷凍配送': '',
    },
    {
      '（必須）常温配送': 0,
      '（必須）冷蔵配送': '0',
      '（必須）冷凍配送': 0,
    },
    {},
  ];

  for (const choiceData of cases) {
    const actual = gas.renderRakutenTemplate_('{{配送温度帯}}', choiceData);
    assert.equal(actual.html, '-');
    assert.deepEqual(plain(actual.warnings), ['配送温度帯']);
  }
});

test('isRakutenCellValueWithinLimit_ accepts 50000 characters and rejects 50001', () => {
  assert.equal(typeof gas.isRakutenCellValueWithinLimit_, 'function');
  assert.equal(gas.isRakutenCellValueWithinLimit_('x'.repeat(50000)), true);
  assert.equal(gas.isRakutenCellValueWithinLimit_('x'.repeat(50001)), false);
});

test('findRakutenImageColumns_ returns 1-indexed type, path and ALT columns', () => {
  assert.deepEqual(
    plain(gas.findRakutenImageColumns_(['商品画像タイプ1', '商品画像パス1', '商品画像名（ALT）1'], 1)),
    [{ type: 1, path: 2, alt: 3 }]
  );
});

test('findRakutenImageColumns_ uses exact headers across unrelated columns and reports missing cells as null', () => {
  const headers = [
    '商品画像名（ALT）2',
    '商品画像タイプ1（旧）',
    '商品画像タイプ1',
    '無関係列',
    '商品画像パス1',
    '商品画像名（ALT）1',
    '商品画像タイプ2',
  ];

  assert.deepEqual(plain(gas.findRakutenImageColumns_(headers, 2)), [
    { type: 3, path: 5, alt: 6 },
    { type: 7, path: null, alt: 1 },
  ]);
});

test('findRakutenImageColumns_ rejects duplicate exact image headers', () => {
  assert.throws(
    () => gas.findRakutenImageColumns_([
      '商品画像タイプ1',
      '商品画像パス1',
      '商品画像パス1',
      '商品画像名（ALT）1',
    ], 1),
    { message: '楽天画像ヘッダーが重複しています: 商品画像パス1' }
  );
});

test('ensureRakutenLogSheet_ creates a missing sheet with exact headers', () => {
  const sheets = {};
  const ss = createSpreadsheet(sheets);

  const actual = gas.ensureRakutenLogSheet_(ss);

  assert.equal(actual, sheets.rakuten_dashboard);
  assert.deepEqual(plain(actual.getRange(1, 1, 1, 5).getValues()), [
    ['実行日時', '楽天行番号', '管理コード', '内容', '種別'],
  ]);
});

test('ensureRakutenLogSheet_ initializes an existing blank sheet', () => {
  const sheets = { rakuten_dashboard: createSheet([]) };

  gas.ensureRakutenLogSheet_(createSpreadsheet(sheets));

  assert.deepEqual(plain(sheets.rakuten_dashboard.getRange(1, 1, 1, 5).getValues()), [
    ['実行日時', '楽天行番号', '管理コード', '内容', '種別'],
  ]);
});

test('ensureRakutenLogSheet_ preserves an existing valid sheet and old logs', () => {
  const batchWrites = [];
  const oldRows = [
    ['実行日時', '楽天行番号', '管理コード', '内容', '種別'],
    ['2026-06-18 09:00:00', 12, 'sado-old', '既存ログ', 'WARNING'],
  ];
  const sheets = { rakuten_dashboard: createSheet(oldRows, null, batchWrites) };

  gas.ensureRakutenLogSheet_(createSpreadsheet(sheets));

  assert.equal(batchWrites.length, 0);
  assert.deepEqual(plain(sheets.rakuten_dashboard.getRange(1, 1, 2, 5).getValues()), oldRows);
});

test('ensureRakutenLogSheet_ rejects a malformed nonblank sheet', () => {
  const sheets = {
    rakuten_dashboard: createSheet([['日時', '行', 'コード', '内容', 'レベル']]),
  };

  assert.throws(
    () => gas.ensureRakutenLogSheet_(createSpreadsheet(sheets)),
    { message: 'rakuten_dashboardシートのヘッダーが不正です。期待値: 実行日時, 楽天行番号, 管理コード, 内容, 種別' }
  );
});

test('getRakutenImageSlotHeaders_ defines URL and Path slots through 20', () => {
  const urlHeaders = plain(gas.getRakutenImageSlotHeaders_('URL'));
  const pathHeaders = plain(gas.getRakutenImageSlotHeaders_('Path'));

  assert.equal(urlHeaders.length, 21);
  assert.equal(urlHeaders[19], 'URL19');
  assert.equal(urlHeaders[20], 'URL20');
  assert.equal(pathHeaders.length, 21);
  assert.equal(pathHeaders[19], 'Path19');
  assert.equal(pathHeaders[20], 'Path20');
});

test('image pipeline preserves slots 19 and 20 through URL reorganization and path mapping', () => {
  const imageListRows = [
    ['FileName', 'FileUrl', 'FileId', 'FileSize(KB)', 'Dimensions', 'AccessDate', 'TimeStamp', 'FolderName', 'FolderId', 'フォルダパス'],
    ['sado-1_19.jpg', 'https://example.com/sado-1_19.jpg', '', '', '', '', '', '', '', 'folder'],
    ['sado-1_20.jpg', 'https://example.com/sado-1_20.jpg', '', '', '', '', '', '', '', 'folder'],
  ];
  const sheets = {
    rakuten_image_list: createSheet(imageListRows),
    rakuten_image_grid: createSheet([plain(gas.getRakutenImageSlotHeaders_('URL'))]),
    rakuten_image_paths: createSheet([plain(gas.getRakutenImageSlotHeaders_('Path'))]),
  };
  const pipelineGas = loadGas(['src/Config.js', 'src/DistributorRakuten.js'], {
    SpreadsheetApp: {
      getActiveSpreadsheet() {
        return createSpreadsheet(sheets);
      },
    },
  });

  pipelineGas.reorganizeImages_();
  pipelineGas.createImagePaths_();
  const urlMap = pipelineGas.buildImageUrlMap_(createSpreadsheet(sheets));
  const pathMap = pipelineGas.buildImagePathMapForTemplate_(createSpreadsheet(sheets));

  assert.deepEqual(plain(sheets.rakuten_image_grid.getRange(2, 20, 1, 2).getValues()), [[
    'https://example.com/sado-1_19.jpg',
    'https://example.com/sado-1_20.jpg',
  ]]);
  assert.equal(urlMap['sado-1'].length, 20);
  assert.equal(urlMap['sado-1'][18], 'https://example.com/sado-1_19.jpg');
  assert.equal(urlMap['sado-1'][19], 'https://example.com/sado-1_20.jpg');
  assert.equal(pathMap['sado-1'].length, 20);
  assert.equal(pathMap['sado-1'][18], 'folder/sado-1_19.jpg');
  assert.equal(pathMap['sado-1'][19], 'folder/sado-1_20.jpg');
});

test('getRakutenCsvHeaders emits actual type, path, ALT order for images 1 and 20', () => {
  const headers = plain(gas.getRakutenCsvHeaders());

  assert.deepEqual(headers.slice(headers.indexOf('商品画像タイプ1'), headers.indexOf('商品画像タイプ1') + 3), [
    '商品画像タイプ1',
    '商品画像パス1',
    '商品画像名（ALT）1',
  ]);
  assert.deepEqual(headers.slice(headers.indexOf('商品画像タイプ20'), headers.indexOf('商品画像タイプ20') + 3), [
    '商品画像タイプ20',
    '商品画像パス20',
    '商品画像名（ALT）20',
  ]);
});

test('runTemplateInjection_ writes one non-adjacent batch and preserves an intermediate formula', () => {
  const writes = [];
  const batchWrites = [];
  const headers = [
    '商品管理番号',
    '商品名',
    'SKU管理番号',
    'システム連携用SKU番号',
    'PC用商品説明文',
    'スマートフォン用商品説明文',
    'PC用販売説明文',
    '商品画像名（ALT）1',
    '変更禁止列',
    '商品画像パス1',
    '商品画像タイプ1',
  ];
  const sheets = {
    rakuten_template: createSheet([
      ['キー', 'テンプレート'],
      ['TEMPLATE_PC_DESC', 'PC'],
      ['TEMPLATE_SP_DESC', 'SP'],
      ['TEMPLATE_PC_SALES', '販売'],
    ]),
    choice_tsv: createSheet([
      ['管理コード', '（必須）お礼の品名'],
      ['sado-1', '商品1'],
    ]),
    rakuten_image_grid: createSheet([['商品番号', 'URL1']]),
    rakuten_image_paths: createSheet([
      ['商品番号', 'Path1'],
      ['cabinet-1', 'folder/1.jpg'],
    ]),
    rakuten_image_mapping: createSheet([
      ['R-Cabinet商品番号', '管理コード'],
      ['cabinet-1', 'sado-1'],
    ]),
    rakuten_csv: createSheet([
      headers,
      ['product-1', '商品1', '', '', '', '', '', '', 'computed value'],
      ['product-1', '', 'sku-1', 'sado-1'],
    ], writes, batchWrites, null, null, [
      [],
      ['', '', '', '', '', '', '', '', '=A2&"-formula"'],
    ]),
    rakuten_dashboard: createSheet([['実行日時', '楽天行番号', '管理コード', '内容', '種別']]),
  };

  runInjectionWithSheets(sheets, true);

  assert.equal(writes.length, 0, JSON.stringify(writes));
  assert.deepEqual(batchWrites, [{
    row: 2,
    column: 5,
    numRows: 1,
    numColumns: 7,
    values: [['PC', 'SP', '販売', '商品1', '=A2&"-formula"', 'folder/1.jpg', 'CABINET']],
  }]);
});

test('runTemplateInjection_ rejects duplicate image headers before any CSV write', () => {
  const writes = [];
  const headers = [
    '商品管理番号', '商品名', 'SKU管理番号', 'システム連携用SKU番号',
    'PC用商品説明文', 'スマートフォン用商品説明文', 'PC用販売説明文',
    '商品画像タイプ1', '商品画像タイプ1', '商品画像パス1', '商品画像名（ALT）1',
  ];
  const sheets = {
    rakuten_template: createSheet([
      ['キー', 'テンプレート'],
      ['TEMPLATE_PC_DESC', 'PC'],
      ['TEMPLATE_SP_DESC', 'SP'],
      ['TEMPLATE_PC_SALES', '販売'],
    ]),
    choice_tsv: createSheet([['管理コード'], ['sado-1']]),
    rakuten_image_grid: createSheet([['商品番号']]),
    rakuten_image_paths: createSheet([['商品番号']]),
    rakuten_image_mapping: createSheet([['R-Cabinet商品番号', '管理コード']]),
    rakuten_csv: createSheet([
      headers,
      ['product-1', '商品1'],
      ['product-1', '', 'sku-1', 'sado-1'],
    ], writes),
    rakuten_dashboard: createSheet([['実行日時', '楽天行番号', '管理コード', '内容', '種別']]),
  };

  assert.throws(
    () => runInjectionWithSheets(sheets, true),
    { message: '楽天画像ヘッダーが重複しています: 商品画像タイプ1' }
  );
  assert.equal(writes.length, 0);
});

test('runTemplateInjection_ rejects a malformed log sheet before any CSV write', () => {
  const writes = [];
  const sheets = {
    rakuten_template: createSheet([
      ['キー', 'テンプレート'],
      ['TEMPLATE_PC_DESC', 'PC'],
      ['TEMPLATE_SP_DESC', 'SP'],
      ['TEMPLATE_PC_SALES', '販売'],
    ]),
    choice_tsv: createSheet([['管理コード'], ['sado-1']]),
    rakuten_image_grid: createSheet([['商品番号']]),
    rakuten_image_paths: createSheet([['商品番号']]),
    rakuten_image_mapping: createSheet([['R-Cabinet商品番号', '管理コード']]),
    rakuten_csv: createSheet([
      ['商品管理番号', '商品名', 'SKU管理番号', 'システム連携用SKU番号', 'PC用商品説明文', 'スマートフォン用商品説明文', 'PC用販売説明文'],
      ['product-1', '商品1'],
      ['product-1', '', 'sku-1', 'sado-1'],
    ], writes),
    rakuten_dashboard: createSheet([['壊れたヘッダー']]),
  };

  assert.throws(
    () => runInjectionWithSheets(sheets, true),
    /rakuten_dashboardシートのヘッダーが不正です/
  );
  assert.equal(writes.length, 0);
});

test('runTemplateInjection_ writes 50000 characters, rejects 50001, logs ERROR, and continues images', () => {
  const writes = [];
  const csvBatchWrites = [];
  const logBatchWrites = [];
  const headers = [
    '商品管理番号',
    '商品名',
    'SKU管理番号',
    'システム連携用SKU番号',
    'PC用商品説明文',
    'スマートフォン用商品説明文',
    'PC用販売説明文',
    '商品画像タイプ1',
    '商品画像パス1',
    '商品画像名（ALT）1',
  ];

  const sheets = {
    rakuten_template: createSheet([
      ['キー', 'テンプレート'],
      ['TEMPLATE_PC_DESC', 'x'.repeat(50000)],
      ['TEMPLATE_SP_DESC', 'y'.repeat(50001)],
      ['TEMPLATE_PC_SALES', '販売'],
    ]),
    choice_tsv: createSheet([
      ['管理コード', '（必須）お礼の品名'],
      ['sado-1', '商品1'],
    ]),
    rakuten_image_grid: createSheet([['商品番号', 'URL1']]),
    rakuten_image_paths: createSheet([
      ['商品番号', 'Path1'],
      ['cabinet-1', 'folder/1.jpg'],
    ]),
    rakuten_image_mapping: createSheet([
      ['R-Cabinet商品番号', '管理コード'],
      ['cabinet-1', 'sado-1'],
    ]),
    rakuten_csv: createSheet([
      headers,
      ['product-1', '商品1'],
      ['product-1', '', 'sku-1', 'sado-1'],
    ], writes, csvBatchWrites),
    rakuten_dashboard: createSheet(
      [['実行日時', '楽天行番号', '管理コード', '内容', '種別']],
      null,
      logBatchWrites
    ),
  };

  runInjectionWithSheets(sheets, true);

  assert.equal(writes.length, 0, JSON.stringify(writes));
  assert.equal(csvBatchWrites.length, 1, JSON.stringify(csvBatchWrites));
  assert.equal(csvBatchWrites[0].values[0][0], 'x'.repeat(50000));
  assert.equal(csvBatchWrites[0].values[0].includes('y'.repeat(50001)), false);
  assert.equal(csvBatchWrites[0].values[0].includes('販売'), true);
  assert.equal(csvBatchWrites[0].values[0].includes('folder/1.jpg'), true);
  const logs = logBatchWrites.flatMap((write) => write.values);
  assert.equal(logs.some((row) => row.length === 5 && row[4] === 'ERROR' && row[3].includes('50001文字')), true);
});

test('runTemplateInjection_ persists a warning and mutation error, then continues the next product', () => {
  const writes = [];
  const csvBatchWrites = [];
  const logBatchWrites = [];
  const setValuesAttempts = [];
  const headers = [
    '商品管理番号',
    '商品名',
    'SKU管理番号',
    'システム連携用SKU番号',
    'PC用商品説明文',
    'スマートフォン用商品説明文',
    'PC用販売説明文',
  ];
  let failed = false;
  const sheets = {
    rakuten_template: createSheet([
      ['キー', 'テンプレート'],
      ['TEMPLATE_PC_DESC', '{{空欄}}'],
      ['TEMPLATE_SP_DESC', 'SP'],
      ['TEMPLATE_PC_SALES', '販売'],
    ]),
    choice_tsv: createSheet([
      ['管理コード', '空欄'],
      ['sado-1', ''],
      ['sado-2', '値あり'],
    ]),
    rakuten_image_grid: createSheet([['商品番号']]),
    rakuten_image_paths: createSheet([['商品番号']]),
    rakuten_image_mapping: createSheet([['R-Cabinet商品番号', '管理コード']]),
    rakuten_csv: createSheet(
      [
        headers,
        ['product-1', '商品1'],
        ['product-1', '', 'sku-1', 'sado-1'],
        ['product-2', '商品2'],
        ['product-2', '', 'sku-2', 'sado-2'],
      ],
      writes,
      csvBatchWrites,
      null,
      (attempt) => {
        setValuesAttempts.push(attempt);
        if (!failed && attempt.row === 2) {
          failed = true;
          throw new Error('simulated setValues failure');
        }
      }
    ),
    rakuten_dashboard: createSheet(
      [['実行日時', '楽天行番号', '管理コード', '内容', '種別']],
      null,
      logBatchWrites
    ),
  };

  runInjectionWithSheets(sheets);

  const logs = logBatchWrites.flatMap((write) => write.values);
  const firstProductWarning = logs.filter((row) =>
    row[2] === 'sado-1' && row[3].includes('空プレースホルダー') && row[4] === 'WARNING'
  );
  const firstProductError = logs.filter((row) =>
    row[2] === 'sado-1' && row[3].includes('simulated setValues failure') && row[4] === 'ERROR'
  );
  assert.equal(firstProductWarning.length, 1, JSON.stringify(logBatchWrites));
  assert.equal(firstProductError.length, 1, JSON.stringify(logBatchWrites));
  assert.equal(logs.every((row) => row.length === 5), true);
  assert.equal(writes.length, 0, JSON.stringify(writes));
  assert.equal(setValuesAttempts.length, 2, JSON.stringify(setValuesAttempts));
  assert.equal(csvBatchWrites.length, 1, JSON.stringify(csvBatchWrites));
  assert.equal(csvBatchWrites[0].row, 4);
  assert.deepEqual(csvBatchWrites[0].values, [['値あり', 'SP', '販売']]);
});

test('runTemplateInjection_ logs each empty placeholder once per product across all templates', () => {
  const logBatchWrites = [];
  const headers = [
    '商品管理番号', '商品名', 'SKU管理番号', 'システム連携用SKU番号',
    'PC用商品説明文', 'スマートフォン用商品説明文', 'PC用販売説明文',
  ];
  const sheets = {
    rakuten_template: createSheet([
      ['キー', 'テンプレート'],
      ['TEMPLATE_PC_DESC', '{{空欄}}/{{空欄}}'],
      ['TEMPLATE_SP_DESC', '{{空欄}}'],
      ['TEMPLATE_PC_SALES', '{{空欄}}/{{別の空欄}}/{{別の空欄}}'],
    ]),
    choice_tsv: createSheet([
      ['管理コード', '空欄', '別の空欄'],
      ['sado-1', '', ''],
    ]),
    rakuten_image_grid: createSheet([['商品番号']]),
    rakuten_image_paths: createSheet([['商品番号']]),
    rakuten_image_mapping: createSheet([['R-Cabinet商品番号', '管理コード']]),
    rakuten_csv: createSheet([
      headers,
      ['product-1', '商品1'],
      ['product-1', '', 'sku-1', 'sado-1'],
    ]),
    rakuten_dashboard: createSheet(
      [['実行日時', '楽天行番号', '管理コード', '内容', '種別']],
      null,
      logBatchWrites
    ),
  };

  runInjectionWithSheets(sheets, true);

  const warnings = logBatchWrites
    .flatMap((write) => write.values)
    .filter((row) => row[2] === 'sado-1' && row[4] === 'WARNING')
    .map((row) => row[3]);
  assert.deepEqual(warnings, [
    '空プレースホルダー: {{空欄}}',
    '空プレースホルダー: {{別の空欄}}',
  ]);
});

test('runTemplateInjection_ reports zero updates when all HTML exceeds the limit and there are no images', () => {
  const alerts = [];
  const csvBatchWrites = [];
  const headers = [
    '商品管理番号', '商品名', 'SKU管理番号', 'システム連携用SKU番号',
    'PC用商品説明文', 'スマートフォン用商品説明文', 'PC用販売説明文',
  ];
  const sheets = {
    rakuten_template: createSheet([
      ['キー', 'テンプレート'],
      ['TEMPLATE_PC_DESC', 'a'.repeat(50001)],
      ['TEMPLATE_SP_DESC', 'b'.repeat(50001)],
      ['TEMPLATE_PC_SALES', 'c'.repeat(50001)],
    ]),
    choice_tsv: createSheet([['管理コード'], ['sado-1']]),
    rakuten_image_grid: createSheet([['商品番号']]),
    rakuten_image_paths: createSheet([['商品番号']]),
    rakuten_image_mapping: createSheet([['R-Cabinet商品番号', '管理コード']]),
    rakuten_csv: createSheet([
      headers,
      ['product-1', '商品1'],
      ['product-1', '', 'sku-1', 'sado-1'],
    ], null, csvBatchWrites),
    rakuten_dashboard: createSheet([['実行日時', '楽天行番号', '管理コード', '内容', '種別']]),
  };

  runInjectionWithSheets(sheets, true, alerts);

  assert.equal(csvBatchWrites.length, 0);
  assert.equal(alerts.some((args) => String(args[1]).includes('✅ 更新: 0 件')), true, JSON.stringify(alerts));
});

test('runTemplateInjection_ appends warnings and every skipped-product reason as five-column logs', () => {
  const batchWrites = [];
  const headers = [
    '商品管理番号',
    '商品名',
    'SKU管理番号',
    'システム連携用SKU番号',
    'PC用商品説明文',
    'スマートフォン用商品説明文',
    'PC用販売説明文',
  ];
  const sheets = {
    rakuten_template: createSheet([
      ['キー', 'テンプレート'],
      ['TEMPLATE_PC_DESC', '{{空欄}}'],
      ['TEMPLATE_SP_DESC', 'SP'],
      ['TEMPLATE_PC_SALES', '販売'],
    ]),
    choice_tsv: createSheet([
      ['管理コード', '空欄'],
      ['sado-1', ''],
    ]),
    rakuten_image_grid: createSheet([['商品番号', 'URL1']]),
    rakuten_image_paths: createSheet([['商品番号', 'Path1']]),
    rakuten_image_mapping: createSheet([['R-Cabinet商品番号', '管理コード']]),
    rakuten_csv: createSheet([
      headers,
      ['product-1', '商品1'],
      ['product-1', '', 'sku-1', 'sado-1'],
      ['product-2', '商品2'],
      ['product-3', '商品3'],
      ['product-3', '', 'sku-3', ''],
      ['product-4', '商品4'],
      ['product-4', '', 'sku-4', 'missing-choice'],
    ]),
    rakuten_dashboard: createSheet(
      [
        ['実行日時', '楽天行番号', '管理コード', '内容', '種別'],
        ['2026-06-18 09:00:00', 12, 'sado-old', '既存ログ', 'WARNING'],
      ],
      null,
      batchWrites
    ),
  };

  runInjectionWithSheets(sheets);

  assert.equal(batchWrites[0].row, 3);
  assert.equal(batchWrites.every((write) => write.column === 1 && write.numColumns === 5), true);
  const logs = batchWrites.flatMap((write) => write.values);
  assert.equal(logs.every((row) => row.length === 5), true);
  assert.equal(logs.length, 5, JSON.stringify(batchWrites));
  const contents = logs.map((row) => row[3]);
  assert.equal(contents.some((content) => content.includes('空プレースホルダー')), true, JSON.stringify(batchWrites));
  assert.equal(contents.some((content) => content.includes('SKU行なし')), true);
  assert.equal(contents.some((content) => content.includes('システム連携用SKU番号なし')), true);
  assert.equal(contents.some((content) => content.includes('Choiceデータなし')), true);
  assert.equal(logs.filter((row) => row[4] === 'ERROR').length, 1);
  assert.equal(contents.some((content) => content.includes('商品画像ヘッダー不足')), true);
  assert.equal(new Set(logs.map((row) => row.slice(1).join('|'))).size, logs.length);
});

test('parseProductBlocks_ starts blocks only on product-name rows and collects their SKUs', () => {
  const productData = [['orphan'], ['product-1'], ['option'], ['sku-1'], ['product-2'], ['sku-2']];
  const nameData = [[''], ['商品1'], [''], [''], ['商品2'], ['']];
  const skuMgmtData = [['orphan-sku'], [''], [''], ['sku-1_0'], [''], ['sku-2_0']];

  const actual = gas.parseProductBlocks_(productData, nameData, skuMgmtData, 7);

  assert.deepEqual(plain(actual), [
    { startIndex: 1, endIndex: 3, skuIndices: [3] },
    { startIndex: 4, endIndex: 5, skuIndices: [5] },
  ]);
});

test('resolveImageKey_ prefers a manual image mapping and otherwise uses the management code', () => {
  assert.equal(gas.resolveImageKey_('sado-1', { 'sado-1': 'cabinet-99' }), 'cabinet-99');
  assert.equal(gas.resolveImageKey_('sado-2', { 'sado-1': 'cabinet-99' }), 'sado-2');
});

test('resolveRakutenTemplateImageKey_ prefers product number images before system SKU images', () => {
  const actual = gas.resolveRakutenTemplateImageKey_({
    productNumber: 'product-1',
    systemSkuNumber: 'sku-1',
    imageMappingMap: {},
    imageUrlMap: {
      'sku-1': ['sku-url'],
      'product-1': ['product-url'],
    },
    imagePathMap: {
      'sku-1': ['sku-path'],
      'product-1': ['product-path'],
    },
  });

  assert.equal(actual, 'product-1');
});

test('resolveRakutenTemplateImageKey_ falls back to system SKU when product number has no images', () => {
  const actual = gas.resolveRakutenTemplateImageKey_({
    productNumber: 'product-1',
    systemSkuNumber: 'sku-1',
    imageMappingMap: {},
    imageUrlMap: {
      'sku-1': ['sku-url'],
    },
    imagePathMap: {
      'sku-1': ['sku-path'],
    },
  });

  assert.equal(actual, 'sku-1');
});

test('resolveRakutenTemplateImageKey_ applies manual mapping to product number before fallback', () => {
  const actual = gas.resolveRakutenTemplateImageKey_({
    productNumber: 'product-1',
    systemSkuNumber: 'sku-1',
    imageMappingMap: {
      'product-1': 'cabinet-product',
      'sku-1': 'cabinet-sku',
    },
    imageUrlMap: {
      'cabinet-sku': ['sku-url'],
      'cabinet-product': ['product-url'],
    },
    imagePathMap: {
      'cabinet-sku': ['sku-path'],
      'cabinet-product': ['product-path'],
    },
  });

  assert.equal(actual, 'cabinet-product');
});

test('selectRakutenTemplateImageUrls_ selects seven SP images from URL2 through URL8', () => {
  const urls = Array.from({ length: 9 }, (_, index) => `URL${index + 1}`);

  assert.deepEqual(
    plain(gas.selectRakutenTemplateImageUrls_(urls, 1, 7)),
    ['URL2', 'URL3', 'URL4', 'URL5', 'URL6', 'URL7', 'URL8']
  );
});

test('resolveFolderId_ returns numeric string directly if input is already digits', () => {
  const actual = gas.resolveFolderId_('5001234');
  assert.equal(actual, '5001234');
});

test('resolveFolderId_ resolves folder name to numeric folderId using rakuten_image_folders sheet', () => {
  const sheets = {
    rakuten_image_folders: createSheet([
      ['FolderId', 'FolderName', 'FolderPath'],
      ['5001234', 'sado-image-all', '/sado-image-all'],
      ['5005678', 'sado-other', '/sado-other'],
    ]),
  };

  const harness = loadGas(['src/Config.js', 'src/DistributorRakuten.js'], {
    SpreadsheetApp: {
      getActiveSpreadsheet() {
        return createSpreadsheet(sheets);
      },
    },
    Logger: { log() {} },
  });

  // 完全一致 (名前)
  assert.equal(harness.resolveFolderId_('sado-image-all'), '5001234');
  // 完全一致 (パス)
  assert.equal(harness.resolveFolderId_('/sado-image-all'), '5001234');
  // 部分一致
  assert.equal(harness.resolveFolderId_('image-all'), '5001234');
});

test('resolveFolderId_ throws error when folder not found or sheet is missing', () => {
  const sheets = {
    rakuten_image_folders: createSheet([
      ['FolderId', 'FolderName', 'FolderPath'],
      ['5001234', 'sado-image-all', '/sado-image-all'],
    ]),
  };

  const harness = loadGas(['src/Config.js', 'src/DistributorRakuten.js'], {
    SpreadsheetApp: {
      getActiveSpreadsheet() {
        return createSpreadsheet(sheets);
      },
    },
  });

  // 見つからないフォルダ名
  assert.throws(
    () => harness.resolveFolderId_('not-existing-folder'),
    /フォルダ一覧シートからも該当するフォルダ名\/フォルダパスが見つかりませんでした/
  );

  // シートがない場合
  const emptyHarness = loadGas(['src/Config.js', 'src/DistributorRakuten.js'], {
    SpreadsheetApp: {
      getActiveSpreadsheet() {
        return createSpreadsheet({});
      },
    },
  });
  assert.throws(
    () => emptyHarness.resolveFolderId_('sado-image-all'),
    /「rakuten_image_folders」シートが見つかりません/
  );
});

test('parseCabinetFolderInputs_ accepts comma and newline separated folders once', () => {
  const actual = plain(gas.parseCabinetFolderInputs_('1001, 1002\n1001\n/folder-name'));

  assert.deepEqual(actual, ['1001', '1002', '/folder-name']);
});

test('assertNoDuplicateCabinetImageNames_ rejects duplicate names across fetched folders', () => {
  assert.throws(
    () => gas.assertNoDuplicateCabinetImageNames_([
      ['item_1.jpg', '', '', '', '', '', '', 'folder-a', '1001', '/a'],
      ['ITEM_1.jpg', '', '', '', '', '', '', 'folder-b', '1002', '/b'],
    ]),
    { message: 'R-Cabinet画像取得結果に同名画像があります: item_1.jpg (1001 / 1002)' }
  );
});

test('fetchCabinetImages_ writes images from multiple R-Cabinet folders together', () => {
  const writes = [];
  const clears = [];
  const imageListSheet = {
    getLastRow() {
      return 3;
    },
    getRange(row, column, numRows, numColumns) {
      return {
        clearContent() {
          clears.push({ row, column, numRows, numColumns });
        },
        setValues(values) {
          writes.push({ row, column, numRows, numColumns, values: plain(values) });
        },
      };
    },
  };
  const sheets = {
    rakuten_image_list: imageListSheet,
  };
  const alerts = [];
  const harness = loadGas(['src/Config.js', 'src/DistributorRakuten.js'], {
    SpreadsheetApp: {
      getUi() {
        return {
          alert(...args) {
            alerts.push(args);
          },
          ButtonSet: { OK: 'OK' },
        };
      },
      getActiveSpreadsheet() {
        return createSpreadsheet(sheets);
      },
    },
    Utilities: { sleep() {} },
    Logger: { log() {} },
  });
  const fetches = [];
  harness.getRakutenApiAuthHeader_ = () => ({ Authorization: 'test' });
  harness.fetchImageDataFromRms_ = (authHeader, folderId, offset, limit) => {
    fetches.push({ folderId, offset, limit });
    return `${folderId}:${offset}:${limit}`;
  };
  harness.getImageTotalCount_ = (responseText) => responseText.startsWith('1001:') ? 1 : 2;
  harness.extractImageData_ = (responseText, folderName, folderId, folderPath) => {
    if (folderId === '1001') return [['a_1.jpg', 'https://img/a_1.jpg', '', '', '', '', '', folderName, folderId, folderPath]];
    return [['b_1.jpg', 'https://img/b_1.jpg', '', '', '', '', '', folderName, folderId, folderPath]];
  };
  harness.completeOperation_ = () => {};

  harness.fetchCabinetImages_('1001,1002');

  assert.deepEqual(fetches, [
    { folderId: '1001', offset: 1, limit: 1 },
    { folderId: '1001', offset: 1, limit: 100 },
    { folderId: '1002', offset: 1, limit: 1 },
    { folderId: '1002', offset: 1, limit: 100 },
  ]);
  assert.deepEqual(clears, [{ row: 2, column: 1, numRows: 2, numColumns: 10 }]);
  assert.deepEqual(writes, [{
    row: 2,
    column: 1,
    numRows: 2,
    numColumns: 10,
    values: [
      ['a_1.jpg', 'https://img/a_1.jpg', '', '', '', '', '', '不明', '1001', ''],
      ['b_1.jpg', 'https://img/b_1.jpg', '', '', '', '', '', '不明', '1002', ''],
    ],
  }]);
  assert.match(String(alerts[0][1]), /2件の画像情報を同期しました。/);
});

test('runTemplateInjection_ runs successfully even when PRODUCT_NAME header is missing in rakuten_csv', () => {
  const writes = [];
  const batchWrites = [];
  const headersWithoutName = [
    '商品管理番号',
    // '商品名', がない
    'SKU管理番号',
    'システム連携用SKU番号',
    'PC用商品説明文',
    'スマートフォン用商品説明文',
    'PC用販売説明文',
    '商品画像名（ALT）1',
    '商品画像パス1',
    '商品画像タイプ1',
  ];
  const sheets = {
    rakuten_template: createSheet([
      ['キー', 'テンプレート'],
      ['TEMPLATE_PC_DESC', 'PC'],
      ['TEMPLATE_SP_DESC', 'SP'],
      ['TEMPLATE_PC_SALES', '販売'],
    ]),
    choice_tsv: createSheet([
      ['管理コード', '（必須）お礼の品名'],
      ['sado-1', '商品1'],
    ]),
    rakuten_image_grid: createSheet([['商品番号', 'URL1']]),
    rakuten_image_paths: createSheet([
      ['商品番号', 'Path1'],
      ['cabinet-1', 'folder/1.jpg'],
    ]),
    rakuten_image_mapping: createSheet([
      ['R-Cabinet商品番号', '管理コード'],
      ['cabinet-1', 'sado-1'],
    ]),
    rakuten_csv: createSheet([
      headersWithoutName,
      ['product-1', '', '', '', '', '', '', '', ''],
      ['product-1', 'sku-1', 'sado-1'],
    ], writes, batchWrites),
    rakuten_dashboard: createSheet([['実行日時', '楽天行番号', '管理コード', '内容', '種別']]),
  };

  runInjectionWithSheets(sheets, true);

  assert.equal(writes.length, 0);
  assert.equal(batchWrites.length, 1);
  // 商品名がないため、画像ALTとしてChoiceのお礼の品名（商品1）がフォールバックして使われることを確認
  assert.deepEqual(batchWrites[0].values, [[
    'PC',
    'SP',
    '販売',
    '商品1', // ALTテキストがフォールバック
    'folder/1.jpg',
    'CABINET',
  ]]);
});

test('normalizeRakutenHtmlLeadingWhitespace_ removes only leading whitespace', () => {
  assert.equal(gas.normalizeRakutenHtmlLeadingWhitespace_('\r\n  <style>x</style>\n<p>a</p>'),
    '<style>x</style>\n<p>a</p>');
});

test('buildRakutenProductImageValues_ compacts paths and clears unused slots', () => {
  assert.deepEqual(plain(gas.buildRakutenProductImageValues_(['a.jpg', '', 'b.jpg'], '商品A', 3)), [
    'CABINET', 'a.jpg', '商品A', 'CABINET', 'b.jpg', '商品A', '', '', '',
  ]);
});

test('buildRakutenTemplateImageHtml_ skips blank image URLs', () => {
  const html = gas.buildRakutenTemplateImageHtml_(['u1', 'u2', '', null, '   ', 'u6'], 0, 9, true);

  assert.equal(html.includes('src=""'), false);
  assert.equal(html.includes('src="   "'), false);
  assert.equal((html.match(/<img /g) || []).length, 3);
  assert.equal(html.includes('<img src="u1" width="750px">'), true);
  assert.equal(html.includes('<img src="u2" width="750px">'), true);
  assert.equal(html.includes('<img src="u6" width="750px">'), true);
});

test('planRakutenTemplateProduct_ skips missing inputs and atomically plans HTML and images', () => {
  const templates = {
    TEMPLATE_PC_DESC: '  {{説明}}',
    TEMPLATE_SP_DESC: '{{空欄}}',
    TEMPLATE_PC_SALES: '販売',
  };
  assert.equal(gas.planRakutenTemplateProduct_({ templates, imagePaths: ['a.jpg'] }).status, 'CHOICE_MISSING');
  assert.equal(gas.planRakutenTemplateProduct_({ templates, choiceData: {}, imagePaths: [] }).status, 'IMAGE_MISSING');
  const actual = gas.planRakutenTemplateProduct_({
    templates,
    choiceData: { 説明: '説明', '（必須）お礼の品名': 'Choice名｜補足' },
    imagePaths: ['a.jpg'],
    imageUrls: ['u1', 'u2'],
    slotCount: 2,
  });
  assert.equal(actual.status, 'UPDATE');
  assert.deepEqual(plain(actual.warnings), ['空欄']);
  assert.equal(actual.htmlValues[0], '説明');
  assert.equal(actual.htmlValues[1].startsWith('<img src="u2"'), true);
  assert.deepEqual(plain(actual.imageValues), ['CABINET', 'a.jpg', 'Choice名', '', '', '']);
});

test('planRakutenTemplateProduct_ cancels all mutations when one HTML cell exceeds 50000', () => {
  const actual = gas.planRakutenTemplateProduct_({
    templates: { TEMPLATE_PC_DESC: 'x'.repeat(50001), TEMPLATE_SP_DESC: 'SP', TEMPLATE_PC_SALES: '販売' },
    choiceData: {}, imagePaths: ['a.jpg'],
  });
  assert.equal(actual.status, 'HTML_ERROR');
  assert.deepEqual(plain(actual.htmlValues), []);
  assert.deepEqual(plain(actual.imageValues), []);
});

test('groupAdjacentRakutenMutationColumns_ sorts, deduplicates and groups adjacent columns', () => {
  assert.deepEqual(plain(gas.groupAdjacentRakutenMutationColumns_([12, 10, 11, 20, 20])), [
    { startColumn: 10, endColumn: 12, columns: [10, 11, 12] },
    { startColumn: 20, endColumn: 20, columns: [20] },
  ]);
});

test('buildRakutenTemplateBatchWrites_ changes only product rows and preserves formulas', () => {
  const writes = gas.buildRakutenTemplateBatchWrites_([
    { values: [['old', 'computed'], ['sku', 'keep']], formulas: [['', '=A2'], ['', '']] },
  ], [{ row: 2, status: 'UPDATE', mutations: [{ column: 5, value: 'new' }] }], [
    { startColumn: 5, endColumn: 6, columns: [5, 6] },
  ], 2);
  assert.deepEqual(plain(writes[0].values), [['new', '=A2'], ['sku', 'keep']]);
});

test('buildRakutenTemplateCheckpoint_ retains all result classifications', () => {
  assert.deepEqual(plain(gas.buildRakutenTemplateCheckpoint_(200, {
    updated: 1, choiceMissing: 2, imageMissing: 3, otherSkipped: 4, charErrors: 5, mutationErrors: 6,
  }, 'sig', 'backup')), {
    nextBlockIndex: 200,
    stats: { updated: 1, choiceMissing: 2, imageMissing: 3, otherSkipped: 4, charErrors: 5, mutationErrors: 6 },
    signature: 'sig', backupFileId: 'backup',
  });
});

function createJobHarness(options = {}) {
  const orderedEvents = [];
  const properties = new Map(Object.entries(options.properties || {}));
  const propertyWrites = [];
  const triggerEvents = [];
  const lockEvents = [];
  let contextLoads = 0;
  const blocks = Array.from({ length: options.blockCount || 0 }, (_, index) =>
    ({ startIndex: index * 8, endIndex: index * 8 + 7, skuIndices: [index * 8 + 1] }));
  const gas = loadGas(['src/Config.js', 'src/DistributorRakuten.js'], {
    Date: options.Date || Date,
    LockService: { getScriptLock: () => ({ tryLock() { lockEvents.push('try'); return options.lock !== false; }, releaseLock() { lockEvents.push('release'); } }) },
    PropertiesService: { getScriptProperties: () => ({
      getProperty: (key) => properties.get(key) || null,
      setProperty(key, value) { properties.set(key, value); propertyWrites.push([key, value]); orderedEvents.push(['checkpoint', JSON.parse(value).nextBlockIndex]); },
      deleteProperty: (key) => properties.delete(key),
    }) },
    SpreadsheetApp: { getActiveSpreadsheet: () => ({ getId: () => 'ss' }), flush() { orderedEvents.push(['flush']); } },
    Utilities: { formatDate: () => '20260622', DigestAlgorithm: { SHA_256: 'sha' }, Charset: { UTF_8: 'utf8' } },
    ScriptApp: {
      getProjectTriggers: () => options.pendingTrigger ? [{ getHandlerFunction: () => 'resumeRakutenTemplateInjection' }] : [],
      newTrigger(name) { triggerEvents.push(['new', name]); return { timeBased() { return this; }, after(ms) { triggerEvents.push(['after', ms]); return this; }, create() { triggerEvents.push(['create']); } }; },
    },
    deleteTriggersByFunction_: (name) => triggerEvents.push(['delete', name]),
  });
  const context = { blocks, sheet: {}, colMap: {}, values: [], templates: {}, choiceMap: {},
    imageUrlMap: {}, imagePathMap: {}, imageMappingMap: {}, templateRows: [], choiceValues: [] };
  gas.loadRakutenTemplateJobContext_ = () => { contextLoads++; return context; };
  gas.computeRakutenTemplateSignature_ = () => options.signature || 'sig';
  gas.ensureRakutenLogSheet_ = () => ({});
  const backupBlocks = [];
  gas.backupRakutenTemplateTargets_ = (_ss, _sheet, targetBlocks) => {
    if (options.backupError) throw new Error(options.backupError);
    backupBlocks.push(...targetBlocks);
    return 'backup';
  };
  gas.buildRakutenTemplatePlans_ = (_context, targetBlocks) => ({
    plans: targetBlocks.filter((_block, index) => !options.ineligibleIndices || !options.ineligibleIndices.includes(index))
      .map((block) => ({ row: block.startIndex + 2 })), logs: [], stats: {},
  });
  gas.findEligibleRakutenTemplateBlocks_ = (targetContext) => targetContext.blocks
    .filter((_block, index) => !options.ineligibleIndices || !options.ineligibleIndices.includes(index));
  const batches = [];
  gas.executeRakutenTemplateBatch_ = (_context, targetBlocks) => {
    orderedEvents.push(['write']);
    batches.push(targetBlocks.map((block) => block.startIndex / 8));
    if (options.batchError && batches.length === options.batchError.at) {
      const error = new Error(options.batchError.message);
      error.rakutenBatchStats = { updated: 0, choiceMissing: 0, imageMissing: 0, otherSkipped: 0, charErrors: 0, mutationErrors: targetBlocks.length };
      throw error;
    }
    return { updated: targetBlocks.length, choiceMissing: 0, imageMissing: 0, otherSkipped: 0, charErrors: 0, mutationErrors: 0 };
  };
  return { gas, properties, propertyWrites, triggerEvents, batches, backupBlocks, lockEvents, orderedEvents,
    get contextLoads() { return contextLoads; } };
}

test('production job processes 1,250 x 8 rows in 200-product checkpoints and bounded batches', () => {
  const harness = createJobHarness({ blockCount: 1250 });
  const result = harness.gas.runRakutenTemplateInjectionJob_(false);
  assert.equal(result.updated, 1250);
  assert.deepEqual(harness.batches.map((batch) => batch.length), [200, 200, 200, 200, 200, 200, 50]);
  const checkpoints = harness.propertyWrites.filter(([key]) => key === harness.gas.PROP_KEYS.RAKUTEN_TEMPLATE_PROGRESS)
    .map(([, value]) => JSON.parse(value).nextBlockIndex);
  assert.deepEqual(checkpoints.slice(-7), [200, 400, 600, 800, 1000, 1200, 1250]);
});

test('successful batch flushes writes before advancing its checkpoint', () => {
  const harness = createJobHarness({ blockCount: 1 });
  harness.gas.runRakutenTemplateInjectionJob_(false);
  const writeIndex = harness.orderedEvents.findIndex((event) => event[0] === 'write');
  const flushIndex = harness.orderedEvents.findIndex((event, index) => index > writeIndex && event[0] === 'flush');
  const checkpointIndex = harness.orderedEvents.findIndex((event, index) => index > flushIndex && event[0] === 'checkpoint' && event[1] === 1);
  assert.equal(writeIndex < flushIndex && flushIndex < checkpointIndex, true, JSON.stringify(harness.orderedEvents));
});

test('1,250-product scale writes at most adjacent groups times batch count', () => {
  let writeCount = 0;
  const sheet = { getRange() { return { setValues() { writeCount++; } }; } };
  const groups = [
    { startColumn: 5, endColumn: 7, columns: [5, 6, 7] },
    { startColumn: 10, endColumn: 69, columns: Array.from({ length: 60 }, (_, index) => index + 10) },
  ];
  for (let offset = 0; offset < 1250; offset += 200) {
    const count = Math.min(200, 1250 - offset);
    const writes = groups.map((group) => ({ row: offset * 8 + 2, column: group.startColumn,
      numRows: count * 8, numColumns: group.endColumn - group.startColumn + 1,
      values: Array.from({ length: count * 8 }, () => Array(group.endColumn - group.startColumn + 1).fill('')) }));
    gas.applyRakutenTemplateBatchWrites_(sheet, writes, writes);
  }
  assert.equal(writeCount, 2 * Math.ceil(1250 / 200));
});

test('real parse, plan and execute handles 1,250 x 8 rows with group-bounded sheet I/O', () => {
  const productCount = 1250;
  const columnCount = 69;
  const data = [Array(columnCount).fill('')];
  const productData = [], nameData = [], skuData = [];
  const choiceMap = {}, imagePathMap = {};
  for (let product = 0; product < productCount; product++) {
    const code = `sku-${product}`;
    choiceMap[code] = { '（必須）お礼の品名': `商品${product}`, 説明: `説明${product}` };
    imagePathMap[code] = [`folder/${code}.jpg`];
    for (let offset = 0; offset < 8; offset++) {
      const row = Array(columnCount).fill('');
      row[0] = `product-${product}`;
      if (offset === 0) row[1] = `商品${product}`;
      if (offset === 1) { row[2] = `sku-mgmt-${product}`; row[3] = code; }
      data.push(row);
      productData.push([row[0]]); nameData.push([row[1]]); skuData.push([row[2]]);
    }
  }
  const blocks = gas.parseProductBlocks_(productData, nameData, skuData, data.length);
  assert.equal(blocks.length, productCount);
  const io = { getRange: 0, getValues: 0, getFormulas: 0, setValues: 0 };
  const sheet = { getRange(row, column, numRows, numColumns) {
    io.getRange++;
    return {
      getValues() { io.getValues++; return data.slice(row - 1, row - 1 + numRows).map((source) => source.slice(column - 1, column - 1 + numColumns)); },
      getFormulas() { io.getFormulas++; return Array.from({ length: numRows }, () => Array(numColumns).fill('')); },
      setValues(rows) { io.setValues++; rows.forEach((source, r) => source.forEach((value, c) => { data[row - 1 + r][column - 1 + c] = value; })); },
    };
  } };
  const imageColumns = Array.from({ length: 20 }, (_, index) => ({
    type: 10 + index * 3, path: 11 + index * 3, alt: 12 + index * 3,
  }));
  const context = { sheet, values: data, blocks, colMap: { PRODUCT_MGMT_NUM: 1, PRODUCT_NAME: 2,
    SKU_MGMT_NUM: 3, SYSTEM_SKU_NUM: 4, PC_DESC: 5, SP_DESC: 6, PC_SALES_DESC: 7 }, imageColumns,
    templates: { TEMPLATE_PC_DESC: '{{説明}}', TEMPLATE_SP_DESC: 'SP', TEMPLATE_PC_SALES: '販売' },
    choiceMap, imageUrlMap: {}, imagePathMap, imageMappingMap: {} };
  let updated = 0;
  for (let offset = 0; offset < blocks.length; offset += 200) {
    updated += gas.executeRakutenTemplateBatch_(context, blocks.slice(offset, offset + 200), null, 'time').updated;
  }
  const batches = Math.ceil(productCount / 200);
  assert.equal(updated, productCount);
  assert.equal(io.setValues, 2 * batches);
  assert.equal(io.getValues, 2 * batches);
  assert.equal(io.getFormulas, 2 * batches);
  assert.equal(io.getRange, 4 * batches);
});

test('computeRakutenTemplateSignature_ covers every input contract and ignores output cells', () => {
  const signatureGas = loadGas(['src/Config.js', 'src/DistributorRakuten.js'], {
    Utilities: {
      DigestAlgorithm: { SHA_256: 'sha' }, Charset: { UTF_8: 'utf8' },
      computeDigest(_algorithm, text) {
        let hash = 2166136261;
        for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
        return [hash & 255, (hash >>> 8) & 255, (hash >>> 16) & 255, (hash >>> 24) & 255];
      },
    },
  });
  const base = {
    templateRows: [['key', 'template']],
    choiceValues: [['管理コード', '説明'], ['sku', 'value']],
    imageUrlMap: { sku: ['url'] }, imagePathMap: { sku: ['path'] }, imageMappingMap: { sku: 'manual' },
    values: [['headers'], ['product', 'sku-mgmt', 'system-sku', 'html-output', 'image-output']],
    colMap: { PRODUCT_MGMT_NUM: 1, SKU_MGMT_NUM: 2, SYSTEM_SKU_NUM: 3 },
  };
  const sign = (mutate) => {
    const context = structuredClone(base);
    if (mutate) mutate(context);
    return signatureGas.computeRakutenTemplateSignature_(context);
  };
  const original = sign();
  const inputMutations = [
    (c) => { c.templateRows[0][1] = 'changed'; },
    (c) => { c.choiceValues[1][0] = 'choice-key'; },
    (c) => { c.choiceValues[1][1] = 'choice-value'; },
    (c) => { c.imageUrlMap.sku[0] = 'new-url'; },
    (c) => { c.imagePathMap.sku[0] = 'new-path'; },
    (c) => { c.imageMappingMap.sku = 'new-manual'; },
    (c) => { c.values[1][0] = 'new-product'; },
    (c) => { c.values[1][1] = 'new-sku-mgmt'; },
    (c) => { c.values[1][2] = 'new-system-sku'; },
  ];
  inputMutations.forEach((mutate) => assert.notEqual(sign(mutate), original));
  assert.equal(sign((c) => { c.values[1][3] = 'changed-html-output'; }), original);
  assert.equal(sign((c) => { c.values[1][4] = 'changed-image-output'; }), original);
});

test('job context performs one Rakuten full read and one Choice full read', () => {
  const headers = ['商品管理番号', '商品名', 'SKU管理番号', 'システム連携用SKU番号',
    'PC用商品説明文', 'スマートフォン用商品説明文', 'PC用販売説明文'];
  for (let i = 1; i <= 20; i++) headers.push(`商品画像タイプ${i}`, `商品画像パス${i}`, `商品画像名（ALT）${i}`);
  const counts = { rakuten: 0, choice: 0 };
  function countedSheet(values, key) {
    const sheet = createSheet(values);
    const original = sheet.getDataRange.bind(sheet);
    sheet.getDataRange = () => {
      const range = original();
      const getValues = range.getValues.bind(range);
      range.getValues = () => { counts[key]++; return getValues(); };
      if (key === 'rakuten') range.getFormulas = () => { throw new Error('full-sheet formulas are forbidden'); };
      return range;
    };
    return sheet;
  }
  const sheets = {
    rakuten_template: createSheet([['key', 'template'], ['TEMPLATE_PC_DESC', 'PC'], ['TEMPLATE_SP_DESC', 'SP'], ['TEMPLATE_PC_SALES', 'sales']]),
    choice_tsv: countedSheet([['管理コード'], ['sku']], 'choice'),
    rakuten_csv: countedSheet([headers, ['product', 'name'], ['product', '', 'sku-mgmt', 'sku']], 'rakuten'),
  };
  const readGas = loadGas(['src/Config.js', 'src/DistributorRakuten.js']);
  const context = readGas.loadRakutenTemplateJobContext_(createSpreadsheet(sheets));
  assert.deepEqual(counts, { rakuten: 1, choice: 1 });
  assert.equal(Object.hasOwn(context, 'formulas'), false);
});

test('eligible backup assessment keeps only one transient product plan for 10k rows', () => {
  const planGas = loadGas(['src/Config.js', 'src/DistributorRakuten.js']);
  let calls = 0;
  planGas.planRakutenTemplateProduct_ = () => { calls++; return { status: 'UPDATE' }; };
  const blocks = Array.from({ length: 1250 }, (_, index) => ({ startIndex: index * 8, endIndex: index * 8 + 7, skuIndices: [index * 8 + 1] }));
  const values = [[], ...Array.from({ length: 10000 }, () => ['', '', '', ''])];
  const choiceMap = {}, imagePathMap = {};
  blocks.forEach((block, index) => {
    values[block.startIndex + 1][0] = `product-${index}`;
    values[block.skuIndices[0] + 1][3] = `sku-${index}`;
    choiceMap[`sku-${index}`] = {};
    imagePathMap[`sku-${index}`] = ['path'];
  });
  const eligible = planGas.findEligibleRakutenTemplateBlocks_({ blocks, values,
    colMap: { PRODUCT_MGMT_NUM: 1, PRODUCT_NAME: 2, SYSTEM_SKU_NUM: 4 }, choiceMap,
    imageMappingMap: {}, imageUrlMap: {}, imagePathMap, templates: {} });
  assert.equal(calls, 1250);
  assert.equal(eligible.length, 1250);
  assert.equal(eligible.every((block) => !Object.hasOwn(block, 'mutations')), true);
});

test('backup formula reads are bounded by adjacent groups times 200-product chunks', () => {
  const blocks = Array.from({ length: 1250 }, (_, index) => ({ startIndex: index * 8 }));
  let rangeReads = 0;
  let formulaReads = 0;
  const sheet = {
    getDataRange() { throw new Error('full-sheet read forbidden'); },
    getRange(_row, _column, numRows, numColumns) {
      rangeReads++;
      return { getFormulas() { formulaReads++; return Array.from({ length: numRows }, () => Array(numColumns).fill('')); } };
    },
  };
  const overrides = gas.loadRakutenBackupFormulaOverrides_(sheet, blocks, [5, 6, 7, 10, 11, 12], 200);
  assert.equal(Object.keys(overrides).length, 0);
  assert.equal(rangeReads, 2 * Math.ceil(1250 / 200));
  assert.equal(formulaReads, 2 * Math.ceil(1250 / 200));
});

test('production resume starts from saved nextBlockIndex and completion cleans progress and trigger', () => {
  const checkpoint = JSON.stringify({ nextBlockIndex: 200, stats: { updated: 200, choiceMissing: 0, imageMissing: 0,
    otherSkipped: 0, charErrors: 0, mutationErrors: 0 }, signature: 'sig', backupFileId: 'backup' });
  const harness = createJobHarness({ blockCount: 250, properties: { RAKUTEN_TEMPLATE_PROGRESS: checkpoint } });
  const result = harness.gas.runRakutenTemplateInjectionJob_(true);
  assert.equal(harness.batches[0][0], 200);
  assert.equal(result.updated, 250);
  assert.equal(harness.properties.has('RAKUTEN_TEMPLATE_PROGRESS'), false);
  assert.equal(harness.triggerEvents.some((event) => event[0] === 'delete'), true);
});

test('production resume rejects signature changes with zero batch writes', () => {
  const checkpoint = JSON.stringify({ nextBlockIndex: 200, stats: {}, signature: 'old', backupFileId: 'backup' });
  const harness = createJobHarness({ blockCount: 250, signature: 'new', properties: { RAKUTEN_TEMPLATE_PROGRESS: checkpoint } });
  assert.throws(() => harness.gas.runRakutenTemplateInjectionJob_(true), /入力データが開始時から変更/);
  assert.equal(harness.batches.length, 0);
});

test('production guard failures perform zero mutations and preserve pending state', () => {
  const locked = createJobHarness({ blockCount: 1, lock: false });
  assert.throws(() => locked.gas.runRakutenTemplateInjectionJob_(false), /実行中/);
  assert.equal(locked.contextLoads, 0);
  assert.equal(locked.backupBlocks.length, 0);
  assert.equal(locked.batches.length, 0);
  assert.deepEqual(locked.lockEvents, ['try']);

  const savedValue = JSON.stringify({ nextBlockIndex: 4 });
  const saved = createJobHarness({ blockCount: 1, properties: { RAKUTEN_TEMPLATE_PROGRESS: savedValue } });
  assert.throws(() => saved.gas.runRakutenTemplateInjectionJob_(false), /実行中または再開待ち/);
  assert.equal(saved.contextLoads, 0);
  assert.equal(saved.properties.get('RAKUTEN_TEMPLATE_PROGRESS'), savedValue);
  assert.equal(saved.triggerEvents.length, 0);
  assert.deepEqual(saved.lockEvents, ['try', 'release']);

  const triggerOnly = createJobHarness({ blockCount: 1, pendingTrigger: true });
  assert.throws(() => triggerOnly.gas.runRakutenTemplateInjectionJob_(false), /実行中または再開待ち/);
  assert.equal(triggerOnly.contextLoads, 0);
  assert.equal(triggerOnly.backupBlocks.length, 0);
  assert.equal(triggerOnly.batches.length, 0);
  assert.equal(triggerOnly.triggerEvents.length, 0);
});

test('production job pauses before a batch and creates exactly one resume trigger', () => {
  const harness = createJobHarness({ blockCount: 2 });
  harness.gas.isRakutenTemplateTimeLimitReached_ = () => true;
  const result = harness.gas.runRakutenTemplateInjectionJob_(false);
  assert.equal(result.paused, true);
  assert.equal(harness.batches.length, 0);
  assert.equal(harness.triggerEvents.filter((event) => event[0] === 'new').length, 1);
  assert.equal(harness.triggerEvents.filter((event) => event[0] === 'create').length, 1);
  assert.equal(JSON.parse(harness.properties.get('RAKUTEN_TEMPLATE_PROGRESS')).nextBlockIndex, 0);
});

test('preprocessing that consumes the deadline pauses before any batch write', () => {
  let now = 0;
  class FakeDate extends Date { static now() { return now; } }
  const harness = createJobHarness({ blockCount: 2, Date: FakeDate });
  const originalBackup = harness.gas.backupRakutenTemplateTargets_;
  harness.gas.backupRakutenTemplateTargets_ = (...args) => {
    const result = originalBackup(...args);
    now = harness.gas.RAKUTEN_TEMPLATE_CONFIG_.TIME_LIMIT_MS;
    return result;
  };
  const result = harness.gas.runRakutenTemplateInjectionJob_(false);
  assert.equal(result.paused, true);
  assert.equal(harness.batches.length, 0);
  assert.equal(harness.triggerEvents.filter((event) => event[0] === 'new').length, 1);
  assert.equal(harness.triggerEvents.filter((event) => event[0] === 'create').length, 1);
});

test('production batch failure keeps checkpoint boundary and records cumulative mutation errors', () => {
  const harness = createJobHarness({ blockCount: 250, batchError: { at: 2, message: 'write failed' } });
  assert.throws(() => harness.gas.runRakutenTemplateInjectionJob_(false), /write failed/);
  const saved = JSON.parse(harness.properties.get('RAKUTEN_TEMPLATE_PROGRESS'));
  assert.equal(saved.nextBlockIndex, 200);
  assert.equal(saved.stats.updated, 200);
  assert.equal(saved.stats.mutationErrors, 50);
  assert.equal(saved.lastError, 'write failed');
});

test('backup failure aborts production job before any batch write', () => {
  const harness = createJobHarness({ blockCount: 1, backupError: 'backup failed' });
  assert.throws(() => harness.gas.runRakutenTemplateInjectionJob_(false), /backup failed/);
  assert.equal(harness.batches.length, 0);
});

test('production backup receives only eligible update targets', () => {
  const harness = createJobHarness({ blockCount: 3, ineligibleIndices: [1] });
  harness.gas.runRakutenTemplateInjectionJob_(false);
  assert.deepEqual(harness.backupBlocks.map((block) => block.startIndex), [0, 16]);
});

test('backupRakutenTemplateTargets_ writes BOM CSV with identifiers to parent and falls back to root', () => {
  function run(hasParent) {
    const headers = ['商品管理番号', 'システム連携用SKU番号', 'PC用商品説明文', 'スマートフォン用商品説明文', 'PC用販売説明文'];
    for (let i = 1; i <= 20; i++) headers.push(`商品画像タイプ${i}`, `商品画像パス${i}`, `商品画像名（ALT）${i}`);
    const row = ['product', '', 'pc', 'sp', 'sales'];
    for (let i = 1; i <= 20; i++) row.push(i === 1 ? 'CABINET' : '', i === 1 ? 'a.jpg' : '', i === 1 ? 'ALT' : '');
    const sku = ['', 'sku'];
    let created;
    const folder = { createFile(blob) { created = blob; return { getId: () => 'backup-id' }; } };
    const backupGas = loadGas(['src/Config.js', 'src/DistributorRakuten.js'], {
      Utilities: { newBlob: (content, type, name) => ({ content, type, name }), formatDate: () => 'stamp' },
      DriveApp: {
        getFileById: () => ({ getParents: () => ({ hasNext: () => hasParent, next: () => folder }) }),
        getRootFolder: () => folder,
      },
    });
    const sourceValues = [headers, row, sku];
    let formulaReads = 0;
    const sheet = {
      getDataRange: () => { throw new Error('backup must not reread Rakuten values'); },
      getRange(rowNumber, column, numRows, numColumns) { return { getFormulas() {
        formulaReads++;
        return Array.from({ length: numRows }, (_, rowOffset) => Array.from({ length: numColumns }, (_, columnOffset) =>
          rowNumber + rowOffset === 2 && column + columnOffset === 3 ? '=A2&"-pc"' : ''));
      } }; },
    };
    const id = backupGas.backupRakutenTemplateTargets_({ getId: () => 'ss' }, sheet,
      [{ startIndex: 0, endIndex: 1, skuIndices: [1] }],
      { PRODUCT_MGMT_NUM: 1, SYSTEM_SKU_NUM: 2, PC_DESC: 3, SP_DESC: 4, PC_SALES_DESC: 5 },
      sourceValues);
    assert.equal(id, 'backup-id');
    assert.equal(created.content.startsWith('\uFEFF'), true);
    assert.equal(created.content.includes('2,product,sku,"=A2&""-pc""",sp,sales,CABINET,a.jpg,ALT'), true);
    assert.equal(formulaReads, 1);
  }
  run(true);
  run(false);
});

test('applyRakutenTemplateBatchWrites_ rolls back completed groups when a later group fails', () => {
  const calls = [];
  let failed = false;
  const sheet = { getRange(row, column) { return { setValues(values) {
    calls.push([row, column, plain(values)]);
    if (column === 10 && !failed) { failed = true; throw new Error('later failed'); }
  } }; } };
  assert.throws(() => gas.applyRakutenTemplateBatchWrites_(sheet, [
    { row: 2, column: 5, numRows: 1, numColumns: 1, values: [['new-html']] },
    { row: 2, column: 10, numRows: 1, numColumns: 1, values: [['new-image']] },
  ], [
    { row: 2, column: 5, numRows: 1, numColumns: 1, values: [['old-html']] },
    { row: 2, column: 10, numRows: 1, numColumns: 1, values: [['old-image']] },
  ]), /later failed/);
  assert.deepEqual(calls, [[2, 5, [['new-html']]], [2, 10, [['new-image']]], [2, 5, [['old-html']]]]);
});

test('applyRakutenTemplateBatchWrites_ reports rollback failure', () => {
  let call = 0;
  const sheet = { getRange() { return { setValues() {
    call++;
    if (call === 2) throw new Error('write failed');
    if (call === 3) throw new Error('rollback failed');
  } }; } };
  assert.throws(() => gas.applyRakutenTemplateBatchWrites_(sheet, [
    { row: 2, column: 5, numRows: 1, numColumns: 1, values: [['new']] },
    { row: 2, column: 10, numRows: 1, numColumns: 1, values: [['new']] },
  ], [
    { row: 2, column: 5, numRows: 1, numColumns: 1, values: [['old']] },
    { row: 2, column: 10, numRows: 1, numColumns: 1, values: [['old']] },
  ]), /write failed \/ ロールバック失敗: rollback failed/);
});

test('rebuilding the same product plan is idempotent', () => {
  const input = { templates: { TEMPLATE_PC_DESC: 'PC', TEMPLATE_SP_DESC: 'SP', TEMPLATE_PC_SALES: '販売' },
    choiceData: { '（必須）お礼の品名': '商品' }, imagePaths: ['a.jpg'], imageUrls: ['u1', 'u2'] };
  assert.deepEqual(plain(gas.planRakutenTemplateProduct_(input)), plain(gas.planRakutenTemplateProduct_(input)));
});

test('buildRakutenTemplatePlans_ classifies preview Choice/image skips and emits reason logs without plans', () => {
  const base = {
    values: [['header'], ['product'], ['sku']],
    colMap: { PRODUCT_MGMT_NUM: 1, SYSTEM_SKU_NUM: 1 }, choiceMap: {}, imageMappingMap: {},
    imageUrlMap: {}, imagePathMap: {}, templates: {}, imageColumns: [],
  };
  const block = { startIndex: 0, endIndex: 1, skuIndices: [1] };
  let actual = gas.buildRakutenTemplatePlans_(base, [block], 'time');
  assert.equal(actual.stats.choiceMissing, 1);
  assert.equal(actual.plans.length, 0);
  assert.equal(actual.logs[0][3].includes('Choiceデータなし'), true);
  base.choiceMap.sku = {};
  actual = gas.buildRakutenTemplatePlans_(base, [block], 'time');
  assert.equal(actual.stats.imageMissing, 1);
  assert.equal(actual.logs[0][3].includes('新画像なし'), true);
});

test('production preview surfaces a skip reason in the result UI', () => {
  const alerts = [];
  const events = [];
  const previewGas = loadGas(['src/Config.js', 'src/DistributorRakuten.js'], {
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ({}),
      getUi: () => ({ ButtonSet: { OK: 'OK' }, alert: (...args) => { events.push('alert'); alerts.push(args); } }),
      flush() {},
    },
    Utilities: { formatDate: () => 'time' },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => events.push('release') }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => null }) },
    ScriptApp: { getProjectTriggers: () => [] },
  });
  previewGas.loadRakutenTemplateJobContext_ = () => ({ blocks: [{}] });
  previewGas.ensureRakutenLogSheet_ = () => ({});
  previewGas.executeRakutenTemplateBatch_ = () => ({ updated: 0, choiceMissing: 1, imageMissing: 0,
    otherSkipped: 0, charErrors: 0, mutationErrors: 0 });
  const result = previewGas.runRakutenTemplatePreview_();
  assert.equal(result.updated, 0);
  assert.equal(alerts[0][1].includes('Choiceデータなし'), true);
  assert.equal(events.indexOf('release') < events.indexOf('alert'), true);
});

test('production preview rejects lock contention and pending work without mutation', () => {
  function run(lockResult, progress, trigger) {
    const events = [];
    const previewGas = loadGas(['src/Config.js', 'src/DistributorRakuten.js'], {
      SpreadsheetApp: { getActiveSpreadsheet: () => { events.push('context'); return {}; }, getUi: () => ({ ButtonSet: { OK: 'OK' }, alert() { events.push('alert'); } }) },
      LockService: { getScriptLock: () => ({ tryLock: () => lockResult, releaseLock: () => events.push('release') }) },
      PropertiesService: { getScriptProperties: () => ({ getProperty: () => progress }) },
      ScriptApp: { getProjectTriggers: () => trigger ? [{ getHandlerFunction: () => 'resumeRakutenTemplateInjection' }] : [] },
    });
    assert.throws(() => previewGas.runRakutenTemplatePreview_(), /実行中/);
    return events;
  }
  assert.deepEqual(run(false, null, false), []);
  assert.deepEqual(run(true, '{}', false), ['release']);
  assert.deepEqual(run(true, null, true), ['release']);
});

test('applyTemplateInjection confirms before locking, cancels cleanly, and rejects pending progress', () => {
  function run(button, pending) {
    const events = [];
    const ui = { Button: { OK: 'OK', CANCEL: 'CANCEL' }, ButtonSet: { OK_CANCEL: 'OK_CANCEL', OK: 'OK' },
      alert(...args) { events.push(['alert', args[0]]); return events.length === 1 ? button : undefined; } };
    const props = new Map(pending ? [['RAKUTEN_TEMPLATE_PROGRESS', '{}']] : []);
    const applyGas = loadGas(['src/Config.js', 'src/DistributorRakuten.js'], {
      SpreadsheetApp: { getUi: () => ui, getActiveSpreadsheet: () => ({}), flush() {} },
      LockService: { getScriptLock: () => ({ tryLock() { events.push(['lock']); return true; }, releaseLock() { events.push(['release']); } }) },
      PropertiesService: { getScriptProperties: () => ({
        getProperty: (key) => props.get(key) || null, setProperty: (key, value) => props.set(key, value), deleteProperty: (key) => props.delete(key),
      }) },
      ScriptApp: { getProjectTriggers: () => [] },
      Utilities: { formatDate: () => 'time' },
      deleteTriggersByFunction_: () => {}, completeOperation_: () => events.push(['complete']),
    });
    applyGas.loadRakutenTemplateJobContext_ = () => ({ blocks: [], values: [], colMap: {}, templates: {}, choiceMap: {},
      imageUrlMap: {}, imagePathMap: {}, imageMappingMap: {}, templateRows: [], choiceValues: [], sheet: {} });
    applyGas.computeRakutenTemplateSignature_ = () => 'sig';
    applyGas.buildRakutenTemplatePlans_ = () => ({ plans: [] });
    applyGas.backupRakutenTemplateTargets_ = () => 'backup';
    applyGas.ensureRakutenLogSheet_ = () => ({});
    applyGas.applyTemplateInjection();
    return events;
  }
  assert.deepEqual(run('CANCEL', false), [['alert', 'HTMLテンプレート差込（楽天）']]);
  const success = run('OK', false);
  assert.equal(success.findIndex((event) => event[0] === 'alert') < success.findIndex((event) => event[0] === 'lock'), true);
  assert.equal(success.findIndex((event) => event[0] === 'release') < success.findIndex((event) => event[0] === 'complete'), true);
  const pending = run('OK', true);
  assert.equal(pending.some((event) => event[0] === 'lock'), true);
  assert.equal(pending.some((event) => event[0] === 'release'), true);
});

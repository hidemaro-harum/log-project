const test = require('node:test');
const assert = require('node:assert/strict');
const { loadGas } = require('./load-gas');
const plain = (v) => JSON.parse(JSON.stringify(v));

const mappingRows = [
  ['商品管理番号（商品URL）','旧商品番号','新商品番号','旧システム連携用SKU番号','新システム連携用SKU番号','SKU区分','備考','検証結果'],
  ['url-single','old-1','new-1','old-1','new-1','シングル','',''],
  ['url-multi','old-m','new-m','old-a','new-a','マルチ','',''],
  ['url-multi','old-m','new-m','old-b','new-b','マルチ','',''],
];

const rakutenRowsForAutoFill = [
  ['商品管理番号（商品URL）','商品番号','商品名','選択肢タイプ','SKU管理番号','システム連携用SKU番号'],
  ['url-single','old-1','商品1','','',''],
  ['url-single','','','','sku-1','old-1'],
  ['url-multi','old-m','商品M','','',''],
  ['url-multi','','','','sku-a','old-a'],
  ['url-multi','','','','sku-b','old-b'],
];

test('planNumberMappingAutoFill_ fills URL and detects single or multi SKU', () => {
  const gas = loadGas(['src/NumberMigration.js']);
  const blankMapping = [
    mappingRows[0],
    ['', 'old-1', 'new-1', 'old-1', 'new-1', '', '', ''],
    ['', 'old-m', 'new-m', 'old-a', 'new-a', '', '', ''],
    ['', 'old-m', 'new-m', 'old-b', 'new-b', '', '', ''],
  ];

  const plan = gas.planNumberMappingAutoFill_(blankMapping, rakutenRowsForAutoFill);

  assert.deepEqual(plain(plan.errors), []);
  assert.deepEqual(plain(plan.changes.map(change => [change.row, change.header, change.to])), [
    [2, '商品管理番号（商品URL）', 'url-single'],
    [2, 'SKU区分', 'シングル'],
    [3, '商品管理番号（商品URL）', 'url-multi'],
    [3, 'SKU区分', 'マルチ'],
    [4, '商品管理番号（商品URL）', 'url-multi'],
    [4, 'SKU区分', 'マルチ'],
  ]);
  assert.equal(plan.targetCount, 3);
  assert.equal(plan.alreadyFilled, 0);
});

test('planNumberMappingAutoFill_ keeps matching existing values idempotently', () => {
  const gas = loadGas(['src/NumberMigration.js']);
  const plan = gas.planNumberMappingAutoFill_([mappingRows[0], mappingRows[1]], rakutenRowsForAutoFill);

  assert.deepEqual(plain(plan.errors), []);
  assert.deepEqual(plain(plan.changes), []);
  assert.equal(plan.alreadyFilled, 1);
});

test('planNumberMappingAutoFill_ marks an inferable single SKU missing from Rakuten as skipped', () => {
  const gas = loadGas(['src/NumberMigration.js']);
  const mapping = [
    mappingRows[0],
    ['', 'old-x', 'new-x', 'old-x', 'new-x', '', '', ''],
  ];

  const plan = gas.planNumberMappingAutoFill_(mapping, rakutenRowsForAutoFill);

  assert.deepEqual(plain(plan.errors), []);
  assert.deepEqual(plain(plan.warnings), [
    '2行目: 楽天CSVに存在しないため楽天番号移行をスキップ',
  ]);
  assert.equal(plan.skipped, 1);
  assert.deepEqual(plain(plan.changes.map(change => [change.header, change.to])), [
    ['SKU区分', 'シングル'],
    ['備考', '[楽天CSV対象外]'],
  ]);
});

test('planNumberMappingAutoFill_ accepts a product number equal to one multi SKU and normalizes product numbers', () => {
  const gas = loadGas(['src/NumberMigration.js']);
  const mapping = [
    mappingRows[0],
    ['', 'AX001', '195956-0001', 'AX001', '195956-0001', '', '', ''],
    ['', 'AX002', '195956-0002', 'AX002', '195956-0002', '', '', ''],
    ['', 'AX003', '195956-0003', 'AX003', '195956-0003', '', '', ''],
  ];
  const rakuten = [
    rakutenRowsForAutoFill[0],
    ['ax001', 'AX001', '商品', '', '', ''],
    ['ax001', '', '', '', 'ax001', 'AX001'],
    ['ax001', '', '', '', 'ax002', 'AX002'],
    ['ax001', '', '', '', 'ax003', 'AX003'],
  ];

  const plan = gas.planNumberMappingAutoFill_(mapping, rakuten);

  assert.deepEqual(plain(plan.errors), []);
  assert.deepEqual(
    plain(plan.changes.filter(c => c.header === '旧商品番号' || c.header === '新商品番号')
      .map(c => [c.row, c.header, c.to])),
    [
      [3, '旧商品番号', 'AX001'],
      [3, '新商品番号', '195956-0001'],
      [4, '旧商品番号', 'AX001'],
      [4, '新商品番号', '195956-0001'],
    ]
  );
  assert.equal(plan.changes.some(c => /SKU番号/.test(c.header)), false);
});

test('planNumberMappingAutoFill_ normalizes a dedicated multi product number without requiring a SKU anchor', () => {
  const gas = loadGas(['src/NumberMigration.js']);
  const mapping = [
    mappingRows[0],
    ['', 'AQ009MP', 'new-aq009mp', 'AQ009-A', 'new-a', '', '', ''],
    ['', 'AQ009-B', 'new-b', 'AQ009-B', 'new-b', '', '', ''],
  ];
  const rakuten = [
    rakutenRowsForAutoFill[0],
    ['aq009', 'AQ009MP', '商品', '', '', ''],
    ['aq009', '', '', '', 'aq009-a', 'AQ009-A'],
    ['aq009', '', '', '', 'aq009-b', 'AQ009-B'],
  ];

  const plan = gas.planNumberMappingAutoFill_(mapping, rakuten);

  assert.deepEqual(plain(plan.errors), []);
  assert.deepEqual(
    plain(plan.changes.filter(c => c.header === '旧商品番号' || c.header === '新商品番号')
      .map(c => [c.row, c.header, c.to])),
    [
      [3, '旧商品番号', 'AQ009MP'],
      [3, '新商品番号', 'new-aq009mp'],
    ]
  );
});

test('planNumberMappingAutoFill_ rejects a multi SKU group without its product-number anchor', () => {
  const gas = loadGas(['src/NumberMigration.js']);
  const mapping = [
    mappingRows[0],
    ['', 'AX002', '195956-0002', 'AX002', '195956-0002', '', '', ''],
    ['', 'AX003', '195956-0003', 'AX003', '195956-0003', '', '', ''],
  ];
  const rakuten = [
    rakutenRowsForAutoFill[0],
    ['ax001', 'AX001', '商品', '', '', ''],
    ['ax001', '', '', '', 'ax001', 'AX001'],
    ['ax001', '', '', '', 'ax002', 'AX002'],
    ['ax001', '', '', '', 'ax003', 'AX003'],
  ];

  const plan = gas.planNumberMappingAutoFill_(mapping, rakuten);

  assert.deepEqual(plain(plan.errors.filter(error => /同一商品の対照表に楽天CSVのSKUが不足/.test(error))), [
    '2行目: 同一商品の対照表に楽天CSVのSKUが不足しています: AX001',
    '3行目: 同一商品の対照表に楽天CSVのSKUが不足しています: AX001',
  ]);
  assert.equal(plan.errors.some(error => /商品番号兼SKUとして対照表に追加/.test(error)), false);
});

test('planNumberMappingAutoFill_ rejects conflicts, missing SKU, duplicate SKU, and blank Rakuten URL', () => {
  const gas = loadGas(['src/NumberMigration.js']);
  const mapping = [
    mappingRows[0],
    ['wrong-url', 'old-1', 'new-1', 'old-1', 'new-1', 'マルチ', '', ''],
    ['', 'old-product-x', 'new-product-x', 'old-x', 'new-x', '', '', ''],
    ['', 'old-a', 'new-a', 'old-a', 'new-a', '', '', ''],
    ['', 'old-z', 'new-z', 'old-z', 'new-z', '', '', ''],
  ];
  const rakuten = rakutenRowsForAutoFill.concat([
    ['url-other', '', '', '', 'sku-duplicate', 'old-a'],
    ['', '', '', '', 'sku-blank-url', 'old-z'],
  ]);

  const plan = gas.planNumberMappingAutoFill_(mapping, rakuten);

  assert.ok(plan.errors.some(error => /2行目/.test(error) && /不一致/.test(error)));
  assert.ok(plan.errors.some(error => /3行目/.test(error) && /見つかりません/.test(error)));
  assert.ok(plan.errors.some(error => /4行目/.test(error) && /複数/.test(error)));
  assert.ok(plan.errors.some(error => /5行目/.test(error) && /空欄/.test(error)));
});

test('buildNumberMappingValidationValues_ groups multiple errors by mapping row', () => {
  const gas = loadGas(['src/NumberMigration.js']);
  const values = gas.buildNumberMappingValidationValues_(4, [
    '2行目: URLが不一致',
    '2行目: SKU区分が不一致',
    '4行目: SKUが見つかりません',
    '必須ヘッダー不足: SKU区分',
  ]);

  assert.deepEqual(plain(values), [
    ['URLが不一致\nSKU区分が不一致'],
    [''],
    ['SKUが見つかりません'],
  ]);
});

test('autoFillNumberMappingFromRakuten does not update URL or SKU type when planning has errors', () => {
  const mapping = [
    mappingRows[0],
    ['wrong-url', 'old-1', 'new-1', 'old-1', 'new-1', 'マルチ', '', ''],
  ];
  const writes = [];
  const mappingSheet = {
    getDataRange() { return { getValues: () => plain(mapping) }; },
    getRange(row, column, numRows, numColumns) {
      return { setValues(values) { writes.push({ row, column, numRows, numColumns, values }); } };
    },
  };
  const rakutenSheet = {
    getDataRange() { return { getValues: () => plain(rakutenRowsForAutoFill) }; },
  };
  const spreadsheet = {
    getSheetByName(name) {
      if (name === 'number_mapping') return mappingSheet;
      if (name === 'rakuten_csv') return rakutenSheet;
      return null;
    },
  };
  const gas = loadGas(['src/Config.js', 'src/NumberMigration.js'], {
    SpreadsheetApp: {
      getActiveSpreadsheet: () => spreadsheet,
      getUi: () => ({ ButtonSet: { OK: 'OK' }, alert() {} }),
    },
  });
  gas.recordOperationResult_ = () => {};
  gas.notifyMessage_ = () => {};

  gas.autoFillNumberMappingFromRakuten();

  assert.deepEqual(writes.map(write => write.column), [8]);
});

test('parseNumberMapping_ validates and indexes single and multi SKU rows', () => {
  const gas = loadGas(['src/NumberMigration.js']);
  const parsed = gas.parseNumberMapping_(mappingRows);
  assert.deepEqual(plain(parsed.errors), []);
  assert.equal(parsed.byUrl['url-multi'].rows.length, 2);
  assert.equal(parsed.byOldSku['old-a'].newSku, 'new-a');
});

test('parseNumberMapping_ allows a shared multi product number to equal one SKU number', () => {
  const gas = loadGas(['src/NumberMigration.js']);
  const parsed = gas.parseNumberMapping_([
    mappingRows[0],
    ['ax001', 'AX001', '195956-0001', 'AX001', '195956-0001', 'マルチ', '', ''],
    ['ax001', 'AX001', '195956-0001', 'AX002', '195956-0002', 'マルチ', '', ''],
  ]);

  assert.deepEqual(plain(parsed.errors), []);
});

test('parseNumberMapping_ keeps a marked Rakuten-excluded SKU for Choice and ANA without requiring URL', () => {
  const gas = loadGas(['src/NumberMigration.js']);
  const parsed = gas.parseNumberMapping_([
    mappingRows[0],
    ['', 'old-x', 'new-x', 'old-x', 'new-x', 'シングル', '[楽天CSV対象外]', ''],
  ]);

  assert.deepEqual(plain(parsed.errors), []);
  assert.deepEqual(plain(parsed.warnings), ['2行目: 楽天CSV対象外としてスキップ']);
  assert.equal(parsed.byOldSku['old-x'].newSku, 'new-x');
  assert.deepEqual(plain(parsed.byUrl), {});
});

test('parseNumberMapping_ rejects a SKU used as another row new and old number', () => {
  const gas = loadGas(['src/NumberMigration.js']);
  const mappingData = [
    mappingRows[0],
    ['url-chain', 'old-product', 'new-product', 'A', 'B', 'マルチ', '', ''],
    ['url-chain', 'old-product', 'new-product', 'B', 'C', 'マルチ', '', ''],
  ];
  const parsed = gas.parseNumberMapping_(mappingData);

  assert.ok(parsed.errors.some(error =>
    /3行目/.test(error) && /B/.test(error) && /2行目/.test(error) && /判定できません/.test(error)
  ));

  const plan = gas.planRakutenNumberMigration_([
    ['商品管理番号（商品URL）','商品番号','商品名','選択肢タイプ','SKU管理番号','システム連携用SKU番号'],
    ['url-chain', 'old-product', '商品', '', '', ''],
    ['url-chain', '', '', '', 'sku-b', 'B'],
  ], parsed);
  assert.deepEqual(plain(plan.changes), []);
  assert.ok(plan.errors.some(error => /旧・新を判定できません/.test(error)));
});

test('parseNumberMapping_ allows one row to keep the same old and new SKU number', () => {
  const gas = loadGas(['src/NumberMigration.js']);
  const parsed = gas.parseNumberMapping_([
    mappingRows[0],
    ['url-stable', 'stable', 'stable', 'stable', 'stable', 'シングル', '', ''],
  ]);

  assert.deepEqual(plain(parsed.errors), []);
});

test('parseNumberMapping_ rejects overlong numbers and product-number collisions', () => {
  const gas = loadGas(['src/NumberMigration.js']);
  const overlong = 'x'.repeat(33);
  const parsed = gas.parseNumberMapping_([
    mappingRows[0],
    ['url-1', 'old-1', 'same-new', 'old-1', 'same-new', 'シングル', '', ''],
    ['url-2', 'old-2', 'same-new', 'old-2', 'same-new', 'シングル', '', ''],
    ['url-3', overlong, overlong, overlong, overlong, 'シングル', '', ''],
  ]);

  assert.ok(parsed.errors.some(error => /same-new/.test(error) && /重複/.test(error)));
  assert.ok(parsed.errors.some(error => /4行目/.test(error) && /32文字/.test(error)));
});

test('parseNumberMapping_ applies the Rakuten 32-byte limit to multibyte numbers', () => {
  const gas = loadGas(['src/NumberMigration.js']);
  const multibyte = 'あ'.repeat(11); // UTF-8で33バイト
  const parsed = gas.parseNumberMapping_([
    mappingRows[0],
    ['url-multibyte', multibyte, multibyte, multibyte, multibyte, 'シングル', '', ''],
  ]);

  assert.ok(parsed.errors.some(error => /32バイト/.test(error)));
});

test('parseNumberMapping_ ignores rows that only contain the Choice guide in later columns', () => {
  const gas = loadGas(['src/NumberMigration.js']);
  const guideOnlyRow = ['', '', '', '', '', '', '', '', '', 'Choiceの説明'];
  const parsed = gas.parseNumberMapping_([mappingRows[0], mappingRows[1], guideOnlyRow]);

  assert.deepEqual(plain(parsed.errors), []);
  assert.equal(parsed.rows.length, 1);
});

test('parseNumberMapping_ reports no data when only the Choice guide exists', () => {
  const gas = loadGas(['src/NumberMigration.js']);
  const guideOnlyRow = ['', '', '', '', '', '', '', '', '', 'Choiceの説明'];
  const parsed = gas.parseNumberMapping_([mappingRows[0], guideOnlyRow]);

  assert.ok(parsed.errors.some(error => /データがありません/.test(error)));
});

test('planRakutenNumberMigration_ changes only product number and system SKU idempotently', () => {
  const gas = loadGas(['src/NumberMigration.js']);
  const mapping = gas.parseNumberMapping_(mappingRows);
  const headers = ['商品管理番号（商品URL）','商品番号','商品名','選択肢タイプ','SKU管理番号','システム連携用SKU番号'];
  const data = [headers,
    ['url-single','old-1','商品1','','',''],
    ['url-single','','','','sku-keep-1','old-1'],
    ['url-multi','old-m','商品M','','',''],
    ['url-multi','','','','sku-keep-a','old-a'],
    ['url-multi','','','','sku-keep-b','new-b'],
  ];
  const plan = gas.planRakutenNumberMigration_(data, mapping);
  assert.deepEqual(plain(plan.errors), []);
  assert.deepEqual(plain(plan.changes.map(c => [c.row, c.header, c.from, c.to])), [
    [2,'商品番号','old-1','new-1'], [3,'システム連携用SKU番号','old-1','new-1'],
    [4,'商品番号','old-m','new-m'], [5,'システム連携用SKU番号','old-a','new-a'],
  ]);
  assert.equal(data[2][4], 'sku-keep-1');
  assert.equal(plan.alreadyConverted, 1);
});

test('planRakutenNumberMigration_ works without a product-name column', () => {
  const gas = loadGas(['src/NumberMigration.js']);
  const mapping = gas.parseNumberMapping_([mappingRows[0], mappingRows[1]]);
  const data = [
    ['商品管理番号（商品URL）','商品番号','選択肢タイプ','SKU管理番号','システム連携用SKU番号'],
    ['url-single','old-1','','',''],
    ['url-single','','','sku-1','old-1'],
  ];

  const plan = gas.planRakutenNumberMigration_(data, mapping);

  assert.deepEqual(plain(plan.errors), []);
  assert.deepEqual(plain(plan.changes.map(c => [c.row, c.header, c.to])), [
    [2, '商品番号', 'new-1'],
    [3, 'システム連携用SKU番号', 'new-1'],
  ]);
});

test('planRakutenNumberMigration_ ignores products not listed in number_mapping', () => {
  const gas = loadGas(['src/NumberMigration.js']);
  const mapping = gas.parseNumberMapping_([mappingRows[0], mappingRows[1]]);
  const data = [
    ['商品管理番号（商品URL）','商品番号','選択肢タイプ','SKU管理番号','システム連携用SKU番号'],
    ['url-other','other-item','','',''],
    ['url-other','','','other-sku','other-sku'],
    ['url-single','old-1','','',''],
    ['url-single','','','sku-1','old-1'],
  ];

  const plan = gas.planRakutenNumberMigration_(data, mapping);

  assert.deepEqual(plain(plan.errors), []);
  assert.equal(plan.targetCount, 2);
  assert.deepEqual(plain(plan.changes.map(c => [c.row, c.header, c.to])), [
    [4, '商品番号', 'new-1'],
    [5, 'システム連携用SKU番号', 'new-1'],
  ]);
});

test('planRakutenNumberMigration_ rejects a product whose SKU count differs from the mapping', () => {
  const gas = loadGas(['src/NumberMigration.js']);
  const mapping = gas.parseNumberMapping_(mappingRows);
  const plan = gas.planRakutenNumberMigration_([
    ['商品管理番号（商品URL）','商品番号','商品名','選択肢タイプ','SKU管理番号','システム連携用SKU番号'],
    ['url-multi', 'old-m', '商品M', '', '', ''],
    ['url-multi', '', '', '', 'sku-a', 'old-a'],
  ], mapping);

  assert.ok(plan.errors.some(error => /SKU件数/.test(error)));
});

test('buildRakutenMigrationTargetProjection_ preserves target blocks and reports source indices and stats', () => {
  const gas = loadGas(['src/NumberMigration.js']);
  const mapping = gas.parseNumberMapping_(mappingRows);
  const data = [
    ['任意列','商品管理番号（商品URL）','商品番号','選択肢タイプ','SKU管理番号','システム連携用SKU番号'],
    ['keep-single','url-single','new-1','','',''],
    ['single-option','url-single','','SELECT','',''],
    ['single-sku','url-single','','','sku-1','new-1'],
    ['single-blank','','','','',''],
    ['drop-product','url-other','other','','',''],
    ['drop-sku','url-other','','','other-sku','other'],
    ['keep-multi','url-multi','new-m','','',''],
    ['multi-option','url-multi','','SELECT','',''],
    ['multi-sku-a','url-multi','','','sku-a','new-a'],
    ['multi-sku-b','url-multi','','','sku-b','new-b'],
    ['multi-blank','','','','',''],
  ];
  const originalData = plain(data);
  const originalMapping = plain(mapping);

  const result = gas.buildRakutenMigrationTargetProjection_(data, mapping);

  assert.deepEqual(plain(result.errors), []);
  assert.deepEqual(plain(result.sourceRowIndices), [0, 1, 2, 3, 4, 7, 8, 9, 10, 11]);
  assert.deepEqual(plain(result.data.map(row => row[0])), [
    '任意列', 'keep-single', 'single-option', 'single-sku', 'single-blank',
    'keep-multi', 'multi-option', 'multi-sku-a', 'multi-sku-b', 'multi-blank',
  ]);
  assert.equal(result.retainedProductCount, 2);
  assert.equal(result.retainedRowCount, 9);
  assert.equal(result.excludedProductCount, 1);
  assert.equal(result.excludedRowCount, 2);
  assert.deepEqual(data, originalData);
  assert.deepEqual(plain(mapping), originalMapping);
});

test('buildRakutenMigrationTargetProjection_ counts leading blank and orphan rows as excluded', () => {
  const gas = loadGas(['src/NumberMigration.js']);
  const mapping = gas.parseNumberMapping_([mappingRows[0], mappingRows[1]]);
  const data = [
    ['商品管理番号（商品URL）','商品番号','選択肢タイプ','SKU管理番号','システム連携用SKU番号'],
    ['', '', '', '', ''],
    ['orphan-url', '', '', 'orphan-sku', 'orphan-number'],
    ['url-single', 'new-1', '', '', ''],
    ['url-single', '', '', 'sku-1', 'new-1'],
  ];

  const result = gas.buildRakutenMigrationTargetProjection_(data, mapping);

  assert.deepEqual(plain(result.errors), []);
  assert.deepEqual(plain(result.data), [data[0], data[3], data[4]]);
  assert.deepEqual(plain(result.sourceRowIndices), [0, 3, 4]);
  assert.equal(result.retainedProductCount, 1);
  assert.equal(result.retainedRowCount, 2);
  assert.equal(result.excludedProductCount, 0);
  assert.equal(result.excludedRowCount, 2);
  assert.equal(result.retainedRowCount + result.excludedRowCount, data.length - 1);
});

test('buildRakutenMigrationTargetProjection_ works without 商品名 and keeps complete arbitrary-column rows', () => {
  const gas = loadGas(['src/NumberMigration.js']);
  const mapping = gas.parseNumberMapping_([mappingRows[0], mappingRows[2], mappingRows[3]]);
  const data = [
    ['商品番号','任意列','SKU管理番号','商品管理番号（商品URL）','システム連携用SKU番号','選択肢タイプ'],
    ['new-m','product','','url-multi','',''],
    ['','option','','url-multi','','SELECT'],
    ['','sku-a','sku-a','url-multi','new-a',''],
    ['','sku-b','sku-b','url-multi','new-b',''],
    ['','blank','','','',''],
  ];

  const result = gas.buildRakutenMigrationTargetProjection_(data, mapping);

  assert.deepEqual(plain(result.errors), []);
  assert.deepEqual(plain(result.data), data);
  assert.deepEqual(plain(result.sourceRowIndices), [0, 1, 2, 3, 4, 5]);
  assert.equal(result.retainedProductCount, 1);
  assert.equal(result.retainedRowCount, 5);
  assert.equal(result.excludedProductCount, 0);
  assert.equal(result.excludedRowCount, 0);
});

test('buildRakutenMigrationTargetProjection_ reports missing and duplicate mapped product blocks', () => {
  const gas = loadGas(['src/NumberMigration.js']);
  const mapping = gas.parseNumberMapping_(mappingRows);
  const data = [
    ['商品管理番号（商品URL）','商品番号','選択肢タイプ','SKU管理番号','システム連携用SKU番号'],
    ['url-single','new-1','','',''],
    ['url-single','','','sku-1','new-1'],
    ['url-single','new-1','','',''],
    ['url-single','','','sku-2','new-1'],
  ];

  const result = gas.buildRakutenMigrationTargetProjection_(data, mapping);

  assert.ok(result.errors.some(error => /url-single/.test(error) && /商品ブロックが2件/.test(error)));
  assert.ok(result.errors.some(error => /url-multi/.test(error) && /見つかりません/.test(error)));
  assert.equal(result.retainedProductCount, 2);
  assert.equal(result.retainedRowCount, 4);
  assert.equal(result.excludedProductCount, 0);
  assert.equal(result.excludedRowCount, 0);
});

test('buildRakutenMigrationTargetProjection_ validates required headers but not 商品名', () => {
  const gas = loadGas(['src/NumberMigration.js']);
  const mapping = gas.parseNumberMapping_([mappingRows[0], mappingRows[1]]);

  const result = gas.buildRakutenMigrationTargetProjection_([['商品番号']], mapping);

  assert.ok(result.errors.some(error => /必須ヘッダー不足: 商品管理番号/.test(error)));
  assert.deepEqual(plain(result.data), []);
  assert.deepEqual(plain(result.sourceRowIndices), []);
});

test('planRakutenInPlaceMigration_ converts only retained blocks without mutating input', () => {
  const gas = loadGas(['src/NumberMigration.js']);
  const mapping = gas.parseNumberMapping_(mappingRows);
  const data = [
    ['商品管理番号（商品URL）','商品番号','選択肢タイプ','SKU管理番号','システム連携用SKU番号','任意列'],
    ['url-single','old-1','','','','keep-product'],
    ['url-single','','','sku-1','old-1','keep-sku'],
    ['url-other','other','','','','drop-product'],
    ['url-other','','','other-sku','other','drop-sku'],
    ['url-multi','old-m','','','','keep-multi'],
    ['url-multi','','','sku-a','old-a','keep-a'],
    ['url-multi','','','sku-b','new-b','keep-b'],
  ];
  const original = plain(data);

  const plan = gas.planRakutenInPlaceMigration_(data, mapping);

  assert.deepEqual(plain(plan.errors), []);
  assert.deepEqual(plain(plan.outputData.map(row => row[5])), [
    '任意列', 'keep-product', 'keep-sku', 'keep-multi', 'keep-a', 'keep-b',
  ]);
  assert.deepEqual(plain(plan.outputData.map(row => [row[1], row[4]])), [
    ['商品番号','システム連携用SKU番号'],
    ['new-1',''], ['', 'new-1'], ['new-m',''], ['', 'new-a'], ['', 'new-b'],
  ]);
  assert.deepEqual(plain(plan.changes.map(c => [c.row, c.rowIndex, c.sourceRow, c.outputRowIndex, c.to])), [
    [2, 1, 2, 1, 'new-1'], [3, 2, 3, 2, 'new-1'],
    [6, 5, 6, 3, 'new-m'], [7, 6, 7, 4, 'new-a'],
  ]);
  assert.equal(plan.alreadyConverted, 1);
  assert.equal(plan.targetCount, 5);
  assert.equal(plan.retainedProductCount, 2);
  assert.equal(plan.retainedRowCount, 5);
  assert.equal(plan.excludedProductCount, 1);
  assert.equal(plan.excludedRowCount, 2);
  assert.deepEqual(data, original);
});

test('planRakutenInPlaceMigration_ keeps target SKU count errors and ignores excluded products', () => {
  const gas = loadGas(['src/NumberMigration.js']);
  const mapping = gas.parseNumberMapping_(mappingRows);
  const plan = gas.planRakutenInPlaceMigration_([
    ['商品管理番号（商品URL）','商品番号','選択肢タイプ','SKU管理番号','システム連携用SKU番号'],
    ['url-other','other','','',''],
    ['url-other','','','other-sku','unknown'],
    ['url-single','old-1','','',''],
    ['url-single','','','sku-1','old-1'],
    ['url-multi','old-m','','',''],
    ['url-multi','','','sku-a','old-a'],
  ], mapping);

  assert.ok(plan.errors.some(error => /SKU件数/.test(error)));
  assert.equal(plan.errors.some(error => /unknown|url-other/.test(error)), false);
  assert.equal(plan.excludedProductCount, 1);
  assert.equal(plan.excludedRowCount, 2);
});

test('planRakutenInPlaceMigration_ maps SKU error rows back after an excluded block', () => {
  const gas = loadGas(['src/NumberMigration.js']);
  const mapping = gas.parseNumberMapping_([mappingRows[0], mappingRows[1]]);
  const plan = gas.planRakutenInPlaceMigration_([
    ['商品管理番号（商品URL）','商品番号','選択肢タイプ','SKU管理番号','システム連携用SKU番号'],
    ['url-other','other','','',''],
    ['url-other','','','other-sku','other'],
    ['url-single','old-1','','',''],
    ['url-single','','','sku-1','unexpected'],
  ], mapping);

  assert.ok(plan.errors.some(error => /^5行目: SKU番号を対照表で特定できません$/.test(error)));
  assert.equal(plan.errors.some(error => /^3行目: SKU番号/.test(error)), false);
});

test('Rakuten in-place changes retain original rowIndex for legacy column writes', () => {
  const gas = loadGas(['src/NumberMigration.js']);
  const mapping = gas.parseNumberMapping_([mappingRows[0], mappingRows[1]]);
  const data = [
    ['商品管理番号（商品URL）','商品番号','選択肢タイプ','SKU管理番号','システム連携用SKU番号'],
    ['url-other','other','','',''],
    ['url-other','','','other-sku','other'],
    ['url-single','old-1','','',''],
    ['url-single','','','sku-1','old-1'],
  ];
  const plan = gas.planRakutenInPlaceMigration_(data, mapping);
  const writes = gas.buildMigrationColumnWrites_(data, plan.changes);

  assert.deepEqual(plain(plan.changes.map(change => [change.rowIndex, change.outputRowIndex])), [
    [3, 1], [4, 2],
  ]);
  assert.deepEqual(plain(writes), [
    { colIndex: 1, values: [['other'], [''], ['new-1'], ['']] },
    { colIndex: 4, values: [[''], ['other'], [''], ['new-1']] },
  ]);
});

test('createNumberMigrationPlan_ uses in-place planning for Rakuten and preserves ANA planning', () => {
  const gas = loadGas(['src/NumberMigration.js']);
  const mapping = gas.parseNumberMapping_([mappingRows[0], mappingRows[1]]);
  const rakuten = gas.createNumberMigrationPlan_('楽天', [
    ['商品管理番号（商品URL）','商品番号','選択肢タイプ','SKU管理番号','システム連携用SKU番号'],
    ['url-single','old-1','','',''], ['url-single','','','sku-1','old-1'],
    ['url-other','other','','',''],
  ], mapping);
  const ana = gas.createNumberMigrationPlan_('ANA', [
    ['返礼品識別コード','備考(内部用)'], ['old-1',''],
  ], mapping);

  assert.equal(rakuten.retainedProductCount, 1);
  assert.equal(rakuten.excludedProductCount, 1);
  assert.deepEqual(plain(ana.changes.map(change => [change.row, change.to])), [[2, 'new-1']]);
  assert.equal(ana.outputData, undefined);
});

function createMigrationCsvDownloadGas(rakutenData, mappingData, options = {}) {
  let currentRakutenData = rakutenData;
  let currentMappingData = mappingData;
  const rakutenSheet = {
    getLastRow: () => currentRakutenData ? currentRakutenData.length : 0,
    getDataRange: () => ({ getValues: () => plain(currentRakutenData || []) }),
  };
  const mappingSheet = {
    getDataRange: () => ({ getValues: () => plain(currentMappingData) }),
  };
  const accesses = [];
  const events = [];
  const spreadsheet = {
    getSheetByName(name) {
      accesses.push(name);
      if (name === 'rakuten_csv') return currentRakutenData === null ? null : rakutenSheet;
      if (name === 'number_mapping') return mappingSheet;
      if (name === 'rakuten_migration_csv') throw new Error('preview must not be read');
      return null;
    },
  };
  const ui = {
    ButtonSet: { YES_NO: 'YES_NO', OK: 'OK' },
    Button: { YES: 'YES', NO: 'NO' },
    alert() {
      events.push('confirm');
      if (options.rakutenAfterConfirm !== undefined) currentRakutenData = options.rakutenAfterConfirm;
      if (options.mappingAfterConfirm !== undefined) currentMappingData = options.mappingAfterConfirm;
      return options.confirm === false ? 'NO' : 'YES';
    },
  };
  const gas = loadGas([
    'src/Config.js',
    'src/Operations.js',
    'src/NumberMigration.js',
  ], {
    SpreadsheetApp: {
      getActiveSpreadsheet: () => spreadsheet,
      getUi: () => ui,
    },
    LockService: {
      getScriptLock() {
        return {
          tryLock() {
            events.push('tryLock');
            const attempt = events.filter(event => event === 'tryLock').length - 1;
            return options.lockResults ? options.lockResults[attempt] !== false : options.lockResult !== false;
          },
          releaseLock() {
            events.push('release');
            const release = events.filter(event => event === 'release').length - 1;
            if (options.releaseFailures && options.releaseFailures[release]) throw new Error('release failed');
          },
        };
      },
    },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'SHA_256' },
      computeDigest: (algorithm, value) => 'digest:' + value,
      base64EncodeWebSafe: value => value,
    },
  });
  const downloads = [];
  const records = [];
  const notices = [];
  gas.downloadCsvShiftJis_ = (data, filename, title) => {
    events.push('download');
    downloads.push({ data: plain(data), filename, title });
  };
  gas.recordOperationResult_ = entry => records.push(plain(entry));
  gas.notifyMessage_ = (actualUi, ss, title, message) => notices.push({ title, message });
  return { gas, accesses, events, downloads, records, notices };
}

test('downloadRakutenMigrationCsv preserves arbitrary current columns and order without 商品名', () => {
  const rakuten = [
    ['任意列','SKU管理番号','商品番号','商品管理番号（商品URL）','システム連携用SKU番号','選択肢タイプ'],
    ['product-extra','','new-1','url-single','',''],
    ['sku-extra','sku-1','','url-single','new-1',''],
  ];
  const env = createMigrationCsvDownloadGas(rakuten, [mappingRows[0], mappingRows[1]]);

  env.gas.downloadRakutenMigrationCsv();

  assert.equal(env.accesses.includes('rakuten_csv'), true);
  assert.equal(env.accesses.includes('rakuten_migration_csv'), false);
  assert.equal(env.downloads.length, 1);
  assert.deepEqual(env.downloads[0].data, rakuten);
  assert.equal(env.downloads[0].filename, 'normal-item.csv');
  assert.match(env.downloads[0].title, /楽天CSV/);
  assert.deepEqual(env.events, ['tryLock', 'release', 'confirm', 'tryLock', 'release', 'download']);
  assert.equal(env.records[0].status, '生成完了');
  assert.equal(env.records[0].success, 2);
});

test('downloadRakutenMigrationCsv rejects a missing or empty rakuten_csv without downloading', () => {
  for (const rakuten of [null, [], [['商品管理番号（商品URL）']]]) {
    const env = createMigrationCsvDownloadGas(rakuten, [mappingRows[0], mappingRows[1]]);

    assert.doesNotThrow(() => env.gas.downloadRakutenMigrationCsv());

    assert.equal(env.downloads.length, 0);
    assert.equal(env.accesses.includes('rakuten_migration_csv'), false);
    assert.match(env.notices[0].message, /rakuten_csv/);
  }
});

test('downloadRakutenMigrationCsv rejects excluded rows remaining in rakuten_csv', () => {
  const rakuten = [
    ['商品管理番号（商品URL）','商品番号','商品名','選択肢タイプ','SKU管理番号','システム連携用SKU番号'],
    ['url-single','new-1','商品1','','',''],
    ['url-single','','','','sku-1','new-1'],
    ['url-rogue','rogue','混入商品','','',''],
    ['url-rogue','','','','rogue-sku','rogue'],
  ];
  const env = createMigrationCsvDownloadGas(rakuten, [mappingRows[0], mappingRows[1]]);

  env.gas.downloadRakutenMigrationCsv();

  assert.equal(env.downloads.length, 0);
  assert.equal(env.events.includes('confirm'), false);
  assert.match(env.notices[0].message, /対象外の商品/);
});

test('downloadRakutenMigrationCsv rejects unconverted rows or invalid current mapping', () => {
  const unconverted = [
    ['商品管理番号（商品URL）','商品番号','商品名','選択肢タイプ','SKU管理番号','システム連携用SKU番号'],
    ['url-single','old-1','商品1','','',''],
    ['url-single','','','','sku-1','old-1'],
  ];
  const unconvertedEnv = createMigrationCsvDownloadGas(unconverted, [mappingRows[0], mappingRows[1]]);
  unconvertedEnv.gas.downloadRakutenMigrationCsv();
  assert.equal(unconvertedEnv.downloads.length, 0);
  assert.match(unconvertedEnv.notices[0].message, /未変換|変更/);

  const rakuten = [
    ['商品管理番号（商品URL）','商品番号','商品名','選択肢タイプ','SKU管理番号','システム連携用SKU番号'],
    ['url-single','new-1','商品1','','',''],
    ['url-single','','','','sku-1','new-1'],
  ];
  const changedMapping = [
    mappingRows[0],
    ['url-single','old-1','new-current','old-1','new-current','シングル','',''],
  ];
  const env = createMigrationCsvDownloadGas(rakuten, changedMapping);

  env.gas.downloadRakutenMigrationCsv();

  assert.equal(env.downloads.length, 0);
  assert.equal(env.events.includes('confirm'), false);
  assert.match(env.notices[0].message, /一致しません/);

  const invalidMapping = [mappingRows[0], ['url-single','old-1','','old-1','new-1','シングル','','']];
  const invalid = createMigrationCsvDownloadGas(rakuten, invalidMapping);
  invalid.gas.downloadRakutenMigrationCsv();
  assert.equal(invalid.downloads.length, 0);
  assert.match(invalid.notices[0].message, /必須値が空欄/);
});

test('downloadRakutenMigrationCsv does not download after cancellation or lock contention', () => {
  const rakuten = [
    ['商品管理番号（商品URL）','商品番号','商品名','選択肢タイプ','SKU管理番号','システム連携用SKU番号'],
    ['url-single','new-1','商品1','','',''],
    ['url-single','','','','sku-1','new-1'],
  ];
  const cancelled = createMigrationCsvDownloadGas(rakuten, [mappingRows[0], mappingRows[1]], { confirm: false });
  cancelled.gas.downloadRakutenMigrationCsv();
  assert.equal(cancelled.downloads.length, 0);
  assert.deepEqual(cancelled.events, ['tryLock', 'release', 'confirm']);

  const busy = createMigrationCsvDownloadGas(rakuten, [mappingRows[0], mappingRows[1]], { lockResult: false });
  busy.gas.downloadRakutenMigrationCsv();
  assert.equal(busy.downloads.length, 0);
  assert.deepEqual(busy.events, ['tryLock']);
  assert.match(busy.notices[0].message, /他の処理が実行中/);
});

test('downloadRakutenMigrationCsv aborts when rakuten_csv changes during confirmation', () => {
  const rakuten = [
    ['商品管理番号（商品URL）','商品番号','商品名','選択肢タイプ','SKU管理番号','システム連携用SKU番号'],
    ['url-single','new-1','商品1','','',''],
    ['url-single','','','','sku-1','new-1'],
  ];
  const changedRakuten = plain(rakuten);
  changedRakuten[1][2] = '確認後に変更された商品名';
  const env = createMigrationCsvDownloadGas(rakuten, [mappingRows[0], mappingRows[1]], {
    rakutenAfterConfirm: changedRakuten,
  });

  env.gas.downloadRakutenMigrationCsv();

  assert.equal(env.downloads.length, 0);
  assert.deepEqual(env.events, ['tryLock', 'release', 'confirm', 'tryLock', 'release']);
  assert.match(env.notices[0].message, /変更/);
  assert.match(env.notices[0].message, /再確認|再生成/);
});

test('downloadRakutenMigrationCsv aborts when mapping changes or the second lock is unavailable', () => {
  const rakuten = [
    ['商品管理番号（商品URL）','商品番号','商品名','選択肢タイプ','SKU管理番号','システム連携用SKU番号'],
    ['url-single','new-1','商品1','','',''],
    ['url-single','','','','sku-1','new-1'],
  ];
  const changedMapping = [
    mappingRows[0],
    ['url-single','old-1','new-current','old-1','new-current','シングル','',''],
  ];
  const mappingChanged = createMigrationCsvDownloadGas(rakuten, [mappingRows[0], mappingRows[1]], {
    mappingAfterConfirm: changedMapping,
  });
  mappingChanged.gas.downloadRakutenMigrationCsv();
  assert.equal(mappingChanged.downloads.length, 0);
  assert.match(mappingChanged.notices[0].message, /変更/);

  const busy = createMigrationCsvDownloadGas(rakuten, [mappingRows[0], mappingRows[1]], {
    lockResults: [true, false],
  });
  busy.gas.downloadRakutenMigrationCsv();
  assert.equal(busy.downloads.length, 0);
  assert.deepEqual(busy.events, ['tryLock', 'release', 'confirm', 'tryLock']);
  assert.match(busy.notices[0].message, /再確認|再生成/);
});

test('downloadRakutenMigrationCsv releases each acquired lock and aborts on release failure', () => {
  const rakuten = [
    ['商品管理番号（商品URL）','商品番号','商品名','選択肢タイプ','SKU管理番号','システム連携用SKU番号'],
    ['url-single','new-1','商品1','','',''],
    ['url-single','','','','sku-1','new-1'],
  ];
  const env = createMigrationCsvDownloadGas(rakuten, [mappingRows[0], mappingRows[1]], {
    releaseFailures: [true],
  });

  env.gas.downloadRakutenMigrationCsv();

  assert.equal(env.downloads.length, 0);
  assert.deepEqual(env.events, ['tryLock', 'release']);
  assert.match(env.notices[0].message, /ロックの解放に失敗/);
});

test('buildMigrationColumnWrites_ limits writes to changed columns', () => {
  const gas = loadGas(['src/NumberMigration.js']);
  const data = [
    ['商品番号', '数式列', 'システム連携用SKU番号'],
    ['old-item', '=A2', 'old-sku'],
    ['keep-item', '=A3', 'keep-sku'],
  ];
  const writes = gas.buildMigrationColumnWrites_(data, [
    { rowIndex: 1, colIndex: 0, to: 'new-item' },
    { rowIndex: 1, colIndex: 2, to: 'new-sku' },
  ]);

  assert.deepEqual(plain(writes), [
    { colIndex: 0, values: [['new-item'], ['keep-item']] },
    { colIndex: 2, values: [['new-sku'], ['keep-sku']] },
  ]);
  assert.equal(data[1][1], '=A2');
});

test('buildMigrationDashboardData_ includes summary and immutable row keys', () => {
  const gas = loadGas(['src/NumberMigration.js']);
  const dashboard = gas.buildMigrationDashboardData_('楽天', 'ドライラン', {
    targetCount: 3,
    alreadyConverted: 1,
    changes: [{
      row: 5,
      url: 'fixed-url',
      skuMgmt: 'fixed-sku',
      header: 'システム連携用SKU番号',
      from: 'old',
      to: 'new',
    }],
    errors: ['sample error'],
  }, '2026-06-20 12:00:00');

  assert.ok(dashboard.headers.includes('商品管理番号（商品URL）'));
  assert.ok(dashboard.headers.includes('SKU管理番号'));
  assert.deepEqual(plain(dashboard.rows[0].slice(0, 7)), [
    '楽天', '2026-06-20 12:00:00', 'ドライラン', 3, 1, 1, 1,
  ]);
  assert.ok(dashboard.rows[1].includes('fixed-url'));
  assert.ok(dashboard.rows[1].includes('fixed-sku'));
});

test('buildMigrationDashboardData_ and UI summary include Rakuten retained and excluded counts', () => {
  const gas = loadGas(['src/NumberMigration.js']);
  const plan = {
    targetCount: 2, alreadyConverted: 0, changes: [], errors: [],
    retainedProductCount: 1, retainedRowCount: 2,
    excludedProductCount: 3, excludedRowCount: 7,
  };
  const dashboard = gas.buildMigrationDashboardData_('楽天', 'ドライラン', plan, 'now');

  assert.deepEqual(plain(dashboard.headers.slice(7, 11)), [
    '残す商品数', '残す行数', '除外商品数', '除外行数',
  ]);
  assert.deepEqual(plain(dashboard.rows[0].slice(7, 11)), [1, 2, 3, 7]);
  assert.match(gas.buildNumberMigrationSummary_('楽天', true, plan), /残す商品: 1件（2行）/);
  assert.match(gas.buildNumberMigrationSummary_('楽天', true, plan), /除外商品: 3件（7行）/);
  assert.doesNotMatch(gas.buildNumberMigrationSummary_('ANA', true, {
    changes: [], alreadyConverted: 0,
  }), /残す商品|除外商品/);
});

test('runNumberMigration_ cancels before backup and writes when confirmation is declined', () => {
  const properties = {};
  let confirmationAnswer = 'NO';
  let backups = 0;
  let writes = 0;
  const data = [
    ['商品管理番号（商品URL）','商品番号','商品名','選択肢タイプ','SKU管理番号','システム連携用SKU番号'],
    ['url-single', 'old-1', '商品1', '', '', ''],
    ['url-single', '', '', '', 'sku-keep', 'old-1'],
  ];
  const targetSheet = {
    getDataRange() { return { getValues: () => plain(data) }; },
    getRange() { return { setValues() { writes++; } }; },
  };
  const dashboardSheet = {
    clear() {},
    getRange() { return { setValues() {} }; },
  };
  const spreadsheet = {
    getSheetByName(name) {
      if (name === 'rakuten_csv') return targetSheet;
      if (name === 'number_migration_dashboard') return dashboardSheet;
      return null;
    },
  };
  const ui = {
    ButtonSet: { OK: 'OK', YES_NO: 'YES_NO' },
    Button: { YES: 'YES', NO: 'NO' },
    alert(title, message, buttonSet) {
      return buttonSet === 'YES_NO' ? confirmationAnswer : 'OK';
    },
  };
  const gas = loadGas(['src/Config.js', 'src/NumberMigration.js'], {
    SpreadsheetApp: { getActiveSpreadsheet: () => spreadsheet, getUi: () => ui },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: key => properties[key] || null,
        setProperty: (key, value) => { properties[key] = value; },
        deleteProperty: key => { delete properties[key]; },
      }),
    },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'SHA_256' },
      computeDigest: (algorithm, value) => value,
      base64EncodeWebSafe: value => value,
      formatDate: () => '2026-06-20 12:00:00',
    },
  });
  const mapping = gas.parseNumberMapping_([mappingRows[0], mappingRows[1]]);
  gas.loadNumberMapping_ = () => mapping;
  gas.backupMigrationChanges_ = () => { backups++; };
  gas.recordOperationResult_ = () => {};

  gas.runNumberMigration_('楽天', true);
  gas.runNumberMigration_('楽天', false);

  assert.equal(confirmationAnswer, 'NO');
  assert.equal(backups, 0);
  assert.equal(writes, 0);
});

test('backupMigrationChanges_ writes a compact BOM-prefixed CSV beside the spreadsheet', () => {
  const created = [];
  const blobs = [];
  const spreadsheet = {
    getId: () => 'spreadsheet-file-id',
    insertSheet() { throw new Error('backup must not insert a sheet'); },
  };
  const sourceSheet = {
    getParent: () => spreadsheet,
  };
  const folder = { createFile(blob) { created.push({ location: 'parent', blob }); return { id: 'backup-file' }; } };
  const gas = loadGas(['src/Utils.js', 'src/NumberMigration.js'], {
    Utilities: {
      formatDate: () => '20260622_051500',
      newBlob(content, type, name) { const blob = { content, type, name }; blobs.push(blob); return blob; },
    },
    DriveApp: {
      getFileById(id) {
        assert.equal(id, 'spreadsheet-file-id');
        return { getParents: () => ({ hasNext: () => true, next: () => folder }) };
      },
      createFile() { throw new Error('root fallback must not be used'); },
    },
  });
  const changes = [
    { row: 10, url: 'url,1', skuMgmt: '', header: '商品番号', from: 'old"item', to: 'new\nitem' },
    { row: 11, url: 'url-1', skuMgmt: 'sku-1', header: 'システム連携用SKU番号', from: 'old-sku', to: 'new-sku' },
  ];

  const file = gas.backupMigrationChanges_(sourceSheet, 'rakuten_csv_backup_', changes);

  assert.equal(file.id, 'backup-file');
  assert.equal(blobs[0].name, 'rakuten_csv_backup_20260622_051500.csv');
  assert.equal(blobs[0].type, 'text/csv');
  assert.equal(blobs[0].content,
    '\uFEFF元行番号,商品管理番号（商品URL）,SKU管理番号,変更列,変更前,変更後\r\n' +
    '10,"url,1",,商品番号,"old""item","new\nitem"\r\n' +
    '11,url-1,sku-1,システム連携用SKU番号,old-sku,new-sku');
  assert.equal(created[0].location, 'parent');
  assert.equal(created[0].blob, blobs[0]);
});

test('backupMigrationChanges_ falls back to Drive root when the spreadsheet has no parent folder', () => {
  const rootFiles = [];
  const source = { getParent: () => ({ getId: () => 'spreadsheet-file-id' }) };
  const gas = loadGas(['src/Utils.js', 'src/NumberMigration.js'], {
    Utilities: {
      formatDate: () => '20260622_051500',
      newBlob: (content, type, name) => ({ content, type, name }),
    },
    DriveApp: {
      getFileById: () => ({ getParents: () => ({ hasNext: () => false }) }),
      createFile(blob) { rootFiles.push(blob); return { id: 'root-backup' }; },
    },
  });

  const file = gas.backupMigrationChanges_(source, 'rakuten_csv_backup_', []);

  assert.equal(file.id, 'root-backup');
  assert.equal(rootFiles[0].content,
    '\uFEFF元行番号,商品管理番号（商品URL）,SKU管理番号,変更列,変更前,変更後');
});

test('validateRakutenRebuiltData_ validates without creating an in-place projection', () => {
  const gas = loadGas(['src/NumberMigration.js']);
  const mapping = gas.parseNumberMapping_([mappingRows[0], mappingRows[1]]);
  const expected = [
    ['商品管理番号（商品URL）','商品番号','選択肢タイプ','SKU管理番号','システム連携用SKU番号'],
    ['url-single','new-1','','',''],
    ['url-single','','','sku-1','new-1'],
  ];
  gas.planRakutenInPlaceMigration_ = () => { throw new Error('must not build a projected matrix'); };

  const valid = gas.validateRakutenRebuiltData_(plain(expected), mapping, expected);
  assert.deepEqual(plain(valid.errors), []);
  assert.equal(valid.changes.length, 0);
  assert.equal(valid.excludedRowCount, 0);

  const mismatched = plain(expected);
  mismatched[2][4] = 'changed-after-write';
  const invalid = gas.validateRakutenRebuiltData_(mismatched, mapping, expected);
  assert.match(invalid.errors.join('\n'), /書き戻し結果.*一致/);
});

test('validateRakutenRebuiltData_ compares distinct Date cells by timestamp', () => {
  const gas = loadGas(['src/NumberMigration.js']);
  const mapping = gas.parseNumberMapping_([mappingRows[0], mappingRows[1]]);
  const headers = [
    '商品管理番号（商品URL）','商品番号','選択肢タイプ','SKU管理番号',
    'システム連携用SKU番号','任意日時',
  ];
  const expected = [
    headers,
    ['url-single','new-1','','','',new Date('2026-06-22T01:02:03.000Z')],
    ['url-single','','','sku-1','new-1',new Date('2026-06-23T04:05:06.000Z')],
  ];
  const reread = expected.map(row => row.map(value =>
    Object.prototype.toString.call(value) === '[object Date]' ? new Date(value.getTime()) : value
  ));

  const valid = gas.validateRakutenRebuiltData_(reread, mapping, expected);
  assert.deepEqual(plain(valid.errors), []);

  reread[2][5] = new Date('2026-06-23T04:05:07.000Z');
  const invalid = gas.validateRakutenRebuiltData_(reread, mapping, expected);
  assert.match(invalid.errors.join('\n'), /書き戻し結果.*一致/);
});

test('rewriteRakutenCsvInPlace_ clears the old used range before writing the compact output', () => {
  const gas = loadGas(['src/NumberMigration.js']);
  const events = [];
  const original = [
    ['URL', '商品番号'],
    ['keep', 'old'],
    ['remove', 'stale'],
    ['remove-2', 'stale-2'],
  ];
  const output = [
    ['URL', '商品番号'],
    ['keep', 'new'],
  ];
  const sheet = {
    getMaxRows: () => 10,
    getMaxColumns: () => 5,
    getRange(row, column, rows, columns) {
      return {
        clearContent() { events.push({ type: 'clear', row, column, rows, columns }); },
        setValues(values) { events.push({ type: 'write', row, column, rows, columns, values: plain(values) }); },
      };
    },
  };

  gas.rewriteRakutenCsvInPlace_(sheet, original, output);

  assert.deepEqual(events, [
    { type: 'clear', row: 1, column: 1, rows: 4, columns: 2 },
    { type: 'write', row: 1, column: 1, rows: 2, columns: 2, values: output },
  ]);
});

function createRakutenExecutionEnv(options = {}) {
  const mappingData = [mappingRows[0], mappingRows[1]];
  let values = [
    ['商品管理番号（商品URL）','商品番号','商品名','選択肢タイプ','SKU管理番号','システム連携用SKU番号'],
    ['url-single','old-1','対象','','',''],
    ['url-single','','','','sku-1','old-1'],
    ['url-excluded','outside','対象外','','',''],
    ['url-excluded','','','','sku-x','outside'],
  ];
  const events = [];
  const properties = {};
  let readCount = 0;
  const sheet = {
    getMaxRows: () => 20,
    getMaxColumns: () => 10,
    getDataRange() {
      return { getValues() {
        readCount++;
        if (options.corruptPostRead && readCount >= 4) {
          const corrupted = plain(values);
          corrupted.push(['post-corruption']);
          return corrupted;
        }
        return plain(values);
      } };
    },
    getRange(row, column, rows, columns) {
      return {
        clearContent() {
          events.push('clear');
          values = values.map(source => source.map(() => ''));
        },
        setValues(next) {
          if (options.rewriteFailure && row === 1) throw new Error('disk write failed');
          events.push('write');
          values = plain(next);
        },
      };
    },
  };
  const dashboard = { clear() {}, getRange() { return { setValues() {} }; } };
  const spreadsheet = {
    getSheetByName(name) {
      if (name === 'rakuten_csv') return sheet;
      if (name === 'number_migration_dashboard') return dashboard;
      return null;
    },
  };
  let confirmationMessage = '';
  const ui = {
    ButtonSet: { YES_NO: 'YES_NO' }, Button: { YES: 'YES', NO: 'NO' },
    alert(title, message) {
      events.push('confirm');
      confirmationMessage = message;
      if (options.changeDuringConfirm) values[1][2] = 'changed';
      return 'YES';
    },
  };
  const gas = loadGas(['src/Config.js', 'src/NumberMigration.js'], {
    SpreadsheetApp: {
      getActiveSpreadsheet: () => spreadsheet,
      getUi: () => ui,
      flush: () => events.push('flush'),
    },
    LockService: { getScriptLock: () => ({
      tryLock() { events.push('lock'); return options.lockAvailable !== false; },
      releaseLock() { events.push('release'); },
    }) },
    PropertiesService: { getScriptProperties: () => ({
      getProperty: key => properties[key] || null,
      setProperty: (key, value) => { properties[key] = value; },
      deleteProperty: key => { events.push('deleteDry'); delete properties[key]; },
    }) },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'SHA_256' },
      computeDigest: (algorithm, value) => value,
      base64EncodeWebSafe: value => value,
      formatDate: () => '2026-06-22 12:00:00',
    },
  });
  gas.loadNumberMapping_ = () => gas.parseNumberMapping_(plain(mappingData));
  gas.backupMigrationChanges_ = () => {
    events.push('backup');
    if (options.backupFailure) throw new Error('quota exceeded');
  };
  gas.runNumberMigration_('楽天', true);
  return { gas, events, properties, getValues: () => plain(values), getMessage: () => confirmationMessage };
}

test('runNumberMigration_ rebuilds Rakuten with retained rows only under the post-confirm lock', () => {
  const env = createRakutenExecutionEnv();

  const result = env.gas.runNumberMigration_('楽天', false);

  assert.deepEqual(env.getValues().map(row => [row[0], row[1], row[5]]), [
    ['商品管理番号（商品URL）','商品番号','システム連携用SKU番号'],
    ['url-single','new-1',''],
    ['url-single','','new-1'],
  ]);
  assert.match(env.getMessage(), /変更予定: 2件/);
  assert.match(env.getMessage(), /残す商品: 1件（2行）/);
  assert.match(env.getMessage(), /除外商品: 1件（2行）/);
  assert.deepEqual(env.events.slice(-7), ['lock','backup','clear','write','flush','deleteDry','release']);
  assert.equal(result.postPlan.excludedRowCount, 0);
  assert.equal(result.plan.outputData, undefined);
  assert.equal(result.postPlan.outputData, undefined);
});

test('runNumberMigration_ aborts Rakuten safely at each pre-write stage and releases acquired locks', () => {
  for (const scenario of [
    { options: { changeDuringConfirm: true }, error: /確認中.*変更/, mutation: false, release: true },
    { options: { lockAvailable: false }, error: /ロック取得/, mutation: false, release: false },
    { options: { backupFailure: true }, error: /楽天CSVバックアップ作成/, mutation: false, release: true },
    { options: { rewriteFailure: true }, error: /楽天CSV再構築/, mutation: true, release: true },
    { options: { corruptPostRead: true }, error: /楽天CSV更新後検証/, mutation: true, release: true },
  ]) {
    const env = createRakutenExecutionEnv(scenario.options);
    assert.throws(() => env.gas.runNumberMigration_('楽天', false), scenario.error);
    assert.equal(env.events.includes('clear'), scenario.mutation);
    assert.equal(env.events.includes('release'), scenario.release);
    assert.equal(env.events.includes('deleteDry'), false);
    if (!scenario.mutation) assert.equal(env.events.includes('write'), false);
  }
});

test('runNumberMigration_ keeps ANA execution as changed-column updates', () => {
  let values = [
    ['返礼品識別コード','保持列','備考(内部用)'],
    ['old-1','=FORMULA()',''],
  ];
  const events = [];
  const properties = {};
  const target = {
    getDataRange: () => ({ getValues: () => plain(values) }),
    getRange(row, column, rows, columns) {
      return { setValues(next) {
        events.push({ row, column, rows, columns });
        for (let i = 0; i < rows; i++) values[row - 1 + i][column - 1] = next[i][0];
      } };
    },
  };
  const dashboard = { clear() {}, getRange() { return { setValues() {} }; } };
  const ss = { getSheetByName: name => name === 'ana_csv' ? target :
    (name === 'number_migration_dashboard' ? dashboard : null) };
  const gas = loadGas(['src/Config.js', 'src/NumberMigration.js'], {
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ss,
      getUi: () => ({ ButtonSet: { YES_NO: 'YES_NO' }, Button: { YES: 'YES' }, alert: () => 'YES' }),
      flush() {},
    },
    PropertiesService: { getScriptProperties: () => ({
      getProperty: key => properties[key] || null,
      setProperty: (key, value) => { properties[key] = value; },
      deleteProperty: key => { delete properties[key]; },
    }) },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'SHA_256' }, computeDigest: (algorithm, value) => value,
      base64EncodeWebSafe: value => value, formatDate: () => 'now',
    },
  });
  gas.loadNumberMapping_ = () => gas.parseNumberMapping_([mappingRows[0], mappingRows[1]]);
  gas.backupMigrationChanges_ = () => {};

  gas.runNumberMigration_('ANA', true);
  gas.runNumberMigration_('ANA', false);

  assert.deepEqual(events, [{ row: 2, column: 3, rows: 1, columns: 1 }]);
  assert.deepEqual(values[1], ['old-1','=FORMULA()','new-1']);
});

test('planAnaNumberMigration_ fills blank notes and rejects conflicting notes', () => {
  const gas = loadGas(['src/NumberMigration.js']);
  const mapping = gas.parseNumberMapping_(mappingRows);
  const plan = gas.planAnaNumberMigration_([
    ['返礼品識別コード','備考(内部用)'], ['old-1',''], ['old-a','wrong'], ['old-b','new-b']
  ], mapping);
  assert.deepEqual(plain(plan.changes.map(c => [c.row,c.to])), [[2,'new-1']]);
  assert.match(plan.errors[0], /3行目/);
  assert.equal(plan.alreadyConverted, 1);
});

test('planAnaNumberMigration_ ignores completely blank CSV rows', () => {
  const gas = loadGas(['src/NumberMigration.js']);
  const mapping = gas.parseNumberMapping_(mappingRows);
  const plan = gas.planAnaNumberMigration_([
    ['返礼品識別コード','備考(内部用)'],
    ['old-1', ''],
    ['', ''],
  ], mapping);

  assert.deepEqual(plain(plan.errors), []);
  assert.deepEqual(plain(plan.changes.map(change => change.row)), [2]);
});

test('planMultiSkuImages_ uses new code, falls back to old code, and ignores singles', () => {
  const gas = loadGas(['src/NumberMigration.js']);
  const mapping = gas.parseNumberMapping_(mappingRows);
  const data = [
    ['商品管理番号（商品URL）','商品番号','SKU管理番号','システム連携用SKU番号','SKU画像タイプ','SKU画像パス'],
    ['url-single','new-1','','','',''], ['url-single','','sku1','new-1','',''],
    ['url-multi','new-m','','','',''], ['url-multi','','skua','new-a','',''], ['url-multi','','skub','new-b','',''],
  ];
  const plan = gas.planMultiSkuImages_(data, {'new-a':['/new-a_1.jpg'], 'old-b':['/old-b_1.jpg']}, mapping);
  assert.deepEqual(plain(plan.changes.map(c => [c.row,c.type,c.path])), [
    [5,'CABINET','/new-a_1.jpg'], [6,'CABINET','/old-b_1.jpg']
  ]);
  assert.equal(plan.warnings.length, 1);
  assert.equal(plan.errors.length, 0);
});

test('planMultiSkuImages_ prefers the new-number image even when the CSV still has old numbers', () => {
  const gas = loadGas(['src/NumberMigration.js']);
  const mapping = gas.parseNumberMapping_(mappingRows);
  const data = [
    ['商品管理番号（商品URL）','商品番号','SKU管理番号','システム連携用SKU番号','SKU画像タイプ','SKU画像パス'],
    ['url-multi','old-m','','','',''],
    ['url-multi','','sku-a','old-a','',''],
    ['url-multi','','sku-b','old-b','',''],
  ];
  const plan = gas.planMultiSkuImages_(data, {
    'new-a': ['/new-a.jpg'],
    'old-a': ['/old-a.jpg'],
    'new-b': ['/new-b.jpg'],
  }, mapping);

  assert.deepEqual(plain(plan.changes.map(change => change.path)), ['/new-a.jpg', '/new-b.jpg']);
  assert.equal(plan.warnings.length, 0);
});

test('buildMultiSkuImageColumnWrites_ batches type and path columns', () => {
  const gas = loadGas(['src/NumberMigration.js']);
  const data = [
    ['SKU画像タイプ', '保持列', 'SKU画像パス'],
    ['', '=A2', ''],
    ['KEEP', '=A3', '/keep.jpg'],
  ];
  const writes = gas.buildMultiSkuImageColumnWrites_(data, [{
    rowIndex: 1,
    typeCol: 0,
    pathCol: 2,
    type: 'CABINET',
    path: '/new.jpg',
  }]);

  assert.deepEqual(plain(writes), [
    { colIndex: 0, values: [['CABINET'], ['KEEP']] },
    { colIndex: 2, values: [['/new.jpg'], ['/keep.jpg']] },
  ]);
  assert.equal(data[1][1], '=A2');
});

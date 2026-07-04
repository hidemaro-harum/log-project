# Multi-SKU Product Anchor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Treat a Rakuten multi-SKU product number that equals one system-linked SKU number as valid, and normalize every mapping row in that product group to the same old/new product numbers.

**Architecture:** Extend the pure auto-fill planner to index Rakuten product rows and mapping rows by old SKU. For each matched multi-SKU group, use the Rakuten product number as the old product-number anchor and the anchor row's new SKU as the new product number. Keep per-row old/new SKU values unchanged and fail explicitly when the anchor cannot be resolved.

**Tech Stack:** Google Apps Script V8, JavaScript, Node.js built-in test runner, clasp

---

### Task 1: Lock the valid anchor behavior with tests

**Files:**
- Modify: `test/number-migration.test.js`
- Test: `test/number-migration.test.js`

- [ ] **Step 1: Add a failing auto-fill test**

Add a Rakuten fixture whose product row is `AX001` and whose SKU rows are `AX001` through `AX003`. Add mapping rows where each row currently has its own SKU value in the product-number columns. Assert that `planNumberMappingAutoFill_` returns changes that set every row's old product number to `AX001` and new product number to the anchor row's new SKU, while leaving the SKU columns out of the change set.

```js
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
```

- [ ] **Step 2: Add a failing anchor-missing test**

Assert that a multi-SKU product whose Rakuten product number is absent from all mapping old-SKU rows returns a clear error and does not guess a new product number.

```js
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
    ['ax001', '', '', '', 'ax002', 'AX002'],
    ['ax001', '', '', '', 'ax003', 'AX003'],
  ];

  const plan = gas.planNumberMappingAutoFill_(mapping, rakuten);

  assert.ok(plan.errors.some(error => /商品番号アンカー.*AX001/.test(error)));
});
```

- [ ] **Step 3: Run the focused tests and verify RED**

Run: `node --test test/number-migration.test.js`

Expected: the two new tests fail because product-number anchor normalization is not implemented.

### Task 2: Implement product-number anchor normalization

**Files:**
- Modify: `src/NumberMigration.js`
- Test: `test/number-migration.test.js`

- [ ] **Step 1: Require the Rakuten product-number header**

Add `商品番号` to the Rakuten headers required by `planNumberMappingAutoFill_`.

```js
var rakutenRequired = requiredNmHeaders_(rakutenData, [
  '商品管理番号（商品URL）', '商品番号', '選択肢タイプ',
  'SKU管理番号', 'システム連携用SKU番号'
]);
```

- [ ] **Step 2: Build the product and mapping anchor indexes**

Within `planNumberMappingAutoFill_`, index the Rakuten product row by URL and mapping row by old SKU. Product rows have `商品番号` populated and no SKU management number or option type.

```js
var productNumberByUrl = {};
var mappingRowByOldSku = {};

for (var m = 1; m < mappingData.length; m++) {
  var mappingOldSku = numberKey_(mappingData[m][mappingColumns['旧システム連携用SKU番号']]);
  if (mappingOldSku && !mappingRowByOldSku[mappingOldSku]) {
    mappingRowByOldSku[mappingOldSku] = { rowIndex: m, row: mappingData[m] };
  }
}
```

During the Rakuten row scan, record `productNumberByUrl[urlKey]` from the product row.

- [ ] **Step 3: Resolve and apply the anchor**

After URL matching and SKU type detection, resolve the anchor only for `マルチ` groups. Use the Rakuten product number as the common old product number and the matching mapping row's new SKU as the common new product number. Add changes only when a cell differs.

```js
var productNumber = productNumberByUrl[match.urlKey];
var anchor = productNumber ? mappingRowByOldSku[numberKey_(productNumber)] : null;
if (expectedType === 'マルチ' && (!productNumber || !anchor)) {
  plan.errors.push((i + 1) + '行目: マルチSKUの商品番号アンカー「' +
    (productNumber || '未取得') + '」が対照表にありません');
  continue;
}
var expectedOldItem = expectedType === 'マルチ' ? productNumber : oldSku;
var expectedNewItem = expectedType === 'マルチ' ?
  numberText_(anchor.row[mappingColumns['新システム連携用SKU番号']]) :
  numberText_(mappingRow[mappingColumns['新システム連携用SKU番号']]);
```

Add `旧商品番号` and `新商品番号` changes without modifying either SKU column.

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run: `node --test test/number-migration.test.js`

Expected: all number-migration tests pass.

### Task 3: Preserve strict validation and document the behavior

**Files:**
- Modify: `test/number-migration.test.js`
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-06-21-multi-sku-product-anchor-design.md`

- [ ] **Step 1: Add a parser regression test**

Add a valid multi group where the shared product number equals the first SKU. Assert `parseNumberMapping_` returns no errors.

```js
test('parseNumberMapping_ allows a shared multi product number to equal one SKU number', () => {
  const gas = loadGas(['src/NumberMigration.js']);
  const parsed = gas.parseNumberMapping_([
    mappingRows[0],
    ['ax001', 'AX001', '195956-0001', 'AX001', '195956-0001', 'マルチ', '', ''],
    ['ax001', 'AX001', '195956-0001', 'AX002', '195956-0002', 'マルチ', '', ''],
  ]);
  assert.deepEqual(plain(parsed.errors), []);
});
```

- [ ] **Step 2: Run the new test**

Run: `node --test test/number-migration.test.js`

Expected: PASS, documenting that equality itself is valid while true group inconsistencies remain errors.

- [ ] **Step 3: Update the operator documentation**

Document that a multi product number may equal one system-linked SKU, that the matching SKU is the anchor, and that `① 楽天CSVから対照表を補完` normalizes shared product-number columns.

### Task 4: Full verification and GAS deployment

**Files:**
- Verify: `src/NumberMigration.js`
- Verify: `test/number-migration.test.js`
- Verify: `.clasp.json`

- [ ] **Step 1: Run the complete test suite**

Run: `node --test test/*.test.js`

Expected: all tests pass with zero failures.

- [ ] **Step 2: Run JavaScript syntax checks**

Run: `for f in src/*.js test/*.js; do node --check "$f" || exit 1; done`

Expected: exit code 0.

- [ ] **Step 3: Confirm the deployment target**

Run: `cat .clasp.json`

Expected script ID: `12xVenQQgR8xGbDQh-tw-iGYI9NrVuHYQgrm299U1g9kCuFiVUDvh-WO8`.

- [ ] **Step 4: Push to Apps Script**

Run: `npx --yes @google/clasp push --force`

Expected: all project files are pushed successfully.

- [ ] **Step 5: Operational verification**

Run `① 楽天CSVから対照表を補完`, then `② 対照表を検証`. Confirm that `AX001`-style groups no longer report equality or group-conflict errors, while anchor-missing and SKU-count errors remain visible.

> Note: this directory is not a Git worktree, so commit steps are replaced by focused test and deployment checkpoints.


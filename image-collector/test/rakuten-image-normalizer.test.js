const test = require('node:test');
const assert = require('node:assert/strict');
const { loadGas } = require('./load-gas');

const gas = loadGas(['src/Config.js', 'src/RakutenImageNormalizer.js']);

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function image(id, name, mimeType, size, width, height) {
  return {
    id,
    name,
    mimeType,
    size: String(size),
    width,
    height,
    webViewLink: 'https://drive.google.com/file/d/' + id + '/view',
    thumbnailLink: 'https://thumb.example/' + id + '=s220',
  };
}

test('normalizeRakutenImageOutputName_ lowercases JPEG extensions and converts PNG/WebP names to jpg', () => {
  assert.equal(gas.normalizeRakutenImageOutputName_('ABC_01.JPG', 'image/jpeg'), 'abc_01.jpg');
  assert.equal(gas.normalizeRakutenImageOutputName_('ABC.JPEG', 'image/jpeg'), 'abc.jpeg');
  assert.equal(gas.normalizeRakutenImageOutputName_('PHOTO.PNG', 'image/png'), 'photo.jpg');
  assert.equal(gas.normalizeRakutenImageOutputName_('PHOTO.WEBP', 'image/webp'), 'photo.jpg');
});

test('needsRakutenImageOptimization_ includes exact 2MB and 3840px boundaries', () => {
  const MB2 = 2 * 1024 * 1024;
  assert.equal(gas.needsRakutenImageOptimization_(MB2 - 1, 3839, 3839), false);
  assert.equal(gas.needsRakutenImageOptimization_(MB2, 1000, 1000), true);
  assert.equal(gas.needsRakutenImageOptimization_(1000, 3840, 1000), true);
  assert.equal(gas.needsRakutenImageOptimization_(1000, 1000, 3840), true);
});

test('buildRakutenResizeCandidates_ starts at the source maximum or 3840 and descends uniquely', () => {
  assert.deepEqual(plain(gas.buildRakutenResizeCandidates_(5000, 3000)), [3840, 3200, 2560, 2048, 1600, 1280, 1024]);
  assert.deepEqual(plain(gas.buildRakutenResizeCandidates_(2000, 1000)), [2000, 1600, 1280, 1024]);
  assert.deepEqual(plain(gas.buildRakutenResizeCandidates_(0, 0)), [3840, 3200, 2560, 2048, 1600, 1280, 1024]);
});

test('buildRakutenImageNormalizationPlan_ isolates collisions and unsupported files while keeping valid work', () => {
  const files = [
    image('1', 'ABC.JPG', 'image/jpeg', 1000, 1000, 1000),
    image('2', 'abc.jpg', 'image/jpeg', 1000, 1000, 1000),
    image('3', 'OK.PNG', 'image/png', 1000, 1000, 1000),
    image('4', 'LARGE.JPEG', 'image/jpeg', 2 * 1024 * 1024, 2000, 1000),
    image('5', 'ANIM.GIF', 'image/gif', 1000, 500, 500),
    image('6', 'TAKEN.JPG', 'image/jpeg', 1000, 500, 500),
  ];

  const plan = plain(gas.buildRakutenImageNormalizationPlan_(files, ['taken.jpg']));
  const byId = Object.fromEntries(plan.items.map((item) => [item.id, item]));

  assert.equal(byId['1'].status, 'collision');
  assert.equal(byId['2'].status, 'collision');
  assert.equal(byId['3'].status, 'ready');
  assert.equal(byId['3'].outputName, 'ok.jpg');
  assert.equal(byId['3'].action, 'convert');
  assert.equal(byId['4'].status, 'ready');
  assert.equal(byId['4'].outputName, 'large.jpeg');
  assert.equal(byId['4'].action, 'optimize');
  assert.equal(byId['5'].status, 'error');
  assert.match(byId['5'].reason, /非対応/);
  assert.equal(byId['6'].status, 'collision');
  assert.match(byId['6'].reason, /変換先/);
  assert.equal(plan.summary.ready, 2);
  assert.equal(plan.summary.collisions, 3);
  assert.equal(plan.summary.errors, 1);
});

test('fetchRakutenOptimizedJpegBlob_ descends until the JPEG is below 2MB', () => {
  const calls = [];
  const blobs = {
    3840: { getContentType: () => 'image/jpeg', getBytes: () => new Array(2 * 1024 * 1024), setName() { return this; } },
    3200: { getContentType: () => 'image/jpeg', getBytes: () => new Array(1500), setName(name) { this.name = name; return this; } },
  };
  const item = image('1', 'LARGE.PNG', 'image/png', 3 * 1024 * 1024, 5000, 3000);
  item.outputName = 'large.jpg';

  const result = gas.fetchRakutenOptimizedJpegBlob_(item, (url, size) => {
    calls.push([url, size]);
    return blobs[size];
  });

  assert.deepEqual(calls.map((call) => call[1]), [3840, 3200]);
  assert.equal(result.blob, blobs[3200]);
  assert.equal(result.size, 1500);
  assert.equal(result.dimension, 3200);
  assert.equal(blobs[3200].name, 'large.jpg');
});

test('executeRakutenImageItem_ copies small JPEG bytes unchanged and creates converted files only when needed', () => {
  const events = [];
  const sourceFile = {
    makeCopy(name, destination) {
      events.push(['copy', name, destination]);
      return { getSize: () => 123 };
    },
  };
  const destination = {
    createFile(blob) {
      events.push(['create', blob]);
      return { getSize: () => 456 };
    },
  };
  const jpeg = { id: '1', outputName: 'abc.jpg', action: 'rename' };
  const convertedBlob = { id: 'blob' };
  const png = { id: '2', outputName: 'photo.jpg', action: 'convert' };

  const copied = gas.executeRakutenImageItem_(jpeg, destination, () => sourceFile, () => {
    assert.fail('JPEG rename must not fetch a thumbnail');
  });
  const converted = gas.executeRakutenImageItem_(png, destination, () => ({}), () => ({
    blob: convertedBlob,
    size: 456,
    dimension: 1600,
  }));

  assert.deepEqual(plain(copied), { outputSize: 123, dimension: 0, action: 'rename' });
  assert.deepEqual(plain(converted), { outputSize: 456, dimension: 1600, action: 'convert' });
  assert.deepEqual(events, [
    ['copy', 'abc.jpg', destination],
    ['create', convertedBlob],
  ]);
});

test('fetchRakutenOptimizedJpegBlob_ fails clearly without a thumbnail or a sub-2MB candidate', () => {
  const noThumbnail = image('1', 'A.PNG', 'image/png', 1000, 1000, 1000);
  noThumbnail.outputName = 'a.jpg';
  noThumbnail.thumbnailLink = '';
  assert.throws(
    () => gas.fetchRakutenOptimizedJpegBlob_(noThumbnail, () => null),
    /サムネイル/
  );

  const large = image('2', 'B.PNG', 'image/png', 3000000, 5000, 5000);
  large.outputName = 'b.jpg';
  assert.throws(
    () => gas.fetchRakutenOptimizedJpegBlob_(large, () => ({
      getContentType: () => 'image/jpeg',
      getBytes: () => new Array(2 * 1024 * 1024),
      setName() { return this; },
    })),
    /2MB未満/
  );
});

test('validateRakutenImageNormalizationFolderIds_ rejects the same source and destination', () => {
  assert.deepEqual(
    plain(gas.validateRakutenImageNormalizationFolderIds_('source-id', 'destination-id')),
    { sourceFolderId: 'source-id', destinationFolderId: 'destination-id' }
  );
  assert.throws(
    () => gas.validateRakutenImageNormalizationFolderIds_('same-id', 'same-id'),
    /同じフォルダ/
  );
  assert.throws(
    () => gas.validateRakutenImageNormalizationFolderIds_('', 'destination-id'),
    /フォルダURL/
  );
});

test('buildRakutenImageNormalizationCheckpoint_ stores the next index and counters', () => {
  assert.deepEqual(plain(gas.buildRakutenImageNormalizationCheckpoint_(4, {
    total: 6,
    planned: 3,
    success: 2,
    renamed: 1,
    converted: 1,
    optimized: 0,
    collisions: 1,
    skipped: 1,
    errors: 0,
  })), {
    index: 4,
    stats: {
      total: 6,
      planned: 3,
      success: 2,
      renamed: 1,
      converted: 1,
      optimized: 0,
      collisions: 1,
      skipped: 1,
      errors: 0,
    },
  });
});

test('getRakutenImageNormalizationDashboardConfig_ defines summary and detail columns', () => {
  const config = plain(gas.getRakutenImageNormalizationDashboardConfig_(12));
  assert.equal(config.sheetName, 'rakuten_image_convert_dashboard');
  assert.equal(config.summaryRows.length, 9);
  assert.deepEqual(config.detailHeaders, [
    '元ファイル名', '出力ファイル名', '元ファイルURL', '元サイズ', '元解像度',
    '処理', '出力サイズ', 'ステータス', 'エラー理由',
  ]);
  assert.equal(config.summaryRows[0].value, 12);
});

test('runRakutenImageNormalizationDryRun_ reports the plan without creating files', () => {
  const dryGas = loadGas(['src/Config.js', 'src/RakutenImageNormalizer.js']);
  const rows = [];
  dryGas.validateRakutenImageNormalizationSettings_ = () => ({
    sourceFolderId: 'source', destinationFolderId: 'destination',
  });
  dryGas.buildRakutenImageNormalizationContext_ = () => ({
    plan: {
      summary: { total: 2, ready: 1, collisions: 1, errors: 0 },
      items: [
        { sourceName: 'A.JPG', outputName: 'a.jpg', sourceUrl: '', size: 1, width: 1, height: 1, status: 'ready', action: 'rename', reason: '' },
        { sourceName: 'a.jpg', outputName: 'a.jpg', sourceUrl: '', size: 1, width: 1, height: 1, status: 'collision', action: '', reason: 'collision' },
      ],
    },
  });
  dryGas.initRakutenImageNormalizationDashboard_ = () => {};
  dryGas.addRakutenImageNormalizationRow_ = (item, size, status) => rows.push([item.sourceName, size, status]);
  dryGas.updateRakutenImageNormalizationStats_ = () => {};
  dryGas.updateRakutenImageNormalizationStatus_ = () => {};
  dryGas.executeRakutenImageItem_ = () => assert.fail('dry run must not create or copy files');

  const stats = plain(dryGas.runRakutenImageNormalizationDryRun_());

  assert.equal(stats.planned, 1);
  assert.equal(stats.collisions, 1);
  assert.deepEqual(rows, [
    ['A.JPG', 0, '予定'],
    ['a.jpg', 0, '衝突・スキップ'],
  ]);
});

test('pauseRakutenImageNormalizationIfNeeded_ saves the current index and schedules resume', () => {
  const events = [];
  const pauseGas = loadGas(['src/Config.js', 'src/RakutenImageNormalizer.js'], {
    ScriptApp: {
      newTrigger(name) {
        events.push('trigger:' + name);
        return { timeBased() { return this; }, after() { return this; }, create() { return this; } };
      },
    },
    deleteTriggersByFunction_: (name) => events.push('delete:' + name),
  });
  pauseGas.updateRakutenImageNormalizationStatus_ = (status) => events.push('status:' + status);
  pauseGas.updateRakutenImageNormalizationStats_ = () => events.push('stats');
  const props = {
    setProperty(key, value) { events.push(['set', key, JSON.parse(value)]); },
  };
  const stats = { total: 4, planned: 4, success: 2, renamed: 2, converted: 0, optimized: 0, collisions: 0, skipped: 0, errors: 0 };

  const paused = pauseGas.pauseRakutenImageNormalizationIfNeeded_(
    0,
    pauseGas.RAKUTEN_IMAGE_NORMALIZE_CONFIG_.TIME_LIMIT_MS + 1,
    2,
    stats,
    { sourceFolderId: 's', destinationFolderId: 'd' },
    props,
    { toast() { events.push('toast'); } }
  );

  assert.equal(paused, true);
  const progress = events.find((event) => Array.isArray(event) && event[1] === pauseGas.PROP_KEYS.RAKUTEN_IMAGE_NORMALIZE_PROGRESS);
  assert.equal(progress[2].index, 2);
  assert.equal(events.includes('trigger:resumeRakutenImageNormalization'), true);
  assert.equal(events.includes('status:中断（再開待ち）'), true);
});

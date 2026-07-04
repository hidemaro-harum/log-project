/**
 * 楽天向けDrive画像の小文字化・JPEG変換・最適化。
 * 既存のR-Cabinet処理とは独立して、指定したDriveフォルダ間だけを扱う。
 */

var RAKUTEN_IMAGE_NORMALIZE_CONFIG_ = {
  MAX_BYTES: 2 * 1024 * 1024,
  MAX_DIMENSION: 3840,
  TIME_LIMIT_MS: 25 * 60 * 1000,
  RESIZE_STEPS: [3840, 3200, 2560, 2048, 1600, 1280, 1024],
  SUPPORTED_MIME_TYPES: {
    'image/jpeg': true,
    'image/png': true,
    'image/webp': true,
  },
};

function normalizeRakutenImageOutputName_(name, mimeType) {
  var original = String(name || '');
  var dot = original.lastIndexOf('.');
  var base = dot > 0 ? original.slice(0, dot) : original;
  var extension = dot > 0 ? original.slice(dot + 1).toLowerCase() : '';
  var mime = String(mimeType || '').toLowerCase();
  if (mime === 'image/jpeg') {
    if (extension !== 'jpeg') extension = 'jpg';
  } else {
    extension = 'jpg';
  }
  return base.toLowerCase() + '.' + extension;
}

function needsRakutenImageOptimization_(size, width, height) {
  return Number(size || 0) >= RAKUTEN_IMAGE_NORMALIZE_CONFIG_.MAX_BYTES ||
    Number(width || 0) >= RAKUTEN_IMAGE_NORMALIZE_CONFIG_.MAX_DIMENSION ||
    Number(height || 0) >= RAKUTEN_IMAGE_NORMALIZE_CONFIG_.MAX_DIMENSION;
}

function buildRakutenResizeCandidates_(width, height) {
  var sourceMax = Math.max(Number(width || 0), Number(height || 0));
  var start = sourceMax > 0
    ? Math.min(sourceMax, RAKUTEN_IMAGE_NORMALIZE_CONFIG_.MAX_DIMENSION)
    : RAKUTEN_IMAGE_NORMALIZE_CONFIG_.MAX_DIMENSION;
  var candidates = [start];
  for (var i = 0; i < RAKUTEN_IMAGE_NORMALIZE_CONFIG_.RESIZE_STEPS.length; i++) {
    var step = RAKUTEN_IMAGE_NORMALIZE_CONFIG_.RESIZE_STEPS[i];
    if (step < start && candidates.indexOf(step) === -1) candidates.push(step);
  }
  return candidates;
}

function buildRakutenImageNormalizationPlan_(sourceFiles, destinationNames) {
  var destinationSet = {};
  (destinationNames || []).forEach(function(name) {
    destinationSet[String(name || '').toLowerCase()] = true;
  });

  var outputCounts = {};
  var prepared = (sourceFiles || []).map(function(file) {
    var mime = String(file.mimeType || '').toLowerCase();
    var outputName = normalizeRakutenImageOutputName_(file.name, mime);
    var supported = RAKUTEN_IMAGE_NORMALIZE_CONFIG_.SUPPORTED_MIME_TYPES[mime] === true;
    if (supported) outputCounts[outputName] = (outputCounts[outputName] || 0) + 1;
    return { file: file, mime: mime, outputName: outputName, supported: supported };
  });

  var summary = { total: prepared.length, ready: 0, collisions: 0, errors: 0 };
  var items = prepared.map(function(preparedItem) {
    var file = preparedItem.file;
    var item = {
      id: file.id,
      sourceName: file.name,
      outputName: preparedItem.outputName,
      mimeType: preparedItem.mime,
      size: Number(file.size || 0),
      width: Number(file.width || 0),
      height: Number(file.height || 0),
      sourceUrl: file.webViewLink || '',
      thumbnailLink: file.thumbnailLink || '',
      status: 'ready',
      action: '',
      reason: '',
    };

    if (!preparedItem.supported) {
      item.status = 'error';
      item.reason = '非対応の画像形式です: ' + preparedItem.mime;
      summary.errors++;
      return item;
    }
    if (outputCounts[item.outputName] > 1) {
      item.status = 'collision';
      item.reason = '変換元フォルダ内で出力名が衝突します';
      summary.collisions++;
      return item;
    }
    if (destinationSet[item.outputName]) {
      item.status = 'collision';
      item.reason = '変換先フォルダに同名ファイルがあります';
      summary.collisions++;
      return item;
    }

    var optimize = needsRakutenImageOptimization_(item.size, item.width, item.height);
    if (preparedItem.mime !== 'image/jpeg') {
      item.action = 'convert';
    } else if (optimize) {
      item.action = 'optimize';
    } else if (String(file.name) !== item.outputName) {
      item.action = 'rename';
    } else {
      item.action = 'copy';
    }
    summary.ready++;
    return item;
  });

  return { items: items, summary: summary };
}

function buildRakutenThumbnailUrl_(thumbnailLink, dimension) {
  var link = String(thumbnailLink || '');
  if (!link) return '';
  if (/=s\d+[^=]*$/.test(link)) return link.replace(/=s\d+[^=]*$/, '=s' + dimension);
  return link + '=s' + dimension;
}

function fetchRakutenThumbnailBlob_(url) {
  var response = UrlFetchApp.fetch(url, {
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    muteHttpExceptions: true,
  });
  if (response.getResponseCode() !== 200) {
    throw new Error('画像サムネイルの取得に失敗しました: HTTP ' + response.getResponseCode());
  }
  return response.getBlob();
}

function fetchRakutenOptimizedJpegBlob_(item, fetchBlob) {
  if (!item.thumbnailLink) {
    throw new Error('JPEG変換用のサムネイルを取得できません: ' + item.sourceName);
  }
  var fetcher = fetchBlob || function(url) { return fetchRakutenThumbnailBlob_(url); };
  var candidates = buildRakutenResizeCandidates_(item.width, item.height);
  for (var i = 0; i < candidates.length; i++) {
    var dimension = candidates[i];
    var url = buildRakutenThumbnailUrl_(item.thumbnailLink, dimension);
    var blob = fetcher(url, dimension);
    if (!blob) continue;
    if (String(blob.getContentType() || '').toLowerCase() !== 'image/jpeg') {
      blob = blob.getAs('image/jpeg');
    }
    var size = blob.getBytes().length;
    if (size < RAKUTEN_IMAGE_NORMALIZE_CONFIG_.MAX_BYTES) {
      blob.setName(item.outputName);
      return { blob: blob, size: size, dimension: dimension };
    }
  }
  throw new Error('画像を2MB未満に圧縮できません: ' + item.sourceName);
}

function executeRakutenImageItem_(item, destinationFolder, fileResolver, optimizedFetcher) {
  var resolveFile = fileResolver || function(fileId) { return DriveApp.getFileById(fileId); };
  if (item.action === 'copy' || item.action === 'rename') {
    var copied = resolveFile(item.id).makeCopy(item.outputName, destinationFolder);
    return { outputSize: copied.getSize(), dimension: 0, action: item.action };
  }

  var optimized = optimizedFetcher
    ? optimizedFetcher(item)
    : fetchRakutenOptimizedJpegBlob_(item);
  var created = destinationFolder.createFile(optimized.blob);
  return {
    outputSize: created.getSize ? created.getSize() : optimized.size,
    dimension: optimized.dimension,
    action: item.action,
  };
}

function validateRakutenImageNormalizationFolderIds_(sourceFolderId, destinationFolderId) {
  var source = String(sourceFolderId || '').trim();
  var destination = String(destinationFolderId || '').trim();
  if (!source || !destination) {
    throw new Error('楽天画像変換元・変換先フォルダURLをsettingシートに設定してください。');
  }
  if (source === destination) {
    throw new Error('楽天画像の変換元と変換先に同じフォルダは指定できません。');
  }
  return { sourceFolderId: source, destinationFolderId: destination };
}

function validateRakutenImageNormalizationSettings_() {
  var sourceUrl = getSettingValue_(SETTING_KEYS.RAKUTEN_IMAGE_SOURCE_FOLDER_URL);
  var destinationUrl = getSettingValue_(SETTING_KEYS.RAKUTEN_IMAGE_DEST_FOLDER_URL);
  var ids = validateRakutenImageNormalizationFolderIds_(
    sourceUrl ? extractFolderIdFromUrl_(sourceUrl) : '',
    destinationUrl ? extractFolderIdFromUrl_(destinationUrl) : ''
  );
  DriveApp.getFolderById(ids.sourceFolderId).getName();
  DriveApp.getFolderById(ids.destinationFolderId).getName();
  return ids;
}

function listRakutenDriveFilesByParent_(folderId, imagesOnly) {
  var files = [];
  var pageToken = null;
  do {
    var options = {
      q: "'" + folderId.replace(/'/g, "\\'") + "' in parents and trashed = false",
      fields: 'nextPageToken,files(id,name,mimeType,size,webViewLink,thumbnailLink,imageMediaMetadata)',
      pageSize: 1000,
      orderBy: 'name',
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    };
    if (pageToken) options.pageToken = pageToken;
    var response = Drive.Files.list(options);
    var pageFiles = response.files || [];
    for (var i = 0; i < pageFiles.length; i++) {
      var file = pageFiles[i];
      if (imagesOnly && String(file.mimeType || '').indexOf('image/') !== 0) continue;
      var media = file.imageMediaMetadata || {};
      files.push({
        id: file.id,
        name: file.name,
        mimeType: file.mimeType,
        size: file.size || 0,
        width: media.width || 0,
        height: media.height || 0,
        webViewLink: file.webViewLink || '',
        thumbnailLink: file.thumbnailLink || '',
      });
    }
    pageToken = response.nextPageToken || null;
  } while (pageToken);
  files.sort(function(a, b) {
    var nameOrder = String(a.name).toLowerCase().localeCompare(String(b.name).toLowerCase());
    return nameOrder || String(a.id).localeCompare(String(b.id));
  });
  return files;
}

function buildRakutenImageNormalizationContext_(config) {
  var ids = validateRakutenImageNormalizationFolderIds_(
    config.sourceFolderId,
    config.destinationFolderId
  );
  var sourceFiles = listRakutenDriveFilesByParent_(ids.sourceFolderId, true);
  var destinationFiles = listRakutenDriveFilesByParent_(ids.destinationFolderId, false);
  return {
    sourceFolder: DriveApp.getFolderById(ids.sourceFolderId),
    destinationFolder: DriveApp.getFolderById(ids.destinationFolderId),
    plan: buildRakutenImageNormalizationPlan_(sourceFiles, destinationFiles.map(function(file) { return file.name; })),
  };
}

function buildRakutenImageNormalizationCheckpoint_(nextIndex, stats) {
  return { index: nextIndex, stats: JSON.parse(JSON.stringify(stats)) };
}

function createRakutenImageNormalizationStats_(plan) {
  return {
    total: plan.summary.total,
    planned: plan.summary.ready,
    success: 0,
    renamed: 0,
    converted: 0,
    optimized: 0,
    collisions: 0,
    skipped: 0,
    errors: 0,
  };
}

function getRakutenImageNormalizationDashboardConfig_(total) {
  return {
    sheetName: SHEET_NAMES.RAKUTEN_IMAGE_CONVERT_DASHBOARD,
    title: '楽天画像変換ダッシュボード',
    bgColor: '#F3F4F6',
    summaryRows: [
      { label: '対象画像数:', value: total },
      { label: '処理予定:', value: 0 },
      { label: 'コピー成功:', value: 0 },
      { label: 'リネームのみ:', value: 0 },
      { label: 'JPEG変換:', value: 0 },
      { label: 'リサイズ・圧縮:', value: 0 },
      { label: '同名衝突:', value: 0 },
      { label: 'スキップ:', value: 0 },
      { label: 'エラー:', value: 0 },
    ],
    detailHeaders: [
      '元ファイル名', '出力ファイル名', '元ファイルURL', '元サイズ', '元解像度',
      '処理', '出力サイズ', 'ステータス', 'エラー理由'
    ],
    columnWidths: [220, 220, 420, 110, 120, 150, 110, 150, 420],
  };
}

function initRakutenImageNormalizationDashboard_(total) {
  initDashboardGeneric_(getRakutenImageNormalizationDashboardConfig_(total));
}

function updateRakutenImageNormalizationStatus_(status) {
  updateDashboardStatusGeneric_(SHEET_NAMES.RAKUTEN_IMAGE_CONVERT_DASHBOARD, status);
}

function updateRakutenImageNormalizationStats_(stats) {
  updateDashboardStatsGeneric_(SHEET_NAMES.RAKUTEN_IMAGE_CONVERT_DASHBOARD, [
    { cell: 'B5', value: stats.planned },
    { cell: 'B6', value: stats.success },
    { cell: 'B7', value: stats.renamed },
    { cell: 'B8', value: stats.converted },
    { cell: 'B9', value: stats.optimized },
    { cell: 'B10', value: stats.collisions },
    { cell: 'B11', value: stats.skipped },
    { cell: 'B12', value: stats.errors },
  ]);
}

function rakutenImageActionLabel_(action) {
  var labels = {
    copy: 'コピー',
    rename: '小文字リネーム',
    convert: 'JPEG変換',
    optimize: 'リサイズ・圧縮',
  };
  return labels[action] || '';
}

function addRakutenImageNormalizationRow_(item, outputSize, status, reason) {
  addDashboardRowGeneric_(SHEET_NAMES.RAKUTEN_IMAGE_CONVERT_DASHBOARD, [
    item.sourceName,
    item.outputName,
    item.sourceUrl,
    formatBytes_(item.size),
    item.width && item.height ? item.width + 'x' + item.height : '',
    rakutenImageActionLabel_(item.action),
    outputSize ? formatBytes_(outputSize) : '',
    status,
    reason || item.reason || '',
  ], 8);
}

function hasPendingRakutenImageNormalization_(props) {
  var keys = [
    PROP_KEYS.RAKUTEN_IMAGE_NORMALIZE_PROGRESS,
    PROP_KEYS.RAKUTEN_IMAGE_NORMALIZE_CONFIG,
    PROP_KEYS.RAKUTEN_IMAGE_NORMALIZE_QUEUE_CONFIG,
  ];
  for (var i = 0; i < keys.length; i++) {
    if (props.getProperty(keys[i])) return true;
  }
  var triggers = ScriptApp.getProjectTriggers();
  for (var t = 0; t < triggers.length; t++) {
    var handler = triggers[t].getHandlerFunction();
    if (handler === 'runQueuedRakutenImageNormalization' || handler === 'resumeRakutenImageNormalization') return true;
  }
  return false;
}

function pauseRakutenImageNormalizationIfNeeded_(startTime, now, index, stats, config, props, ss) {
  if (now - startTime <= RAKUTEN_IMAGE_NORMALIZE_CONFIG_.TIME_LIMIT_MS) return false;
  props.setProperty(
    PROP_KEYS.RAKUTEN_IMAGE_NORMALIZE_PROGRESS,
    JSON.stringify(buildRakutenImageNormalizationCheckpoint_(index, stats))
  );
  props.setProperty(PROP_KEYS.RAKUTEN_IMAGE_NORMALIZE_CONFIG, JSON.stringify(config));
  deleteTriggersByFunction_('resumeRakutenImageNormalization');
  ScriptApp.newTrigger('resumeRakutenImageNormalization').timeBased().after(EXEC_CONFIG.RESUME_DELAY_MS).create();
  updateRakutenImageNormalizationStatus_('中断（再開待ち）');
  updateRakutenImageNormalizationStats_(stats);
  ss.toast('時間制限のため中断しました。約1分後に自動再開します。', '楽天画像変換', 10);
  return true;
}

function runRakutenImageNormalizationDryRun_() {
  var ids = validateRakutenImageNormalizationSettings_();
  var context = buildRakutenImageNormalizationContext_(ids);
  var plan = context.plan;
  var stats = createRakutenImageNormalizationStats_(plan);
  stats.collisions = plan.summary.collisions;
  stats.errors = plan.summary.errors;
  stats.skipped = stats.collisions + stats.errors;
  initRakutenImageNormalizationDashboard_(stats.total);
  for (var i = 0; i < plan.items.length; i++) {
    var item = plan.items[i];
    var status = item.status === 'ready' ? '予定' :
      (item.status === 'collision' ? '衝突・スキップ' : 'エラー・スキップ');
    addRakutenImageNormalizationRow_(item, 0, status, item.reason);
  }
  updateRakutenImageNormalizationStats_(stats);
  updateRakutenImageNormalizationStatus_('ドライラン完了');
  return stats;
}

function dryRunRakutenImageNormalization() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ui = SpreadsheetApp.getUi();
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(3000)) {
    ui.alert('他の処理が実行中です。完了後に再実行してください。');
    return;
  }
  try {
    var stats = runRakutenImageNormalizationDryRun_();
    ui.alert('ドライラン完了',
      '対象: ' + stats.total + '件\n処理予定: ' + stats.planned + '件\n衝突: ' + stats.collisions + '件\nエラー: ' + stats.errors + '件',
      ui.ButtonSet.OK);
  } catch (e) {
    notifyMessage_(ui, ss, '楽天画像変換エラー', e.message);
  } finally {
    lock.releaseLock();
  }
}

function startRakutenImageNormalization() {
  var ui = SpreadsheetApp.getUi();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ids;
  try {
    ids = validateRakutenImageNormalizationSettings_();
  } catch (e) {
    ui.alert('エラー', e.message, ui.ButtonSet.OK);
    return;
  }
  var answer = ui.alert(
    '楽天画像変換 実行',
    '元画像を保持し、変換先フォルダへ小文字名でコピーします。実行しますか？',
    ui.ButtonSet.YES_NO
  );
  if (answer !== ui.Button.YES) return;

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(3000)) {
    ui.alert('他の処理が実行中です。完了後に再実行してください。');
    return;
  }
  try {
    var props = PropertiesService.getScriptProperties();
    if (hasPendingRakutenImageNormalization_(props)) {
      throw new Error('楽天画像変換が予約または再開待ちです。完了後に再実行してください。');
    }
    props.setProperty(PROP_KEYS.RAKUTEN_IMAGE_NORMALIZE_QUEUE_CONFIG, JSON.stringify(ids));
    deleteTriggersByFunction_('runQueuedRakutenImageNormalization');
    ScriptApp.newTrigger('runQueuedRakutenImageNormalization').timeBased().after(1000).create();
    ss.toast('楽天画像変換を予約しました。進捗は専用ダッシュボードで確認してください。', '楽天画像変換', 10);
  } catch (e) {
    ui.alert('エラー', e.message, ui.ButtonSet.OK);
  } finally {
    lock.releaseLock();
  }
}

function runQueuedRakutenImageNormalization() {
  var props = PropertiesService.getScriptProperties();
  var configText = props.getProperty(PROP_KEYS.RAKUTEN_IMAGE_NORMALIZE_QUEUE_CONFIG);
  if (!configText) {
    deleteTriggersByFunction_('runQueuedRakutenImageNormalization');
    return;
  }
  props.deleteProperty(PROP_KEYS.RAKUTEN_IMAGE_NORMALIZE_QUEUE_CONFIG);
  deleteTriggersByFunction_('runQueuedRakutenImageNormalization');
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(3000)) {
    props.setProperty(PROP_KEYS.RAKUTEN_IMAGE_NORMALIZE_QUEUE_CONFIG, configText);
    ScriptApp.newTrigger('runQueuedRakutenImageNormalization').timeBased().after(EXEC_CONFIG.RESUME_DELAY_MS).create();
    return;
  }
  try {
    runRakutenImageNormalization_(JSON.parse(configText), false);
  } catch (e) {
    updateRakutenImageNormalizationStatus_('異常終了');
    completeOperation_({ operation: '楽天画像変換', mode: '本実行', status: '異常終了', errors: 1, detail: e.message },
      '楽天画像変換 異常終了', e.message, true);
    throw e;
  } finally {
    lock.releaseLock();
  }
}

function runRakutenImageNormalization_(config, isResume) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var startTime = Date.now();
  var props = PropertiesService.getScriptProperties();
  var context = buildRakutenImageNormalizationContext_(config);
  var plan = context.plan;
  var progressText = isResume ? props.getProperty(PROP_KEYS.RAKUTEN_IMAGE_NORMALIZE_PROGRESS) : '';
  var progress = progressText ? JSON.parse(progressText) : null;
  var startIndex = progress ? progress.index : 0;
  var stats = progress ? progress.stats : createRakutenImageNormalizationStats_(plan);

  if (!progress) initRakutenImageNormalizationDashboard_(stats.total);
  updateRakutenImageNormalizationStatus_('実行中');

  for (var i = startIndex; i < plan.items.length; i++) {
    if (pauseRakutenImageNormalizationIfNeeded_(startTime, Date.now(), i, stats, config, props, ss)) return;
    var item = plan.items[i];
    if (item.status === 'collision') {
      stats.collisions++;
      stats.skipped++;
      addRakutenImageNormalizationRow_(item, 0, '衝突・スキップ', item.reason);
      continue;
    }
    if (item.status === 'error') {
      stats.errors++;
      stats.skipped++;
      addRakutenImageNormalizationRow_(item, 0, 'エラー・スキップ', item.reason);
      continue;
    }

    try {
      var result = executeRakutenImageItem_(item, context.destinationFolder);
      stats.success++;
      if (item.action === 'rename') stats.renamed++;
      if (item.action === 'convert') stats.converted++;
      if (item.action === 'optimize') stats.optimized++;
      addRakutenImageNormalizationRow_(item, result.outputSize, '完了', '');
    } catch (e) {
      stats.errors++;
      addRakutenImageNormalizationRow_(item, 0, 'エラー', e.message);
    }
    if ((i + 1) % 10 === 0) updateRakutenImageNormalizationStats_(stats);
  }

  props.deleteProperty(PROP_KEYS.RAKUTEN_IMAGE_NORMALIZE_PROGRESS);
  props.deleteProperty(PROP_KEYS.RAKUTEN_IMAGE_NORMALIZE_CONFIG);
  deleteTriggersByFunction_('resumeRakutenImageNormalization');
  updateRakutenImageNormalizationStats_(stats);
  var hasProblems = stats.errors > 0 || stats.collisions > 0;
  updateRakutenImageNormalizationStatus_(hasProblems ? '完了（エラーあり）' : '完了');
  var summary = '対象: ' + stats.total + '件\n成功: ' + stats.success + '件\n衝突: ' + stats.collisions + '件\nエラー: ' + stats.errors + '件';
  completeOperation_({
    operation: '楽天画像変換',
    mode: '本実行',
    status: hasProblems ? '完了（エラーあり）' : '完了',
    success: stats.success,
    skipped: stats.skipped,
    errors: stats.errors,
    detail: summary,
  }, '楽天画像変換完了', summary, true);
}

function resumeRakutenImageNormalization() {
  var props = PropertiesService.getScriptProperties();
  var progressText = props.getProperty(PROP_KEYS.RAKUTEN_IMAGE_NORMALIZE_PROGRESS);
  var configText = props.getProperty(PROP_KEYS.RAKUTEN_IMAGE_NORMALIZE_CONFIG);
  if (!progressText || !configText) {
    deleteTriggersByFunction_('resumeRakutenImageNormalization');
    return;
  }
  deleteTriggersByFunction_('resumeRakutenImageNormalization');
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(3000)) {
    ScriptApp.newTrigger('resumeRakutenImageNormalization').timeBased().after(EXEC_CONFIG.RESUME_DELAY_MS).create();
    return;
  }
  try {
    runRakutenImageNormalization_(JSON.parse(configText), true);
  } catch (e) {
    updateRakutenImageNormalizationStatus_('異常終了');
    completeOperation_({ operation: '楽天画像変換', mode: '自動再開', status: '異常終了', errors: 1, detail: e.message },
      '楽天画像変換 自動再開エラー', e.message, true);
    throw e;
  } finally {
    lock.releaseLock();
  }
}

function showRakutenImageNormalizationDashboard() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAMES.RAKUTEN_IMAGE_CONVERT_DASHBOARD);
  if (!sheet) {
    SpreadsheetApp.getUi().alert('楽天画像変換ダッシュボードはまだありません。ドライランを実行してください。');
    return;
  }
  sheet.activate();
}

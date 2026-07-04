/**
 * ==============================================================================
 * Choice画像配置エンジン (Distributor.js)
 * 集約済み画像をTSVとマッチングし、設定容量のバッチに分割して配置するコアロジック
 * ==============================================================================
 */

var CHOICE_PACKING_FALLBACK_FILENAME_ = 'Sado,_Niigata.jpg';

function parseChoiceBatchSizeMb_(value) {
  var text = String(value == null ? '' : value).trim();
  var size = Number(text);
  if (!text || !isFinite(size) || size < 1 || size > CHOICE_CONFIG.MAX_BATCH_SIZE_MB) {
    throw new Error('Choiceバッチサイズ(MB)は1〜80の数値で設定してください。');
  }
  return size;
}

function findChoiceImageByPrefix_(fileMap, expectedPrefix) {
  for (var key in fileMap) {
    if (key.indexOf(expectedPrefix) === 0) return fileMap[key];
  }
  return null;
}

function buildChoiceImageMatch_(mgmtCode, fileMap, imageCount, fallbackName) {
  var code = String(mgmtCode || '').trim().toLowerCase();
  var files = [];
  for (var imageNum = 1; imageNum <= imageCount; imageNum++) {
    var found = findChoiceImageByPrefix_(fileMap, code + '_' + imageNum + '.');
    if (found) files.push({ fileInfo: found, imageNum: imageNum });
  }

  var hasPackingImage = files.some(function(file) { return file.imageNum === 9; });
  var hasProductImage = files.some(function(file) { return file.imageNum >= 1 && file.imageNum <= 8; });
  if (imageCount >= 9 && !hasPackingImage && hasProductImage) {
    var fallbackKey = String(fallbackName || '').trim().toLowerCase();
    var fallback = fileMap[fallbackKey];
    if (!fallback) {
      return {
        files: files,
        usedFallback: false,
        error: '品梱包画像「' + fallbackName + '」が統合先フォルダにありません'
      };
    }
    files.push({ fileInfo: fallback, imageNum: 9, isPackingFallback: true });
    return { files: files, usedFallback: true, error: '' };
  }
  return { files: files, usedFallback: false, error: '' };
}

function buildChoiceMatchPlan_(tsvData, mgmtCodeIdx, fileMap, imageCount, fallbackName, tsvDisplayData) {
  var matchResults = [];
  var unmatchedCodes = [];
  var errors = [];
  var totalMatchedFiles = 0;
  var fallbackCount = 0;

  for (var row = 1; row < tsvData.length; row++) {
    var mgmtCode = String(tsvData[row][mgmtCodeIdx] || '').trim();
    if (!mgmtCode) continue;
    var imageMatch = buildChoiceImageMatch_(mgmtCode, fileMap, imageCount, fallbackName);
    if (imageMatch.error) {
      errors.push(mgmtCode + ': ' + imageMatch.error);
      continue;
    }
    if (!imageMatch.files.length) {
      unmatchedCodes.push(mgmtCode);
      continue;
    }
    matchResults.push({
      rowIndex: row,
      mgmtCode: mgmtCode,
      files: imageMatch.files,
      // 出力TSVには、数式結果・日付・セル内改行を含む画面上の表示値をそのまま使う。
      tsvRowData: tsvDisplayData && tsvDisplayData[row] ? tsvDisplayData[row] : tsvData[row],
      usedPackingFallback: imageMatch.usedFallback
    });
    totalMatchedFiles += imageMatch.files.length;
    if (imageMatch.usedFallback) fallbackCount++;
  }

  return {
    matchResults: matchResults,
    unmatchedCodes: unmatchedCodes,
    errors: errors,
    totalMatchedFiles: totalMatchedFiles,
    fallbackCount: fallbackCount
  };
}

// =========================================================================
// エントリーポイント
// =========================================================================

/**
 * Choice配置の前提条件を読み取り専用で検証し、実行用コンテキストを返す
 * @returns {Object} 検証済みのシート・設定・ヘッダー情報
 */
function validateChoicePreRequisitesReadOnly_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var destFolderUrl = getSettingValue_(SETTING_KEYS.DEST_FOLDER_URL);
  if (!destFolderUrl) {
    throw new Error('settingシートに「' + SETTING_KEYS.DEST_FOLDER_URL + '」が設定されていません。\n先に「初期設定」を実行してください。');
  }

  var tsvSheet = ss.getSheetByName(SHEET_NAMES.CHOICE_TSV);
  if (!tsvSheet) {
    throw new Error('「' + SHEET_NAMES.CHOICE_TSV + '」シートが見つかりません。');
  }

  var tsvRange = tsvSheet.getDataRange();
  var tsvData = tsvRange.getValues();
  var tsvDisplayData = tsvRange.getDisplayValues();
  if (tsvData.length < 2) {
    throw new Error('choice_tsvシートにデータがありません。\nチョイスのTSVを貼り付けてください。');
  }

  var headers = tsvData[0];
  var colMap = createColumnMap_(headers);
  var mgmtCodeColName = getSettingValue_(SETTING_KEYS.CHOICE_MGMT_CODE_COL) || CHOICE_COLUMNS.MGMT_CODE;
  var mgmtCodeIdx = colMap[mgmtCodeColName];
  if (mgmtCodeIdx === undefined) {
    throw new Error('「' + mgmtCodeColName + '」カラムが見つかりません。設定シートの「' + SETTING_KEYS.CHOICE_MGMT_CODE_COL + '」またはTSVのヘッダーを確認してください。');
  }

  var imageColsSetting = getSettingValue_(SETTING_KEYS.CHOICE_IMAGE_COLS);
  var targetImageCols = imageColsSetting
    ? imageColsSetting.split(',').map(function(s) { return s.trim(); }).filter(Boolean)
    : CHOICE_COLUMNS.IMAGE_COLS.slice();
  if (imageColsSetting && targetImageCols.length === 0) {
    throw new Error('Choice画像カラム名リストに有効なカラム名がありません。\n設定シートの「' + SETTING_KEYS.CHOICE_IMAGE_COLS + '」を確認してください。');
  }

  var duplicateConfiguredCols = findDuplicateNames_(targetImageCols);
  if (duplicateConfiguredCols.length > 0) {
    throw new Error('設定された画像カラム重複: ' + duplicateConfiguredCols.join(', ') + '\n設定シートの「' + SETTING_KEYS.CHOICE_IMAGE_COLS + '」を確認してください。');
  }

  var configuredImageColSet = {};
  for (var targetIdx = 0; targetIdx < targetImageCols.length; targetIdx++) {
    configuredImageColSet[targetImageCols[targetIdx]] = true;
  }
  var duplicateSheetCols = findDuplicateNames_(headers).filter(function(header) {
    return configuredImageColSet[header] === true;
  });
  if (duplicateSheetCols.length > 0) {
    throw new Error('TSVの画像カラム重複: ' + duplicateSheetCols.join(', ') + '\nchoice_tsvシートのヘッダーを確認してください。');
  }

  var missingImageCols = findMissingHeaders_(headers, targetImageCols);
  if (missingImageCols.length > 0) {
    throw new Error('設定された画像カラム不足: ' + missingImageCols.join(', ') + '\n設定シートの「' + SETTING_KEYS.CHOICE_IMAGE_COLS + '」またはTSVのヘッダーを確認してください。');
  }

  var imageColIndices = targetImageCols.map(function(colName) {
    return { index: colMap[colName], name: colName };
  });
  var choiceDestFolderUrl = getSettingValue_(SETTING_KEYS.CHOICE_DEST_FOLDER_URL);
  var batchSizeMB = parseChoiceBatchSizeMb_(getSettingValue_(SETTING_KEYS.CHOICE_BATCH_SIZE_MB));

  return {
    spreadsheet: ss,
    tsvSheet: tsvSheet,
    tsvData: tsvData,
    tsvDisplayData: tsvDisplayData,
    headers: headers,
    mgmtCodeColName: mgmtCodeColName,
    mgmtCodeIdx: mgmtCodeIdx,
    targetImageCols: targetImageCols,
    imageColIndices: imageColIndices,
    batchSizeMB: batchSizeMB,
    destFolderUrl: destFolderUrl,
    targetFolderUrl: choiceDestFolderUrl || destFolderUrl,
  };
}

function hasPendingChoiceWork_(props) {
  var pendingKeys = [
    PROP_KEYS.DIST_QUEUE_CONFIG,
    PROP_KEYS.DIST_PROGRESS,
    PROP_KEYS.DIST_CONFIG,
  ];
  for (var i = 0; i < pendingKeys.length; i++) {
    if (props.getProperty(pendingKeys[i])) return true;
  }

  var triggers = ScriptApp.getProjectTriggers();
  for (var t = 0; t < triggers.length; t++) {
    var handler = triggers[t].getHandlerFunction();
    if (handler === 'runQueuedDistribute' || handler === 'resumeDistribute') return true;
  }
  return false;
}

function resolveChoiceRunProgress_(props, isResume) {
  if (!isResume) return { startBatchIdx: 0, savedProgress: null };
  var savedStr = props.getProperty(PROP_KEYS.DIST_PROGRESS);
  var savedProgress = savedStr ? JSON.parse(savedStr) : null;
  return {
    startBatchIdx: savedProgress ? (savedProgress.batchIndex || 0) : 0,
    savedProgress: savedProgress,
  };
}

function buildChoiceProgressCheckpoint_(batchIndex, fileOffset, stats) {
  return {
    batchIndex: batchIndex,
    fileOffset: fileOffset,
    processedBatches: stats.processedBatches,
    copiedFiles: stats.copiedFiles,
    errorFiles: stats.errorFiles,
    skippedFiles: stats.skippedFiles,
  };
}

function pauseChoiceDuringBatchIfNeeded_(startTime, now, batchIndex, fileOffset, stats, config, props, ss) {
  if (now - startTime <= EXEC_CONFIG.TIME_LIMIT_MS) return false;

  props.setProperty(
    PROP_KEYS.DIST_PROGRESS,
    JSON.stringify(buildChoiceProgressCheckpoint_(batchIndex, fileOffset, stats))
  );
  props.setProperty(PROP_KEYS.DIST_CONFIG, JSON.stringify(config));
  deleteTriggersByFunction_('resumeDistribute');
  ScriptApp.newTrigger('resumeDistribute').timeBased().after(EXEC_CONFIG.RESUME_DELAY_MS).create();
  updateChoiceDashboardStatus_('⏸️ 中断(再開待ち)');
  _updateChoiceStats(stats);
  ss.toast('時間制限で中断しました。1分後に自動再開します。', '⏸️ 中断', 10);
  return true;
}

/**
 * Choice配置を予約してすぐに戻る（ダイアログから呼ばれる）
 * @param {string} dialogConfig - ダイアログから渡された設定(JSON文字列)
 */
function startChoiceDistribute(dialogConfig) {
  validateChoicePreRequisitesReadOnly_();

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(3000)) {
    throw new Error('他の処理が実行中です。完了後に再実行してください。');
  }

  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var props = PropertiesService.getScriptProperties();
    if (hasPendingChoiceWork_(props)) {
      throw new Error('Choice画像配置が予約または再開待ちです。完了後に再実行してください。');
    }
    deleteTriggersByFunction_('runQueuedDistribute');
    props.setProperty(PROP_KEYS.DIST_QUEUE_CONFIG, dialogConfig);
    ScriptApp.newTrigger('runQueuedDistribute').timeBased().after(1000).create();
    ss.toast(
      'Choice画像配置を予約しました。通常1分以内に開始します。進捗はchoice_dashboardシートで確認してください。',
      '📦 Choice配置',
      10
    );
  } finally {
    lock.releaseLock();
  }
}

/**
 * 予約されたChoice配置をトリガーから実行する
 */
function runQueuedDistribute() {
  var props = PropertiesService.getScriptProperties();
  var configStr = props.getProperty(PROP_KEYS.DIST_QUEUE_CONFIG);
  if (!configStr) {
    deleteTriggersByFunction_('runQueuedDistribute');
    props.deleteProperty(PROP_KEYS.DIST_QUEUE_CONFIG);
    Logger.log('予約されたChoice配置設定がありません。');
    return;
  }

  try {
    validateChoicePreRequisitesReadOnly_();
  } catch (e) {
    Logger.log('Choice画像配置を開始できません: ' + e.message);
    return;
  }

  deleteTriggersByFunction_('runQueuedDistribute');
  props.deleteProperty(PROP_KEYS.DIST_QUEUE_CONFIG);

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(3000)) {
    props.setProperty(PROP_KEYS.DIST_QUEUE_CONFIG, configStr);
    ScriptApp.newTrigger('runQueuedDistribute').timeBased().after(EXEC_CONFIG.RESUME_DELAY_MS).create();
    Logger.log('他の処理が実行中のため、Choice配置を再予約しました。');
    return;
  }

  try {
    var config = JSON.parse(configStr);
    _runDistribute(config, true, false);
  } catch (e) {
    updateChoiceDashboardStatus_('❌ 異常終了');
    completeOperation_({ operation: 'Choice画像配置', mode: '本実行', status: '異常終了', errors: 1, detail: e.message },
      '❌ 佐渡市 Choice画像配置 異常終了', 'Choice画像配置が異常終了しました。\n\n' + e.message, true);
    throw e;
  } finally {
    lock.releaseLock();
  }
}

/**
 * Choice配置のドライランを実行する（コピーせずにマッチング結果のみ）
 * @param {string} dialogConfig - ダイアログから渡された設定(JSON文字列)
 */
function startChoiceDryRun(dialogConfig) {
  var config = JSON.parse(dialogConfig);
  config.isDryRun = true;
  _runDistribute(config, false, false);
}


// =========================================================================
// コアロジック
// =========================================================================

/**
 * Choice画像配置の内部実装
 * @param {Object} config - 設定
 * @param {boolean} [suppressUi] - トリガー実行時はtrue
 * @param {boolean} [isResume] - 保存済み進捗からの再開時はtrue
 */
function _runDistribute(config, suppressUi, isResume) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ui = suppressUi ? null : SpreadsheetApp.getUi();
  var startTime = Date.now();
  var isDryRun = config.isDryRun || false;

  var validation;
  try {
    validation = validateChoicePreRequisitesReadOnly_();
  } catch (e) {
    notifyMessage_(ui, ss, 'エラー', e.message);
    return;
  }

  var tsvSheet = validation.tsvSheet;
  var tsvData = validation.tsvData;
  var tsvDisplayData = validation.tsvDisplayData;
  var headers = validation.headers;
  var mgmtCodeIdx = validation.mgmtCodeIdx;
  var imageColIndices = validation.imageColIndices;
  var batchSizeMB = validation.batchSizeMB;
  var destFolderUrl = validation.destFolderUrl;
  var targetFolderUrl = validation.targetFolderUrl;

  var choiceDestFolder;
  try {
    choiceDestFolder = DriveApp.getFolderById(extractFolderIdFromUrl_(targetFolderUrl));
  } catch (e) {
    notifyMessage_(ui, ss, 'エラー', '出力先フォルダにアクセスできません。\n' + e.message);
    return;
  }

  var destFolder;
  try {
    destFolder = DriveApp.getFolderById(extractFolderIdFromUrl_(destFolderUrl));
  } catch (e) {
    notifyMessage_(ui, ss, 'エラー', '画像集約元（統合先）フォルダにアクセスできません。\n' + e.message);
    return;
  }

  // --- 3. 統合フォルダ内のファイル一覧を取得 ---
  Logger.log('Choice配置: 統合フォルダの画像走査を開始');
  var fileMap = buildFileMapFromFolder_(destFolder);
  Logger.log('Choice配置: 統合フォルダの画像走査完了 (' + Object.keys(fileMap).length + '件、経過' +
    Math.round((Date.now() - startTime) / 1000) + '秒)');

  // --- 4. TSV行ごとにマッチング ---
  var matchPlan = buildChoiceMatchPlan_(
    tsvData,
    mgmtCodeIdx,
    fileMap,
    imageColIndices.length,
    CHOICE_PACKING_FALLBACK_FILENAME_,
    tsvDisplayData
  );
  if (matchPlan.errors.length) {
    var fallbackError = '品梱包画像のフォールバックを実行できません。\n\n' +
      matchPlan.errors.slice(0, 20).join('\n');
    recordOperationResult_({
      operation: 'Choice画像配置',
      mode: isDryRun ? 'ドライラン' : '本実行',
      status: '検証失敗',
      errors: matchPlan.errors.length,
      detail: fallbackError
    });
    notifyMessage_(ui, ss, '品梱包画像エラー', fallbackError);
    return;
  }
  var matchResults = matchPlan.matchResults;
  var unmatchedCodes = matchPlan.unmatchedCodes;
  var totalMatchedFiles = matchPlan.totalMatchedFiles;
  var packingFallbackCount = matchPlan.fallbackCount;

  // --- 5. 設定容量でバッチ分割 ---
  var batches = _splitIntoBatches(matchResults, batchSizeMB * 1024 * 1024);

  // --- 6. ダッシュボード初期化 ---
  initChoiceDashboard_(tsvData.length - 1, matchResults.length, unmatchedCodes.length, batches.length, totalMatchedFiles);

  if (isDryRun) {
    // ドライラン: マッチング結果とバッチ計画のみ表示
    _writeDryRunResults(ss, matchResults, unmatchedCodes, batches);
    // 元シートにバッチ割り当て情報をマーキング
    _writeBackBatchMarkings(tsvSheet, tsvData, headers, batches);
    updateChoiceDashboardStatus_('📋 ドライラン完了');

    var dryRunSummary = 'ドライラン完了\n\n' +
      '📊 TSV行数: ' + (tsvData.length - 1) + '\n' +
      '✅ マッチ: ' + matchResults.length + '品 (' + totalMatchedFiles + '枚)\n' +
      '📦 品梱包画像フォールバック: ' + packingFallbackCount + '品\n' +
      '❌ 未マッチ: ' + unmatchedCodes.length + '品\n' +
      '📦 バッチ数: ' + batches.length + '\n\n' +
      buildBatchSummaryText_(batches);

    notifyMessage_(ui, ss, 'ドライラン完了', dryRunSummary);
    return;
  }

  // --- 7. 本実行: バッチごとにフォルダ作成 & 画像コピー & TSV生成 ---
  var props = PropertiesService.getScriptProperties();
  var runProgress = resolveChoiceRunProgress_(props, Boolean(isResume));
  var startBatchIdx = runProgress.startBatchIdx;
  var savedProgress = runProgress.savedProgress;
  if (savedProgress) {
    Logger.log('前回の続きから再開: バッチ ' + (startBatchIdx + 1));
  }

  var stats = {
    startTime: startTime,
    totalBatches: batches.length,
    processedBatches: savedProgress ? (savedProgress.processedBatches || 0) : 0,
    copiedFiles: savedProgress ? (savedProgress.copiedFiles || 0) : 0,
    errorFiles: savedProgress ? (savedProgress.errorFiles || 0) : 0,
    skippedFiles: savedProgress ? (savedProgress.skippedFiles || 0) : 0,
  };

  if (!savedProgress) {
    _writeBackBatchMarkings(tsvSheet, tsvData, headers, []);
  }

  updateChoiceDashboardStatus_('処理中');

  // バッチループ
  for (var b = startBatchIdx; b < batches.length; b++) {
    var resumeFileOffset = savedProgress && b === startBatchIdx ? (savedProgress.fileOffset || 0) : 0;
    if (pauseChoiceDuringBatchIfNeeded_(startTime, Date.now(), b, resumeFileOffset, stats, config, props, ss)) return;

    var batch = batches[b];
    var batchNum = b + 1;
    var batchFolderName = BATCH_CONFIG.BATCH_FOLDER_PREFIX + padNumber_(batchNum, 3);

    // バッチフォルダ作成 (Choice出力先フォルダの配下に作成)
    var batchFolder = getOrCreateFolder_(choiceDestFolder, batchFolderName);

    // バッチ内の画像をコピー
    var batchExistingFiles = buildExistingFileSet_(batchFolder);
    var batchErrors = [];
    var placedFilesByRow = {};
    var currentFileOffset = 0;

    for (var item = 0; item < batch.items.length; item++) {
      var matchItem = batch.items[item];
      var rowKey = String(matchItem.rowIndex);
      placedFilesByRow[rowKey] = [];
      for (var f = 0; f < matchItem.files.length; f++) {
        var matchedFile = matchItem.files[f];
        var fileInfo = matchedFile.fileInfo;
        var alreadyProcessedBeforeResume = currentFileOffset < resumeFileOffset;

        if (batchExistingFiles[fileInfo.name.toLowerCase()]) {
          if (!alreadyProcessedBeforeResume) stats.skippedFiles++;
          placedFilesByRow[rowKey].push(matchedFile);
          currentFileOffset++;
          continue;
        }

        if (pauseChoiceDuringBatchIfNeeded_(
          startTime,
          Date.now(),
          b,
          currentFileOffset,
          stats,
          config,
          props,
          ss
        )) return;

        try {
          fileInfo.file.makeCopy(fileInfo.name, batchFolder);
          batchExistingFiles[fileInfo.name.toLowerCase()] = true;
          stats.copiedFiles++;
          if (alreadyProcessedBeforeResume && stats.errorFiles > 0) stats.errorFiles--;
          placedFilesByRow[rowKey].push(matchedFile);
        } catch (e) {
          if (!alreadyProcessedBeforeResume) stats.errorFiles++;
          batchErrors.push(matchItem.mgmtCode + '/' + fileInfo.name + ': ' + e.message);
          Logger.log('コピーエラー: ' + fileInfo.name + ' → ' + e.message);
        }
        currentFileOffset++;
      }
    }

    var batchOutcome = buildChoiceCompletedBatch_(batch, placedFilesByRow);
    var completedBatch = batchOutcome.completedBatch;
    if (completedBatch.items.length > 0) {
      _generateBatchTsvSheet(ss, batchNum, completedBatch, headers, imageColIndices, mgmtCodeIdx);
    } else {
      deleteBatchTsvSheets_(ss, batchNum);
    }
    writeChoiceBatchOutcomeMarkings_(
      tsvSheet,
      tsvData,
      headers,
      batchNum,
      completedBatch.items.map(function(completedItem) { return completedItem.rowIndex; }),
      batchOutcome.failedRowIndices
    );
    SpreadsheetApp.flush();

    // ダッシュボードにバッチ結果を記録
    addChoiceDashboardRow_(
      batchNum,
      batch.items.length,
      batch.totalFiles,
      formatBytes_(batch.totalSize),
      batchErrors.length > 0 ? '⚠️ ' + batchErrors.length + '件エラー' : '✅ 完了',
      batchErrors.join('; ')
    );

    stats.processedBatches++;

    if (stats.processedBatches % 3 === 0) {
      _updateChoiceStats(stats);
      ss.toast('処理中: バッチ ' + batchNum + '/' + batches.length, '📦', 3);
    }
  }

  // --- 8. 完了処理 ---
  props.deleteProperty(PROP_KEYS.DIST_PROGRESS);
  props.deleteProperty(PROP_KEYS.DIST_CONFIG);
  deleteTriggersByFunction_('resumeDistribute');
  _updateChoiceStats(stats);
  updateChoiceDashboardStatus_('✅ 完了');

  var summary = 'Choice画像配置完了\n\n' +
    '📦 バッチ数: ' + batches.length + '\n' +
    '📦 品梱包画像フォールバック: ' + packingFallbackCount + '品\n' +
    '✅ コピー: ' + stats.copiedFiles + '枚\n' +
    '⏭️ スキップ: ' + stats.skippedFiles + '枚\n' +
    '❌ エラー: ' + stats.errorFiles + '枚\n\n' +
    buildBatchSummaryText_(batches) + '\n\n' +
    '各バッチのTSVは「tsv_bN_XX品」シートに出力されています。';

  recordOperationResult_({ operation: 'Choice画像配置', mode: '本実行', status: stats.errorFiles ? '完了（エラーあり）' : '完了',
    success: stats.copiedFiles, skipped: stats.skippedFiles, errors: stats.errorFiles, detail: summary });
  sendNotificationEmail_('📦 佐渡市 Choice画像配置完了', summary);
  notifyMessage_(ui, ss, '完了', summary);
}


// =========================================================================
// 自動再開
// =========================================================================

/**
 * タイムアウト後の自動再開関数（トリガーから呼ばれる）
 */
function resumeDistribute() {
  var props = PropertiesService.getScriptProperties();
  var progressStr = props.getProperty(PROP_KEYS.DIST_PROGRESS);
  var configStr = props.getProperty(PROP_KEYS.DIST_CONFIG);

  if (!progressStr) {
    Logger.log('再開データがありません。');
    deleteTriggersByFunction_('resumeDistribute');
    return;
  }

  var config = configStr ? JSON.parse(configStr) : {};
  deleteTriggersByFunction_('resumeDistribute');

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(3000)) {
    ScriptApp.newTrigger('resumeDistribute').timeBased().after(EXEC_CONFIG.RESUME_DELAY_MS).create();
    Logger.log('他の処理が実行中のため、再開を再予約しました。');
    return;
  }

  try {
    _runDistribute(config, true, true);
  } catch (e) {
    updateChoiceDashboardStatus_('❌ 異常終了');
    completeOperation_({ operation: 'Choice画像配置', mode: '自動再開', status: '異常終了', errors: 1, detail: e.message },
      '❌ 佐渡市 Choice画像配置 異常終了', 'Choice画像配置の自動再開中に異常終了しました。\n\n' + e.message, true);
    throw e;
  } finally {
    lock.releaseLock();
  }
}

// 共通ファイルスキャンはUtils.jsへ移行しました


// =========================================================================
// Choiceバッチ分割
// =========================================================================

/**
 * マッチ結果を設定容量単位のバッチに分割する
 * 管理コード単位で分割（1品の画像が途中で分かれないようにする）
 * @param {Array} matchResults - マッチング結果配列
 * @param {number} maxBatchSizeBytes - 1バッチの最大容量（バイト）
 * @returns {Array} バッチ配列 [{ items, totalSize, totalFiles }]
 */
function _splitIntoBatches(matchResults, maxBatchSizeBytes) {
  var batches = [];
  var currentBatch = { items: [], totalSize: 0, totalFiles: 0 };

  for (var i = 0; i < matchResults.length; i++) {
    var item = matchResults[i];
    var itemSize = 0;
    var itemFileCount = 0;

    for (var f = 0; f < item.files.length; f++) {
      itemSize += item.files[f].fileInfo.size;
      itemFileCount++;
    }

    // 現バッチに追加すると設定容量を超える場合、新バッチを開始
    // ただし現バッチが空の場合は商品を分割せず単独バッチにする
    if (currentBatch.items.length > 0 &&
        currentBatch.totalSize + itemSize > maxBatchSizeBytes) {
      batches.push(currentBatch);
      currentBatch = { items: [], totalSize: 0, totalFiles: 0 };
    }

    currentBatch.items.push(item);
    currentBatch.totalSize += itemSize;
    currentBatch.totalFiles += itemFileCount;
  }

  // 最後のバッチを追加
  if (currentBatch.items.length > 0) {
    batches.push(currentBatch);
  }

  return batches;
}

function buildChoiceCompletedBatch_(batch, placedFilesByRow) {
  var completedItems = [];
  var failedRowIndices = [];
  var totalFiles = 0;
  var totalSize = 0;

  for (var i = 0; i < batch.items.length; i++) {
    var item = batch.items[i];
    var placedFiles = placedFilesByRow[String(item.rowIndex)] || [];
    if (placedFiles.length !== item.files.length) {
      failedRowIndices.push(item.rowIndex);
      continue;
    }

    var completedItem = {};
    for (var key in item) completedItem[key] = item[key];
    completedItem.files = placedFiles.slice();
    completedItems.push(completedItem);
    totalFiles += placedFiles.length;
    for (var f = 0; f < placedFiles.length; f++) {
      totalSize += placedFiles[f].fileInfo.size || 0;
    }
  }

  return {
    completedBatch: {
      items: completedItems,
      totalFiles: totalFiles,
      totalSize: totalSize,
    },
    failedRowIndices: failedRowIndices,
  };
}


// =========================================================================
// ドライラン結果出力
// =========================================================================

/**
 * ドライランの結果をchoice_dashboardシートに書き込む
 * @param {Spreadsheet} ss - スプレッドシート
 * @param {Array} matchResults - マッチ結果
 * @param {Array} unmatchedCodes - 未マッチの管理コード
 * @param {Array} batches - バッチ配列
 */
function _writeDryRunResults(ss, matchResults, unmatchedCodes, batches) {
  // バッチ計画をダッシュボードに記録
  for (var b = 0; b < batches.length; b++) {
    var batch = batches[b];
    var itemCodes = [];
    for (var i = 0; i < Math.min(batch.items.length, 5); i++) {
      itemCodes.push(batch.items[i].mgmtCode);
    }
    var codePreview = itemCodes.join(', ');
    if (batch.items.length > 5) codePreview += ' ... 他' + (batch.items.length - 5) + '品';

    addChoiceDashboardRow_(
      b + 1,
      batch.items.length,
      batch.totalFiles,
      formatBytes_(batch.totalSize),
      '📋 ドライラン',
      codePreview
    );
  }

  // 未マッチ品の記録
  if (unmatchedCodes.length > 0) {
    var dashSheet = ss.getSheetByName(SHEET_NAMES.CHOICE_DASHBOARD);
    if (dashSheet) {
      var lastRow = dashSheet.getLastRow() + 2;
      dashSheet.getRange(lastRow, 1).setValue('⚠️ 未マッチ品（' + unmatchedCodes.length + '件）')
        .setFontWeight('bold').setFontColor('#E65100');
      for (var u = 0; u < unmatchedCodes.length; u++) {
        dashSheet.getRange(lastRow + 1 + u, 1).setValue(unmatchedCodes[u]);
      }
    }
  }
}


// =========================================================================
// バッチTSVシート生成
// =========================================================================

function deleteBatchTsvSheets_(ss, batchNum) {
  var existingSheetNames = ss.getSheets().map(function(existingSheet) {
    return existingSheet.getName();
  });
  var staleSheetNames = findBatchSheetNames_(existingSheetNames, batchNum);
  for (var staleIdx = 0; staleIdx < staleSheetNames.length; staleIdx++) {
    var staleSheet = ss.getSheetByName(staleSheetNames[staleIdx]);
    if (staleSheet) ss.deleteSheet(staleSheet);
  }
}

/**
 * バッチ対応のTSVシートを生成する
 * @param {Spreadsheet} ss - スプレッドシート
 * @param {number} batchNum - バッチ番号
 * @param {Object} batch - バッチデータ { items, totalSize, totalFiles }
 * @param {Array} headers - 元TSVのヘッダー行
 * @param {Array} imageColIndices - 画像カラムの { index, name } 配列
 * @param {number} mgmtCodeIdx - 管理コードカラムのインデックス
 */
function _generateBatchTsvSheet(ss, batchNum, batch, headers, imageColIndices, mgmtCodeIdx) {
  var itemCount = batch.items.length;
  var sheetName = 'tsv_b' + batchNum + '_' + itemCount + '品';

  // 同じバッチ番号の旧出力をすべて削除
  deleteBatchTsvSheets_(ss, batchNum);

  var sheet = ss.insertSheet(sheetName);

  // お礼の品画像（メイン画像）カラムのインデックス取得
  var mainImageColName = getSettingValue_(SETTING_KEYS.CHOICE_MAIN_IMAGE_COL) || 'お礼の品画像';
  var mainImageIdx = headers.indexOf(mainImageColName);

  // データ行
  var outputRows = [];
  for (var i = 0; i < batch.items.length; i++) {
    var item = batch.items[i];
    var rowData = item.tsvRowData.slice(); // コピー

    // 画像カラムの値を一旦クリア
    for (var ic = 0; ic < imageColIndices.length; ic++) {
      rowData[imageColIndices[ic].index] = '';
    }
    if (mainImageIdx !== -1) {
      rowData[mainImageIdx] = '';
    }

    // 実際にマッチした画像名を、その画像番号（imageNum）に対応するカラムに正確にセットする
    for (var f = 0; f < item.files.length; f++) {
      var matchedFile = item.files[f];
      var imgNum = matchedFile.imageNum;
      var targetColIdx = imgNum - 1;
      if (targetColIdx < imageColIndices.length) {
        rowData[imageColIndices[targetColIdx].index] = matchedFile.fileInfo.name;
      }

      // スライド画像1（_1）がある場合、お礼の品画像カラムにもマッピング
      if (imgNum === 1 && mainImageIdx !== -1) {
        rowData[mainImageIdx] = matchedFile.fileInfo.name;
      }
    }
    outputRows.push(rowData);
  }

  var outputTable = stripInternalColumns_(headers, outputRows, ['出力バッチ']);
  var outputHeaders = outputTable.headers;
  outputRows = outputTable.rows;

  // ヘッダー行
  sheet.getRange(1, 1, 1, outputHeaders.length).setValues([outputHeaders]);
  sheet.getRange(1, 1, 1, outputHeaders.length)
    .setBackground('#424242')
    .setFontColor('#FFFFFF')
    .setFontWeight('bold');

  if (outputRows.length > 0) {
    var outputRange = sheet.getRange(2, 1, outputRows.length, outputHeaders.length);
    var plainTextFormats = outputRows.map(function(row) {
      return row.map(function() { return '@'; });
    });
    // TSV登録値を数値・日時へ再解釈させず、choice_tsvの表示値をそのまま保持する。
    outputRange.setNumberFormats(plainTextFormats);
    outputRange.setValues(outputRows);
  }

  // シート末尾にバッチ情報メモ
  var infoRow = outputRows.length + 3;
  sheet.getRange(infoRow, 1).setValue('--- バッチ ' + batchNum + ' 情報 ---')
    .setFontWeight('bold').setFontColor('#666666');
  sheet.getRange(infoRow + 1, 1).setValue('品数: ' + batch.items.length);
  sheet.getRange(infoRow + 2, 1).setValue('画像数: ' + batch.totalFiles);
  sheet.getRange(infoRow + 3, 1).setValue('合計サイズ: ' + formatBytes_(batch.totalSize));

  sheet.setFrozenRows(1);
}




// =========================================================================
// ヘルパー関数
// =========================================================================

// 共通ヘルパー関数はUtils.jsへ移行しました

/**
 * 指定ヘッダーの既存インデックス、または追加先インデックスを返す
 * @param {Array} headers - ヘッダー行
 * @param {*} headerName - 検索するヘッダー名
 * @returns {number} 0始まりのインデックス
 */
function getOrAppendHeaderIndex_(headers, headerName) {
  var index = headers.indexOf(headerName);
  return index === -1 ? headers.length : index;
}

/**
 * 内部管理列を除外したヘッダーと行を返す
 * @param {Array} headers - ヘッダー行
 * @param {Array<Array>} rows - データ行
 * @param {Array} internalHeaders - 除外するヘッダー名
 * @returns {{headers: Array, rows: Array<Array>}} 列射影後のテーブル
 */
function stripInternalColumns_(headers, rows, internalHeaders) {
  var keepIndices = headers.map(function(_, index) {
    return index;
  }).filter(function(index) {
    return internalHeaders.indexOf(String(headers[index]).trim()) === -1;
  });

  return {
    headers: keepIndices.map(function(index) {
      return headers[index];
    }),
    rows: rows.map(function(row) {
      return keepIndices.map(function(index) {
        return row[index];
      });
    }),
  };
}

/**
 * 指定バッチ番号のTSVシート名を抽出する
 * @param {Array<string>} sheetNames - シート名一覧
 * @param {number} batchNum - バッチ番号
 * @returns {Array<string>} 一致したシート名
 */
function findBatchSheetNames_(sheetNames, batchNum) {
  var prefix = 'tsv_b' + batchNum + '_';
  return sheetNames.filter(function(name) {
    return name.indexOf(prefix) === 0;
  });
}

/**
 * 元TSVシートにバッチ割り当て情報を書き戻す（マーキング）
 * @param {Sheet} tsvSheet - 元TSVのシートオブジェクト
 * @param {Array} tsvData - 元TSVのデータ
 * @param {Array} headers - 元TSVのヘッダー
 * @param {Array} batches - 分割バッチデータ
 */
function _writeBackBatchMarkings(tsvSheet, tsvData, headers, batches) {
  var markingValues = [];
  for (var r = 0; r < tsvData.length; r++) {
    markingValues.push([r === 0 ? '出力バッチ' : '未マッチ']);
  }

  for (var b = 0; b < batches.length; b++) {
    var batchNum = b + 1;
    var batchFolderName = BATCH_CONFIG.BATCH_FOLDER_PREFIX + padNumber_(batchNum, 3);
    var batchItems = batches[b].items;
    for (var i = 0; i < batchItems.length; i++) {
      var item = batchItems[i];
      markingValues[item.rowIndex] = [batchFolderName];
    }
  }

  var targetCol = getOrAppendHeaderIndex_(headers, '出力バッチ') + 1;
  tsvSheet.getRange(1, targetCol, markingValues.length, 1).setValues(markingValues);
  
  tsvSheet.getRange(1, targetCol)
    .setBackground('#424242')
    .setFontColor('#FFFFFF')
    .setFontWeight('bold');
    
  tsvSheet.autoResizeColumn(targetCol);
}

function writeChoiceBatchOutcomeMarkings_(
  tsvSheet,
  tsvData,
  headers,
  batchNum,
  completedRowIndices,
  failedRowIndices
) {
  var targetCol = getOrAppendHeaderIndex_(headers, '出力バッチ') + 1;
  var markingValues = tsvSheet.getRange(1, targetCol, tsvData.length, 1).getValues();
  markingValues[0] = ['出力バッチ'];
  var batchFolderName = BATCH_CONFIG.BATCH_FOLDER_PREFIX + padNumber_(batchNum, 3);

  for (var i = 0; i < completedRowIndices.length; i++) {
    markingValues[completedRowIndices[i]] = [batchFolderName];
  }
  for (var f = 0; f < failedRowIndices.length; f++) {
    markingValues[failedRowIndices[f]] = ['エラー'];
  }

  tsvSheet.getRange(1, targetCol, markingValues.length, 1).setValues(markingValues);
  tsvSheet.getRange(1, targetCol)
    .setBackground('#424242')
    .setFontColor('#FFFFFF')
    .setFontWeight('bold');
  tsvSheet.autoResizeColumn(targetCol);
}

/**
 * 指定されたバッチのシートから、ヘッダーとメタ情報を除いたTSVテキストを取得する
 * @param {number} batchNum - バッチ番号
 * @returns {string} TSVテキスト（データが見つからない場合は空文字）
 */
function serializeChoiceTsvCell_(value) {
  var text = String(value);
  if (!/[\t\r\n"]/.test(text)) return text;
  return '"' + text.replace(/"/g, '""') + '"';
}

function getBatchTsvText(batchNum) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheets = ss.getSheets();
  var targetPrefix = 'tsv_b' + batchNum + '_';
  var targetSheet = null;

  for (var i = 0; i < sheets.length; i++) {
    if (sheets[i].getName().indexOf(targetPrefix) === 0) {
      targetSheet = sheets[i];
      break;
    }
  }

  if (!targetSheet) return '';

  var data = targetSheet.getDataRange().getDisplayValues();
  if (data.length < 2) return '';

  var tsvLines = [];
  
  for (var row = 1; row < data.length; row++) {
    var firstCell = String(data[row][0]);
    if (firstCell.indexOf('--- バッチ') === 0 || firstCell.trim() === '--- バッチ ' + batchNum + ' 情報 ---') {
      break;
    }
    
    var line = data[row].map(serializeChoiceTsvCell_).join('\t');
    
    tsvLines.push(line);
  }

  while (tsvLines.length > 0 && tsvLines[tsvLines.length - 1].replace(/\t/g, '').trim() === '') {
    tsvLines.pop();
  }

  return tsvLines.join('\n');
}

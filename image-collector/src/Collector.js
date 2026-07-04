/**
 * ==============================================================================
 * 画像集約エンジン (Collector.js)
 * Googleドライブフォルダ内の画像を統合先フォルダにコピーするコアロジック
 * ==============================================================================
 */

// =========================================================================
// エントリーポイント
// =========================================================================

function hasPendingCollectWork_(props, triggers) {
  if (props.getProperty(PROP_KEYS.PROGRESS) ||
      props.getProperty(PROP_KEYS.CONFIG) ||
      props.getProperty(PROP_KEYS.QUEUE_CONFIG)) return true;
  for (var i = 0; i < triggers.length; i++) {
    var handler = triggers[i].getHandlerFunction();
    if (handler === 'runQueuedCollect' || handler === 'resumeCollect') return true;
  }
  return false;
}

function isDuplicateCollectFolder_(seenFolderIds, folderId) {
  if (seenFolderIds[folderId]) return true;
  seenFolderIds[folderId] = true;
  return false;
}

/**
 * 画像集約を予約してすぐに戻る（ダイアログから呼ばれる）
 * @param {string} dialogConfig - ダイアログから渡された設定(JSON文字列)
 */
function startCollect(dialogConfig) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(3000)) {
    throw new Error('他の集約処理が実行中です。完了後に再実行してください。');
  }

  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var props = PropertiesService.getScriptProperties();
    if (hasPendingCollectWork_(props, ScriptApp.getProjectTriggers())) {
      throw new Error('画像集約が予約、実行、または再開待ちです。完了後に再実行してください。');
    }
    deleteTriggersByFunction_('runQueuedCollect');
    props.setProperty(PROP_KEYS.QUEUE_CONFIG, dialogConfig);
    ScriptApp.newTrigger('runQueuedCollect').timeBased().after(1000).create();
    var masterSheet = ss.getSheetByName(SHEET_NAMES.MASTER);
    initDashboard_(masterSheet ? Math.max(0, masterSheet.getLastRow() - 1) : 0, false);
    updateDashboardStatus_('🕒 予約済み');
    ss.toast(
      '画像集約を予約しました。通常1分以内に開始します。進捗はdashboardシートで確認してください。',
      '📷 画像集約',
      10
    );
  } finally {
    lock.releaseLock();
  }
}

/**
 * 予約された集約処理をトリガーから実行する
 */
function runQueuedCollect() {
  deleteTriggersByFunction_('runQueuedCollect');

  var props = PropertiesService.getScriptProperties();
  var configStr = props.getProperty(PROP_KEYS.QUEUE_CONFIG);
  props.deleteProperty(PROP_KEYS.QUEUE_CONFIG);
  if (!configStr) {
    Logger.log('予約された画像集約設定がありません。');
    return;
  }

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(3000)) {
    props.setProperty(PROP_KEYS.QUEUE_CONFIG, configStr);
    ScriptApp.newTrigger('runQueuedCollect').timeBased().after(EXEC_CONFIG.RESUME_DELAY_MS).create();
    Logger.log('他の処理が実行中のため、画像集約を再予約しました。');
    return;
  }

  try {
    var config = JSON.parse(configStr);
    _runCollect(config, null, true);
  } catch (e) {
    updateDashboardStatus_('❌ 異常終了');
    completeOperation_({ operation: '画像集約', mode: '本実行', status: '異常終了', errors: 1, detail: e.message },
      '❌ 佐渡市 画像集約 異常終了', '画像集約が異常終了しました。\n\n' + e.message, true);
    throw e;
  } finally {
    lock.releaseLock();
  }
}

/**
 * 選択行のみテスト実行する
 */
function executeTestRow() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ui = SpreadsheetApp.getUi();
  var sheet = ss.getSheetByName(SHEET_NAMES.MASTER);
  if (!sheet) {
    ui.alert('エラー: 「' + SHEET_NAMES.MASTER + '」シートが見つかりません。');
    return;
  }

  var range = sheet.getActiveRange();
  if (!range || range.getRow() < 2) {
    ui.alert('データ行（2行目以降）を選択してください。');
    return;
  }

  // 選択範囲の行番号を収集
  var startRow = range.getRow();
  var endRow = startRow + range.getNumRows() - 1;
  var selectedRows = [];
  for (var r = startRow; r <= endRow; r++) {
    selectedRows.push(r);
  }

  _runCollect({ isDryRun: false }, selectedRows, false);
}

/**
 * ドライランを実行する（コピーせずにカウントのみ）
 * @param {string} dialogConfig - ダイアログから渡された設定(JSON文字列)
 */
function startDryRun(dialogConfig) {
  var config = JSON.parse(dialogConfig);
  config.isDryRun = true;
  _runCollect(config, null, false);
}


// =========================================================================
// コアロジック
// =========================================================================

/**
 * 画像集約の内部実装
 * @param {Object} config - 設定
 * @param {Array<number>|null} [testRows] - テスト時の行番号配列
 * @param {boolean} [suppressUi] - トリガー実行時はtrue
 */
function _runCollect(config, testRows, suppressUi) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ui = suppressUi ? null : SpreadsheetApp.getUi();
  var startTime = Date.now();
  var isDryRun = config.isDryRun || false;

  // --- 1. 設定値取得 ---
  var destFolderUrl = getSettingValue_(SETTING_KEYS.DEST_FOLDER_URL);
  if (!destFolderUrl) {
    notifyMessage_(ui, ss, 'エラー', 'settingシートに「' + SETTING_KEYS.DEST_FOLDER_URL + '」が設定されていません。\n先に「初期設定」を実行してください。');
    return;
  }

  // --- 2. シート・カラム検出 ---
  var sheet = ss.getSheetByName(SHEET_NAMES.MASTER);
  if (!sheet) {
    notifyMessage_(ui, ss, 'エラー', '「' + SHEET_NAMES.MASTER + '」シートが見つかりません。');
    return;
  }

  var data = sheet.getDataRange().getValues();
  if (data.length < 2) {
    notifyMessage_(ui, ss, 'エラー', 'データがありません。');
    return;
  }

  var colMap = createColumnMap_(data[0]);
  var mgmtCodeIdx = colMap[MASTER_COLUMNS.MGMT_CODE];
  var folderLinkIdx = colMap[MASTER_COLUMNS.FOLDER_LINK];

  if (mgmtCodeIdx === undefined) {
    notifyMessage_(ui, ss, 'エラー', '「' + MASTER_COLUMNS.MGMT_CODE + '」カラムが見つかりません。');
    return;
  }
  if (folderLinkIdx === undefined) {
    notifyMessage_(ui, ss, 'エラー', '「' + MASTER_COLUMNS.FOLDER_LINK + '」カラムが見つかりません。');
    return;
  }

  // --- 3. 統合先フォルダ取得 ---
  var destFolder;
  try {
    destFolder = DriveApp.getFolderById(extractFolderIdFromUrl_(destFolderUrl));
  } catch (e) {
    notifyMessage_(ui, ss, 'エラー', '統合先フォルダにアクセスできません。\n' + e.message);
    return;
  }

  // --- 4. 統合先の既存ファイル一覧を構築（重複チェック用） ---
  var existingFiles = buildExistingFileSet_(destFolder);

  // --- 5. 処理対象行の決定 ---
  var targetRows = [];
  if (testRows) {
    // テスト: 指定行のみ
    for (var t = 0; t < testRows.length; t++) {
      targetRows.push(testRows[t] - 1); // 0-indexed
    }
  } else {
    // 全行
    for (var a = 1; a < data.length; a++) {
      targetRows.push(a);
    }
  }

  // --- 6. 進捗管理 ---
  var props = PropertiesService.getScriptProperties();
  var startIdx = 0;
  var savedObj = null;

  if (!testRows && !isDryRun) {
    var saved = props.getProperty(PROP_KEYS.PROGRESS);
    if (saved) {
      savedObj = JSON.parse(saved);
      startIdx = savedObj.targetIndex || 0;
      Logger.log('前回の続きから再開: ' + startIdx + '番目');
    }
  }

  var totalRows = targetRows.length;
  var isResume = !testRows && !isDryRun && !!savedObj;
  if (!testRows && !isResume) initDashboard_(totalRows, isDryRun);
  if (!testRows || !isDryRun) {
    updateDashboardStatus_(isDryRun ? '📋 ドライラン実行中' : '処理中');
  }

  var stats = _buildStats_(savedObj, startTime, totalRows);
  var seenSourceFolderIds = {};
  for (var previous = 0; previous < startIdx; previous++) {
    var previousRow = data[targetRows[previous]];
    var previousLink = previousRow ? String(previousRow[folderLinkIdx]).trim() : '';
    if (!previousLink) continue;
    try { seenSourceFolderIds[extractFolderIdFromUrl_(previousLink)] = true; } catch (ignored) {}
  }

  // --- 7. メインループ ---
  for (var idx = startIdx; idx < targetRows.length; idx++) {
    // タイムアウトチェック
    if (!testRows && !isDryRun && (Date.now() - startTime > EXEC_CONFIG.TIME_LIMIT_MS)) {
      props.setProperty(PROP_KEYS.PROGRESS, JSON.stringify({
        targetIndex: idx,
        stats: _snapshotStats_(stats),
      }));
      props.setProperty(PROP_KEYS.CONFIG, JSON.stringify(config));
      ScriptApp.newTrigger('resumeCollect').timeBased().after(EXEC_CONFIG.RESUME_DELAY_MS).create();
      updateDashboardStatus_('⏸️ 中断(再開待ち)');
      updateDashboardSummary_(stats);
      ss.toast('時間制限で中断しました。1分後に自動再開します。', '⏸️ 中断', 10);
      return;
    }

    var rowIdx = targetRows[idx];
    var row = data[rowIdx];
    var rowNum = rowIdx + 1;
    var mgmtCode = String(row[mgmtCodeIdx]).trim();
    var folderLink = String(row[folderLinkIdx]).trim();

    // 空行スキップ
    if (!mgmtCode || !folderLink) {
      stats.processedRows++;
      stats.skipCount++;
      addDashboardRow_(rowNum, mgmtCode || '(空)', folderLink, '0/0', '⏭️ スキップ', 'データなし');
      continue;
    }

    // ソースフォルダを取得
    var sourceFolder;
    try {
      var sourceFolderId = extractFolderIdFromUrl_(folderLink);
      if (isDuplicateCollectFolder_(seenSourceFolderIds, sourceFolderId)) {
        stats.processedRows++;
        stats.skipCount++;
        addDashboardRow_(rowNum, mgmtCode, folderLink, '0/0', '⏭️ スキップ', '同一フォルダの重複行');
        continue;
      }
      sourceFolder = DriveApp.getFolderById(sourceFolderId);
    } catch (e) {
      stats.processedRows++;
      stats.errorCount++;
      addDashboardRow_(rowNum, mgmtCode, folderLink, '0/0', '❌ エラー', 'フォルダアクセス失敗: ' + e.message);
      continue;
    }

    // フォルダ内のファイルを列挙してコピー
    var result = _copyFilesFromFolder(sourceFolder, destFolder, existingFiles, isDryRun);

    // 統計更新
    stats.successCount += result.copied;
    stats.duplicateCount += result.duplicates;
    stats.errorCount += result.errors;
    stats.processedRows++;

    // ダッシュボード行ログ
    if (!isDryRun) {
      var statusEmoji;
      if (result.errors > 0) {
        statusEmoji = result.copied > 0 ? '⚠️ 一部失敗' : '❌ 全失敗';
      } else if (result.copied > 0) {
        statusEmoji = '✅ 完了';
      } else if (result.duplicates > 0) {
        statusEmoji = '⏭️ 全重複';
      } else {
        statusEmoji = '⏭️ ファイルなし';
      }

      var notes = [];
      if (result.copied > 0) notes.push('コピー: ' + result.copied + '枚');
      if (result.duplicates > 0) notes.push('重複スキップ: ' + result.duplicates + '枚');
      if (result.errors > 0) notes.push('エラー: ' + result.errors + '件');
      if (result.details.length > 0) notes.push(result.details.join('; '));

      addDashboardRow_(
        rowNum,
        mgmtCode,
        folderLink,
        result.copied + '/' + result.total,
        statusEmoji,
        notes.join(' | ')
      );
    }

    // バッチ更新
    if (!isDryRun && stats.processedRows % EXEC_CONFIG.DASHBOARD_BATCH_UPDATE === 0) {
      updateDashboardSummary_(stats);
      ss.toast('処理中: ' + stats.processedRows + '/' + totalRows + '行', '📷', 3);
    }
  }

  // --- 8. 完了処理 ---
  if (!isDryRun) {
    props.deleteProperty(PROP_KEYS.PROGRESS);
    props.deleteProperty(PROP_KEYS.CONFIG);
    deleteTriggersByFunction_('resumeCollect');
  }
  updateDashboardSummary_(stats);
  updateDashboardStatus_(isDryRun ? '📋 ドライラン完了' : '✅ 完了');

  var modeLabel = isDryRun ? 'ドライラン' : '画像集約';
  var copyResultLabel = isDryRun ? '✅ コピー予定: ' : '✅ コピー成功: ';
  var summary = modeLabel + '完了\n\n' +
    copyResultLabel + stats.successCount + '枚\n' +
    '📋 重複スキップ: ' + stats.duplicateCount + '枚\n' +
    '⏭️ その他スキップ: ' + stats.skipCount + '枚\n' +
    '❌ エラー: ' + stats.errorCount + '件\n' +
    '処理行数: ' + stats.processedRows + '/' + totalRows;

  if (!isDryRun) {
    completeOperation_({ operation: '画像集約', mode: '本実行', status: '完了', success: stats.successCount,
      skipped: stats.skipCount + stats.duplicateCount, errors: stats.errorCount, detail: summary },
      '📷 佐渡市 ' + modeLabel + '完了', summary, true);
  } else {
    recordOperationResult_({ operation: '画像集約', mode: 'ドライラン', status: '完了', success: stats.successCount,
      skipped: stats.skipCount + stats.duplicateCount, errors: stats.errorCount, detail: summary });
  }
  notifyMessage_(ui, ss, '完了', summary);
}


// =========================================================================
// ファイルコピー
// =========================================================================

/**
 * ソースフォルダ内の全ファイルを統合先にコピーする
 * @param {Folder} sourceFolder - ソースフォルダ
 * @param {Folder} destFolder - 統合先フォルダ
 * @param {Object} existingFiles - 既存ファイル名セット（小文字キー）
 * @param {boolean} isDryRun - ドライラン
 * @returns {Object} { copied, duplicates, errors, total, details }
 */
function _copyFilesFromFolder(sourceFolder, destFolder, existingFiles, isDryRun) {
  var result = { copied: 0, duplicates: 0, errors: 0, total: 0, details: [] };

  var fileIter = sourceFolder.getFiles();
  while (fileIter.hasNext()) {
    var file = fileIter.next();
    var fileName = file.getName();
    var fileNameLower = fileName.toLowerCase();
    result.total++;

    // 画像ファイルのみ対象（jpg, jpeg, png, gif, webp）
    var mimeType = file.getMimeType();
    if (!_isImageMimeType(mimeType)) {
      result.details.push(fileName + ': 画像以外のためスキップ (' + mimeType + ')');
      continue;
    }

    // 重複チェック
    if (existingFiles[fileNameLower]) {
      result.duplicates++;
      result.details.push(fileName + ': 重複スキップ');
      continue;
    }

    if (isDryRun) {
      result.copied++;
      existingFiles[fileNameLower] = true;
      continue;
    }

    try {
      file.makeCopy(fileName, destFolder);
      existingFiles[fileNameLower] = true;
      result.copied++;
    } catch (e) {
      result.errors++;
      result.details.push(fileName + ': コピー失敗 - ' + e.message);
      Logger.log('ファイルコピーエラー: ' + fileName + ' → ' + e.message);
    }
  }

  return result;
}

/**
 * MIMEタイプが画像かどうかを判定する
 * @param {string} mimeType - MIMEタイプ
 * @returns {boolean}
 */
function _isImageMimeType(mimeType) {
  if (!mimeType) return false;
  return mimeType.indexOf('image/') === 0;
}


// =========================================================================
// 統計管理
// =========================================================================

/**
 * 統計情報を構築する
 * @param {?Object} savedProgress - 保存された進捗
 * @param {number} startTime - 開始時刻
 * @param {number} totalRows - 全処理行数
 * @returns {Object}
 */
function _buildStats_(savedProgress, startTime, totalRows) {
  var savedStats = savedProgress && savedProgress.stats ? savedProgress.stats : {};
  return {
    startTime: Number(savedStats.startTime) || startTime,
    totalRows: totalRows,
    processedRows: Number(savedStats.processedRows) || 0,
    successCount: Number(savedStats.successCount) || 0,
    skipCount: Number(savedStats.skipCount) || 0,
    duplicateCount: Number(savedStats.duplicateCount) || 0,
    errorCount: Number(savedStats.errorCount) || 0,
  };
}

/**
 * 再開時に引き継ぐ統計だけを保存する
 * @param {Object} stats - 統計
 * @returns {Object}
 */
function _snapshotStats_(stats) {
  return {
    startTime: stats.startTime,
    processedRows: stats.processedRows,
    successCount: stats.successCount,
    skipCount: stats.skipCount,
    duplicateCount: stats.duplicateCount,
    errorCount: stats.errorCount,
  };
}


// =========================================================================
// 自動再開
// =========================================================================

/**
 * タイムアウト後の自動再開関数（トリガーから呼ばれる）
 */
function resumeCollect() {
  var props = PropertiesService.getScriptProperties();
  var progressStr = props.getProperty(PROP_KEYS.PROGRESS);
  var configStr = props.getProperty(PROP_KEYS.CONFIG);

  if (!progressStr) {
    Logger.log('再開データがありません。');
    deleteTriggersByFunction_('resumeCollect');
    return;
  }

  var config = configStr ? JSON.parse(configStr) : {};

  // トリガー削除
  deleteTriggersByFunction_('resumeCollect');

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(3000)) {
    ScriptApp.newTrigger('resumeCollect').timeBased().after(EXEC_CONFIG.RESUME_DELAY_MS).create();
    Logger.log('他の処理が実行中のため、再開を再予約しました。');
    return;
  }

  try {
    _runCollect(config, null, true);
  } catch (e) {
    updateDashboardStatus_('❌ 異常終了');
    completeOperation_({ operation: '画像集約', mode: '自動再開', status: '異常終了', errors: 1, detail: e.message },
      '❌ 佐渡市 画像集約 異常終了', '画像集約の自動再開中に異常終了しました。\n\n' + e.message, true);
    throw e;
  } finally {
    lock.releaseLock();
  }
}

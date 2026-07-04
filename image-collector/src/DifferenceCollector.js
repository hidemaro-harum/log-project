/** Image difference collection: copies only names absent from both destination folders. */

function classifyDifferenceFile_(fileName, integratedFiles, differenceFiles) {
  var key = String(fileName).toLowerCase();
  if (integratedFiles[key]) return 'INTEGRATED';
  if (differenceFiles[key]) return 'DIFF_EXISTS';
  return 'NEW';
}

var DIFFERENCE_DETAIL_MAX_ENTRIES_ = 100;
var DIFFERENCE_DETAIL_MAX_CHARS_ = 40000;

function appendDifferenceDetail_(details, text) {
  var marker = /\u4ed6(\d+)\u4ef6\u7701\u7565$/;
  var last = details.length ? String(details[details.length - 1]) : '';
  var match = last.match(marker);
  if (match) {
    details[details.length - 1] = '他' + (Number(match[1]) + 1) + '件省略';
    return;
  }
  var currentChars = details.join('; ').length;
  if (details.length < DIFFERENCE_DETAIL_MAX_ENTRIES_ && currentChars + String(text).length + 2 <= DIFFERENCE_DETAIL_MAX_CHARS_) {
    details.push(String(text));
  } else {
    details.push('他1件省略');
  }
}

function copyDifferenceFilesFromFolder_(sourceFolder, differenceFolder, integratedFiles, differenceFiles, isDryRun) {
  var result = { copied: 0, integratedSkipped: 0, diffExistingSkipped: 0, nonImages: 0, errors: 0, total: 0, details: [] };
  var files = sourceFolder.getFiles();
  while (files.hasNext()) {
    var file = files.next();
    var name = file.getName();
    var mime = file.getMimeType();
    var key = String(name).toLowerCase();
    result.total++;
    if (!mime || mime.indexOf('image/') !== 0) {
      result.nonImages++;
      appendDifferenceDetail_(result.details, name + ': 画像以外 (' + mime + ')');
      continue;
    }
    var classification = classifyDifferenceFile_(name, integratedFiles, differenceFiles);
    if (classification === 'INTEGRATED') {
      result.integratedSkipped++;
      appendDifferenceDetail_(result.details, name + ': 統合済み');
      continue;
    }
    if (classification === 'DIFF_EXISTS') {
      result.diffExistingSkipped++;
      appendDifferenceDetail_(result.details, name + ': 差分コピー済み');
      continue;
    }
    if (isDryRun) {
      differenceFiles[key] = true;
      result.copied++;
      continue;
    }
    try {
      file.makeCopy(name, differenceFolder);
      differenceFiles[key] = true;
      result.copied++;
    } catch (e) {
      result.errors++;
      appendDifferenceDetail_(result.details, name + ': コピー失敗 - ' + e.message);
      if (typeof Logger !== 'undefined') Logger.log('差分画像コピー失敗: ' + name + ' - ' + e.message);
    }
  }
  return result;
}

function restoreDifferenceStats_(checkpoint) {
  var saved = checkpoint && checkpoint.stats ? checkpoint.stats : {};
  return {
    processedRows: Number(saved.processedRows) || 0,
    copied: Number(saved.copied) || 0,
    integratedSkipped: Number(saved.integratedSkipped) || 0,
    diffExistingSkipped: Number(saved.diffExistingSkipped) || 0,
    otherSkipped: Number(saved.otherSkipped) || 0,
    errorCount: Number(saved.errorCount) || 0,
  };
}

function buildDifferenceCheckpoint_(targetIndex, stats) {
  return { targetIndex: targetIndex, stats: restoreDifferenceStats_({ stats: stats }) };
}

function isValidDifferenceCheckpoint_(checkpoint) {
  return !!checkpoint && typeof checkpoint === 'object' &&
    Number.isFinite(Number(checkpoint.targetIndex)) && Number(checkpoint.targetIndex) >= 0 &&
    !!checkpoint.stats && typeof checkpoint.stats === 'object';
}

function buildDifferenceFailureDetail_(error, checkpoint, totalRows) {
  var safe = checkpoint || buildDifferenceCheckpoint_(0, null);
  var stats = restoreDifferenceStats_(safe);
  var current = Math.max(0, Number(safe.targetIndex) || 0);
  var total = Math.max(current + 1, Number(totalRows) || 0);
  return 'エラー: ' + (error && error.message ? error.message : String(error)) + '\n' +
    '現在位置: ' + (current + 1) + '/' + total + '\n' +
    '処理済み行: ' + stats.processedRows + '\n' +
    'コピー: ' + stats.copied + '\n' +
    '統合済み: ' + stats.integratedSkipped + '\n' +
    '差分コピー済み: ' + stats.diffExistingSkipped + '\n' +
    'その他スキップ: ' + stats.otherSkipped + '\n' +
    'エラー: ' + stats.errorCount;
}

function buildDifferenceAbnormalEntry_(mode, error) {
  var stats = restoreDifferenceStats_(error && error.differenceCheckpoint);
  return {
    operation: '画像差分抽出',
    mode: mode,
    status: '異常終了',
    success: stats.copied,
    skipped: stats.integratedSkipped + stats.diffExistingSkipped + stats.otherSkipped,
    errors: Math.max(1, stats.errorCount),
    detail: error && (error.differenceDetail || error.message) || '不明なエラー',
  };
}

function scheduleSingleDifferenceTrigger_(handler, delayMs) {
  deleteTriggersByFunction_(handler);
  ScriptApp.newTrigger(handler).timeBased().after(delayMs).create();
}

function persistDifferenceRecoveryState_(props, config, checkpoint) {
  try {
    props.setProperty(PROP_KEYS.DIFF_PROGRESS, JSON.stringify(checkpoint));
    props.setProperty(PROP_KEYS.DIFF_CONFIG, JSON.stringify(config || {}));
    props.deleteProperty(PROP_KEYS.DIFF_QUEUE_CONFIG);
    deleteTriggersByFunction_('runQueuedDifferenceCollect');
    scheduleSingleDifferenceTrigger_('resumeDifferenceCollect', EXEC_CONFIG.RESUME_DELAY_MS);
  } catch (stateError) {
    clearDifferenceState_();
    throw stateError;
  }
}

function hasPendingDifferenceWork_(props, triggers) {
  if (props.getProperty(PROP_KEYS.DIFF_PROGRESS) || props.getProperty(PROP_KEYS.DIFF_CONFIG) ||
      props.getProperty(PROP_KEYS.DIFF_QUEUE_CONFIG)) return true;
  for (var i = 0; i < triggers.length; i++) {
    var handler = triggers[i].getHandlerFunction();
    if (handler === 'runQueuedDifferenceCollect' || handler === 'resumeDifferenceCollect') return true;
  }
  return false;
}

function differenceDashboardStats_(stats) {
  return {
    processedRows: stats.processedRows,
    successCount: stats.copied,
    skipCount: stats.integratedSkipped + stats.diffExistingSkipped + stats.otherSkipped,
    duplicateCount: stats.integratedSkipped + stats.diffExistingSkipped,
    errorCount: stats.errorCount,
  };
}

function processDifferenceCollectRows_(context) {
  var stats = context.stats;
  var seen = context.seenSourceFolderIds || {};
  for (var index = context.startIndex; index < context.targetRows.length; index++) {
    if (context.onRowStart) context.onRowStart(index);
    if (context.shouldStop && context.shouldStop()) return { completed: false, nextIndex: index };
    var rowIndex = context.targetRows[index];
    var row = context.data[rowIndex] || [];
    var rowNumber = rowIndex + 1;
    var mgmtCode = String(row[context.mgmtCodeIdx] || '').trim();
    var folderLink = String(row[context.folderLinkIdx] || '').trim();
    if (!mgmtCode || !folderLink) {
      stats.processedRows++; stats.otherSkipped++;
      if (context.onRowCommitted) context.onRowCommitted(index + 1, stats);
      addDashboardRow_(rowNumber, mgmtCode || '(空)', folderLink, '0/0', '⏭️ スキップ', 'データなし');
      continue;
    }
    var sourceFolder;
    try {
      var sourceId = extractFolderIdFromUrl_(folderLink);
      if (seen[sourceId]) {
        stats.processedRows++; stats.otherSkipped++;
        if (context.onRowCommitted) context.onRowCommitted(index + 1, stats);
        addDashboardRow_(rowNumber, mgmtCode, folderLink, '0/0', '⏭️ スキップ', '同一ソースフォルダの重複行');
        continue;
      }
      seen[sourceId] = true;
      sourceFolder = DriveApp.getFolderById(sourceId);
    } catch (e) {
      stats.processedRows++; stats.errorCount++;
      if (context.onRowCommitted) context.onRowCommitted(index + 1, stats);
      addDashboardRow_(rowNumber, mgmtCode, folderLink, '0/0', '❌ エラー', 'フォルダアクセス失敗: ' + e.message);
      continue;
    }
    var result;
    try {
      result = copyDifferenceFilesFromFolder_(sourceFolder, context.differenceFolder,
        context.integratedFiles, context.differenceFiles, context.isDryRun);
    } catch (e) {
      stats.processedRows++; stats.errorCount++;
      if (context.onRowCommitted) context.onRowCommitted(index + 1, stats);
      addDashboardRow_(rowNumber, mgmtCode, folderLink, '0/0', '❌ エラー',
        'ファイル列挙・判定失敗: ' + e.message);
      continue;
    }
    stats.processedRows++;
    stats.copied += result.copied;
    stats.integratedSkipped += result.integratedSkipped;
    stats.diffExistingSkipped += result.diffExistingSkipped;
    stats.otherSkipped += result.nonImages;
    stats.errorCount += result.errors;
    if (context.onRowCommitted) context.onRowCommitted(index + 1, stats);
    var notes = ['コピー: ' + result.copied, '統合済み: ' + result.integratedSkipped,
      '差分コピー済み: ' + result.diffExistingSkipped, '画像以外: ' + result.nonImages, 'エラー: ' + result.errors];
    if (result.details.length) notes.push(result.details.join('; '));
    var status = result.errors ? (result.copied ? '⚠️ 一部失敗' : '❌ エラー') : (result.copied ? '✅ 完了' : '⏭️ 対象なし');
    addDashboardRow_(rowNumber, mgmtCode, folderLink, result.copied + '/' + result.total, status, notes.join(' | '));
  }
  return { completed: true, nextIndex: context.targetRows.length };
}

function loadDifferenceCollectContext_(skipExistingScan) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var integratedUrl = getSettingValue_(SETTING_KEYS.DEST_FOLDER_URL);
  var differenceUrl = getSettingValue_(SETTING_KEYS.DIFF_DEST_FOLDER_URL);
  if (!integratedUrl) throw new Error('比較元の「' + SETTING_KEYS.DEST_FOLDER_URL + '」が未設定です。');
  if (!differenceUrl) throw new Error('「' + SETTING_KEYS.DIFF_DEST_FOLDER_URL + '」が未設定です。');
  var sheet = ss.getSheetByName(SHEET_NAMES.MASTER);
  if (!sheet) throw new Error('「' + SHEET_NAMES.MASTER + '」シートが見つかりません。');
  var data = sheet.getDataRange().getValues();
  if (!data.length) throw new Error('masterシートにヘッダーがありません。');
  var columns = createColumnMap_(data[0]);
  var missing = [];
  if (columns[MASTER_COLUMNS.MGMT_CODE] === undefined) missing.push(MASTER_COLUMNS.MGMT_CODE);
  if (columns[MASTER_COLUMNS.FOLDER_LINK] === undefined) missing.push(MASTER_COLUMNS.FOLDER_LINK);
  if (missing.length) throw new Error('必須ヘッダー不足: ' + missing.join(', '));
  var integratedId = extractFolderIdFromUrl_(integratedUrl);
  var differenceId = extractFolderIdFromUrl_(differenceUrl);
  if (integratedId === differenceId) throw new Error('統合先と差分保存先に同じフォルダは指定できません。');
  var integratedFolder = DriveApp.getFolderById(integratedId);
  var differenceFolder = DriveApp.getFolderById(differenceId);
  return { ss: ss, data: data, columns: columns, integratedFolder: integratedFolder,
    integratedId: integratedId, differenceId: differenceId,
    differenceFolder: differenceFolder,
    integratedFiles: skipExistingScan ? {} : buildExistingFileSet_(integratedFolder),
    differenceFiles: skipExistingScan ? {} : buildExistingFileSet_(differenceFolder) };
}

function listDifferenceDrivePage_(folderId, pageToken) {
  var options = {
    q: "'" + String(folderId).replace(/'/g, "\\'") + "' in parents and trashed = false",
    fields: 'nextPageToken,files(id,name,mimeType)',
    pageSize: 200,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  };
  if (pageToken) options.pageToken = pageToken;
  var response = Drive.Files.list(options);
  return { files: response.files || [], nextPageToken: response.nextPageToken || null };
}

function emptyDifferenceRowResult_() {
  return { copied: 0, integratedSkipped: 0, diffExistingSkipped: 0, nonImages: 0, errors: 0, total: 0, details: [] };
}

function checkpointDifferenceRowResult_(result) {
  if (!result) return null;
  return {
    copied: Number(result.copied) || 0,
    integratedSkipped: Number(result.integratedSkipped) || 0,
    diffExistingSkipped: Number(result.diffExistingSkipped) || 0,
    nonImages: Number(result.nonImages) || 0,
    errors: Number(result.errors) || 0,
    total: Number(result.total) || 0,
    details: [],
  };
}

function addDifferenceRowResultToStats_(stats, result) {
  stats.processedRows++;
  stats.copied += result.copied;
  stats.integratedSkipped += result.integratedSkipped;
  stats.diffExistingSkipped += result.diffExistingSkipped;
  stats.otherSkipped += result.nonImages;
  stats.errorCount += result.errors;
}

function createDifferenceScanCheckpoint_(checkpoint, stats) {
  return {
    targetIndex: Number(checkpoint && checkpoint.targetIndex) || 0,
    stats: restoreDifferenceStats_({ stats: stats }),
    phase: 'INTEGRATED_SCAN',
    scanPageToken: null,
    scanOffset: 0,
    resumeTargetIndex: Number(checkpoint && checkpoint.resumeTargetIndex) || Number(checkpoint && checkpoint.targetIndex) || 0,
    resumeSourcePageToken: checkpoint && checkpoint.resumeSourcePageToken || null,
    resumeSourceOffset: Number(checkpoint && checkpoint.resumeSourceOffset) || 0,
    resumeRowResult: checkpointDifferenceRowResult_(checkpoint && checkpoint.resumeRowResult),
  };
}

function sanitizeDifferencePagedCheckpoint_(checkpoint, stats) {
  return {
    targetIndex: Number(checkpoint && checkpoint.targetIndex) || 0,
    stats: restoreDifferenceStats_({ stats: stats }),
    phase: 'INTEGRATED_SCAN',
    scanPageToken: null,
    scanOffset: 0,
    resumeTargetIndex: Number(checkpoint && checkpoint.resumeTargetIndex) || Number(checkpoint && checkpoint.targetIndex) || 0,
    resumeSourcePageToken: checkpoint && checkpoint.resumeSourcePageToken || null,
    resumeSourceOffset: Number(checkpoint && checkpoint.resumeSourceOffset) || 0,
    resumeRowResult: checkpointDifferenceRowResult_(checkpoint && checkpoint.resumeRowResult),
  };
}

function buildDifferenceRowNotes_(result) {
  var notes = ['コピー: ' + result.copied, '統合済み: ' + result.integratedSkipped,
    '差分コピー済み: ' + result.diffExistingSkipped, '画像以外: ' + result.nonImages, 'エラー: ' + result.errors];
  if (result.details.length) notes.push(result.details.join('; '));
  return notes.join(' | ').slice(0, 49000);
}

function runDifferenceCollectPaged_(config, suppressUi, props, savedCheckpoint, context, startedAt) {
  var isDryRun = !!config.isDryRun;
  var stats = restoreDifferenceStats_(savedCheckpoint);
  var targetRows = [];
  for (var r = 1; r < context.data.length; r++) targetRows.push(r);
  var checkpoint = createDifferenceScanCheckpoint_(savedCheckpoint, stats);
  if (savedCheckpoint && savedCheckpoint.phase) {
    checkpoint = sanitizeDifferencePagedCheckpoint_(savedCheckpoint, stats);
    stats = checkpoint.stats;
  }
  var virtualDifferenceNames = {};
  var integratedNames = {};
  var differenceNames = {};

  function deadlineReached() {
    return !isDryRun && Date.now() - startedAt >= EXEC_CONFIG.TIME_LIMIT_MS;
  }
  function pause(current) {
    current.stats = restoreDifferenceStats_({ stats: stats });
    persistDifferenceRecoveryState_(props, config, current);
    updateDashboardSummary_(differenceDashboardStats_(stats));
    updateDashboardStatus_('⏸️ 差分抽出中断(再開待ち)');
    return { paused: true, stats: stats };
  }

  try {
    if (!savedCheckpoint) initDashboard_(targetRows.length, isDryRun);
    updateDashboardStatus_(isDryRun ? '📋 差分抽出ドライラン実行中' : '🆕 差分抽出処理中');
    while (checkpoint.phase === 'INTEGRATED_SCAN' || checkpoint.phase === 'DIFF_SCAN') {
      if (deadlineReached()) return pause(createDifferenceScanCheckpoint_(checkpoint, stats));
      var isIntegrated = checkpoint.phase === 'INTEGRATED_SCAN';
      var scanFolderId = isIntegrated ? context.integratedId : context.differenceId;
      var page = listDifferenceDrivePage_(scanFolderId, checkpoint.scanPageToken);
      if (deadlineReached()) return pause(createDifferenceScanCheckpoint_(checkpoint, stats));
      for (var fileIndex = checkpoint.scanOffset || 0; fileIndex < page.files.length; fileIndex++) {
        if (deadlineReached()) {
          return pause(createDifferenceScanCheckpoint_(checkpoint, stats));
        }
        var scanNameKey = String(page.files[fileIndex].name || '').toLowerCase();
        if (isIntegrated) integratedNames[scanNameKey] = true;
        else differenceNames[scanNameKey] = true;
        checkpoint.scanOffset = fileIndex + 1;
      }
      checkpoint.scanPageToken = page.nextPageToken;
      checkpoint.scanOffset = 0;
      if (!page.nextPageToken) {
        checkpoint.phase = isIntegrated ? 'DIFF_SCAN' : 'ROWS';
        checkpoint.scanPageToken = null;
      }
    }

    var startIndex = Number(checkpoint.resumeTargetIndex);
    if (!Number.isFinite(startIndex)) startIndex = Number(checkpoint.targetIndex) || 0;
    var seen = {};
    for (var previous = 0; previous < startIndex; previous++) {
      var oldRow = context.data[targetRows[previous]];
      var oldLink = oldRow ? String(oldRow[context.columns[MASTER_COLUMNS.FOLDER_LINK]] || '').trim() : '';
      if (oldLink) try { seen[extractFolderIdFromUrl_(oldLink)] = true; } catch (ignored) {}
    }
    for (var index = startIndex; index < targetRows.length; index++) {
      if (deadlineReached()) {
        checkpoint.targetIndex = index;
        checkpoint.resumeTargetIndex = index;
        return pause(createDifferenceScanCheckpoint_(checkpoint, stats));
      }
      var rowIndex = targetRows[index];
      var row = context.data[rowIndex] || [];
      var rowNumber = rowIndex + 1;
      var mgmtCode = String(row[context.columns[MASTER_COLUMNS.MGMT_CODE]] || '').trim();
      var folderLink = String(row[context.columns[MASTER_COLUMNS.FOLDER_LINK]] || '').trim();
      if (!mgmtCode || !folderLink) {
        stats.processedRows++; stats.otherSkipped++;
        checkpoint.targetIndex = index + 1;
        checkpoint.resumeTargetIndex = index + 1;
        addDashboardRow_(rowNumber, mgmtCode || '(空)', folderLink, '0/0', '⏭️ スキップ', 'データなし');
        continue;
      }
      var sourceId;
      try {
        sourceId = extractFolderIdFromUrl_(folderLink);
        if (seen[sourceId]) {
          stats.processedRows++; stats.otherSkipped++;
          checkpoint.targetIndex = index + 1;
          checkpoint.resumeTargetIndex = index + 1;
          addDashboardRow_(rowNumber, mgmtCode, folderLink, '0/0', '⏭️ スキップ', '同一ソースフォルダの重複行');
          continue;
        }
        seen[sourceId] = true;
      } catch (sourceError) {
        stats.processedRows++; stats.errorCount++;
        checkpoint.targetIndex = index + 1;
        checkpoint.resumeTargetIndex = index + 1;
        addDashboardRow_(rowNumber, mgmtCode, folderLink, '0/0', '❌ エラー', 'フォルダアクセス失敗: ' + sourceError.message);
        continue;
      }
      var sourceToken = index === startIndex ? checkpoint.resumeSourcePageToken : null;
      var sourceOffset = index === startIndex ? Number(checkpoint.resumeSourceOffset) || 0 : 0;
      var rowResult = index === startIndex && checkpoint.resumeRowResult ? checkpoint.resumeRowResult : emptyDifferenceRowResult_();
      do {
        var sourcePage;
        try { sourcePage = listDifferenceDrivePage_(sourceId, sourceToken); }
        catch (listError) {
          rowResult.errors++;
          appendDifferenceDetail_(rowResult.details, 'ファイル列挙失敗: ' + listError.message);
          sourcePage = { files: [], nextPageToken: null };
        }
        for (var sourceIndex = sourceOffset; sourceIndex < sourcePage.files.length; sourceIndex++) {
          if (deadlineReached()) {
            var pausedCheckpoint = createDifferenceScanCheckpoint_({ targetIndex: index, resumeTargetIndex: index,
              resumeSourcePageToken: sourceToken, resumeSourceOffset: sourceIndex, resumeRowResult: rowResult }, stats);
            return pause(pausedCheckpoint);
          }
          var file = sourcePage.files[sourceIndex];
          var name = String(file.name || '');
          var mime = String(file.mimeType || '');
          var key = name.toLowerCase();
          rowResult.total++;
          if (mime.indexOf('image/') !== 0) {
            rowResult.nonImages++;
            appendDifferenceDetail_(rowResult.details, name + ': 画像以外 (' + mime + ')');
          } else {
            var isIntegratedName = !!integratedNames[key];
            var isDifferenceName = !isIntegratedName && !!(virtualDifferenceNames[key] || differenceNames[key]);
            if (isIntegratedName) {
              rowResult.integratedSkipped++;
              appendDifferenceDetail_(rowResult.details, name + ': 統合済み');
            } else if (isDifferenceName) {
              rowResult.diffExistingSkipped++;
              appendDifferenceDetail_(rowResult.details, name + ': 差分コピー済み');
            } else if (isDryRun) {
              virtualDifferenceNames[key] = true;
              rowResult.copied++;
            } else {
              try {
                DriveApp.getFileById(file.id).makeCopy(name, context.differenceFolder);
                virtualDifferenceNames[key] = true;
                differenceNames[key] = true;
                rowResult.copied++;
              } catch (copyError) {
                rowResult.errors++;
                appendDifferenceDetail_(rowResult.details, name + ': コピー失敗 - ' + copyError.message);
              }
            }
          }
        }
        sourceToken = sourcePage.nextPageToken;
        sourceOffset = 0;
      } while (sourceToken);
      addDifferenceRowResultToStats_(stats, rowResult);
      checkpoint.resumeSourcePageToken = null;
      checkpoint.resumeSourceOffset = 0;
      checkpoint.resumeRowResult = null;
      checkpoint.targetIndex = index + 1;
      checkpoint.resumeTargetIndex = index + 1;
      var rowStatus = rowResult.errors ? (rowResult.copied ? '⚠️ 一部失敗' : '❌ エラー') : (rowResult.copied ? '✅ 完了' : '⏭️ 対象なし');
      addDashboardRow_(rowNumber, mgmtCode, folderLink, rowResult.copied + '/' + rowResult.total, rowStatus, buildDifferenceRowNotes_(rowResult));
    }
  } catch (processingError) {
    checkpoint.targetIndex = Number(checkpoint.resumeTargetIndex) || Number(checkpoint.targetIndex) || 0;
    checkpoint.stats = restoreDifferenceStats_({ stats: stats });
    if (isDryRun) clearDifferenceState_();
    else persistDifferenceRecoveryState_(props, config, checkpoint);
    processingError.differenceCheckpoint = checkpoint;
    processingError.differenceDetail = buildDifferenceFailureDetail_(processingError, checkpoint, targetRows.length);
    throw processingError;
  }

  var terminal = createDifferenceScanCheckpoint_({ targetIndex: targetRows.length, resumeTargetIndex: targetRows.length }, stats);
  if (!isDryRun) persistDifferenceRecoveryState_(props, config, terminal);
  updateDashboardSummary_(differenceDashboardStats_(stats));
  updateDashboardStatus_('✅ 差分抽出完了');
  var skipped = stats.integratedSkipped + stats.diffExistingSkipped + stats.otherSkipped;
  var summary = (isDryRun ? '差分抽出ドライラン' : '画像差分抽出') + '完了\n\n' +
    (isDryRun ? '差分コピー予定: ' : '差分コピー: ') + stats.copied + '枚\n' +
    '統合済み: ' + stats.integratedSkipped + '枚\n差分コピー済み: ' + stats.diffExistingSkipped + '枚\n' +
    'その他スキップ: ' + stats.otherSkipped + '件\nエラー: ' + stats.errorCount + '件';
  var entry = { operation: '画像差分抽出', mode: isDryRun ? 'ドライラン' : '本実行', status: '完了',
    success: stats.copied, skipped: skipped, errors: stats.errorCount, detail: summary };
  if (isDryRun) recordOperationResult_(entry);
  else completeOperation_(entry, '🆕 佐渡市 画像差分抽出完了', summary, true);
  if (!isDryRun) clearDifferenceState_();
  if (!suppressUi) notifyMessage_(SpreadsheetApp.getUi(), context.ss, '完了', summary);
  return { paused: false, stats: stats, summary: summary };
}

function clearDifferenceState_() {
  var props = PropertiesService.getScriptProperties();
  props.deleteProperty(PROP_KEYS.DIFF_PROGRESS);
  props.deleteProperty(PROP_KEYS.DIFF_CONFIG);
  props.deleteProperty(PROP_KEYS.DIFF_QUEUE_CONFIG);
  deleteTriggersByFunction_('runQueuedDifferenceCollect');
  deleteTriggersByFunction_('resumeDifferenceCollect');
}

function runDifferenceCollect_(config, suppressUi) {
  var startedAt = Date.now();
  config = config || {};
  var isDryRun = !!config.isDryRun;
  var props = PropertiesService.getScriptProperties();
  var saved = !isDryRun ? props.getProperty(PROP_KEYS.DIFF_PROGRESS) : null;
  var checkpoint = null;
  if (saved) {
    try {
      checkpoint = JSON.parse(saved);
      if (!isValidDifferenceCheckpoint_(checkpoint)) throw new Error('進捗形式が不正です。');
    } catch (progressError) {
      clearDifferenceState_();
      progressError.differenceDetail = buildDifferenceFailureDetail_(progressError, null, 0);
      progressError.differenceRecoverable = false;
      throw progressError;
    }
  }
  var context;
  var usePagedDrive = typeof Drive !== 'undefined' && Drive.Files && typeof Drive.Files.list === 'function';
  try {
    context = loadDifferenceCollectContext_(usePagedDrive);
  } catch (preflightError) {
    if (checkpoint && !isDryRun) {
      persistDifferenceRecoveryState_(props, config, checkpoint);
      preflightError.differenceDetail = buildDifferenceFailureDetail_(preflightError, checkpoint, checkpoint.targetIndex);
      preflightError.differenceRecoverable = true;
      preflightError.differenceCheckpoint = checkpoint;
    } else {
      clearDifferenceState_();
      preflightError.differenceDetail = buildDifferenceFailureDetail_(preflightError, null, 0);
      preflightError.differenceRecoverable = false;
      preflightError.differenceCheckpoint = null;
    }
    throw preflightError;
  }
  if (usePagedDrive) {
    return runDifferenceCollectPaged_(config, suppressUi, props, checkpoint, context, startedAt);
  }
  var startIndex = checkpoint ? Number(checkpoint.targetIndex) || 0 : 0;
  var targetRows = [];
  for (var i = 1; i < context.data.length; i++) targetRows.push(i);
  var stats = restoreDifferenceStats_(checkpoint);
  try {
    if (!checkpoint) initDashboard_(targetRows.length, isDryRun);
    updateDashboardStatus_(isDryRun ? '📋 差分抽出ドライラン実行中' : '🆕 差分抽出処理中');
  } catch (dashboardStartError) {
    var initialCheckpoint = buildDifferenceCheckpoint_(startIndex, stats);
    if (isDryRun) clearDifferenceState_();
    else persistDifferenceRecoveryState_(props, config, initialCheckpoint);
    dashboardStartError.differenceCheckpoint = initialCheckpoint;
    dashboardStartError.differenceDetail = buildDifferenceFailureDetail_(dashboardStartError, initialCheckpoint, targetRows.length);
    throw dashboardStartError;
  }
  var seen = {};
  for (var p = 0; p < startIndex; p++) {
    var previous = context.data[targetRows[p]];
    var link = previous ? String(previous[context.columns[MASTER_COLUMNS.FOLDER_LINK]] || '').trim() : '';
    if (link) try { seen[extractFolderIdFromUrl_(link)] = true; } catch (ignored) {}
  }
  var failureCheckpoint = buildDifferenceCheckpoint_(startIndex, stats);
  var processed;
  try {
    processed = processDifferenceCollectRows_({ data: context.data, targetRows: targetRows, startIndex: startIndex,
      mgmtCodeIdx: context.columns[MASTER_COLUMNS.MGMT_CODE], folderLinkIdx: context.columns[MASTER_COLUMNS.FOLDER_LINK],
      integratedFiles: context.integratedFiles, differenceFiles: context.differenceFiles,
      differenceFolder: context.differenceFolder, isDryRun: isDryRun, stats: stats, seenSourceFolderIds: seen,
      onRowStart: function(index) { failureCheckpoint = buildDifferenceCheckpoint_(index, stats); },
      onRowCommitted: function(nextIndex) { failureCheckpoint = buildDifferenceCheckpoint_(nextIndex, stats); },
      shouldStop: function() { return !isDryRun && Date.now() - startedAt >= EXEC_CONFIG.TIME_LIMIT_MS; } });
  } catch (processingError) {
    if (!isDryRun) {
      persistDifferenceRecoveryState_(props, config, failureCheckpoint);
      processingError.differenceRecoverable = true;
    }
    processingError.differenceCheckpoint = failureCheckpoint;
    processingError.differenceDetail = buildDifferenceFailureDetail_(processingError, failureCheckpoint, targetRows.length);
    throw processingError;
  }
  if (!processed.completed) {
    persistDifferenceRecoveryState_(props, config, buildDifferenceCheckpoint_(processed.nextIndex, stats));
    updateDashboardSummary_(differenceDashboardStats_(stats));
    updateDashboardStatus_('⏸️ 差分抽出中断(再開待ち)');
    return { paused: true, stats: stats };
  }
  if (!isDryRun) persistDifferenceRecoveryState_(props, config, buildDifferenceCheckpoint_(targetRows.length, stats));
  updateDashboardSummary_(differenceDashboardStats_(stats));
  updateDashboardStatus_('✅ 差分抽出完了');
  var skipped = stats.integratedSkipped + stats.diffExistingSkipped + stats.otherSkipped;
  var summary = (isDryRun ? '差分抽出ドライラン' : '画像差分抽出') + '完了\n\n' +
    (isDryRun ? '差分コピー予定: ' : '差分コピー: ') + stats.copied + '枚\n' +
    '統合済み: ' + stats.integratedSkipped + '枚\n差分コピー済み: ' + stats.diffExistingSkipped + '枚\n' +
    'その他スキップ: ' + stats.otherSkipped + '件\nエラー: ' + stats.errorCount + '件';
  var entry = { operation: '画像差分抽出', mode: isDryRun ? 'ドライラン' : '本実行', status: '完了',
    success: stats.copied, skipped: skipped, errors: stats.errorCount, detail: summary };
  if (isDryRun) recordOperationResult_(entry);
  else completeOperation_(entry, '🆕 佐渡市 画像差分抽出完了', summary, true);
  if (!isDryRun) clearDifferenceState_();
  if (!suppressUi) notifyMessage_(SpreadsheetApp.getUi(), context.ss, '完了', summary);
  return { paused: false, stats: stats, summary: summary };
}

function startDifferenceDryRun(dialogConfig) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(3000)) throw new Error('他の画像処理が実行中です。');
  var result;
  try {
    var props = PropertiesService.getScriptProperties();
    if (hasPendingDifferenceWork_(props, ScriptApp.getProjectTriggers())) throw new Error('差分抽出が予約、実行、または再開待ちです。');
    var config = dialogConfig ? JSON.parse(dialogConfig) : {};
    config.isDryRun = true;
    result = runDifferenceCollect_(config, true);
  } finally { lock.releaseLock(); }
  if (result && result.summary) {
    notifyMessage_(SpreadsheetApp.getUi(), SpreadsheetApp.getActiveSpreadsheet(), '完了', result.summary);
  }
  return result;
}

function startDifferenceCollect(dialogConfig) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(3000)) throw new Error('他の画像処理が実行中です。');
  var ss;
  try {
    var props = PropertiesService.getScriptProperties();
    if (hasPendingDifferenceWork_(props, ScriptApp.getProjectTriggers())) throw new Error('差分抽出が予約、実行、または再開待ちです。');
    props.setProperty(PROP_KEYS.DIFF_QUEUE_CONFIG, dialogConfig || '{}');
    try {
      scheduleSingleDifferenceTrigger_('runQueuedDifferenceCollect', 1000);
    } catch (scheduleError) {
      clearDifferenceState_();
      throw scheduleError;
    }
    ss = SpreadsheetApp.getActiveSpreadsheet();
  } finally { lock.releaseLock(); }
  if (ss) ss.toast('画像差分抽出を予約しました。進捗はdashboardシートで確認できます。', '🆕 画像差分抽出', 10);
}

function runQueuedDifferenceCollect() {
  deleteTriggersByFunction_('runQueuedDifferenceCollect');
  var props = PropertiesService.getScriptProperties();
  var configString = props.getProperty(PROP_KEYS.DIFF_QUEUE_CONFIG);
  if (!configString) return;
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(3000)) {
    try {
      scheduleSingleDifferenceTrigger_('runQueuedDifferenceCollect', EXEC_CONFIG.RESUME_DELAY_MS);
    } catch (scheduleError) {
      clearDifferenceState_();
      throw scheduleError;
    }
    return;
  }
  try {
    var parsedConfig;
    try {
      parsedConfig = JSON.parse(configString);
    } catch (parseError) {
      clearDifferenceState_();
      parseError.differenceDetail = buildDifferenceFailureDetail_(parseError, null, 0);
      throw parseError;
    }
    props.deleteProperty(PROP_KEYS.DIFF_QUEUE_CONFIG);
    props.setProperty(PROP_KEYS.DIFF_CONFIG, configString);
    runDifferenceCollect_(parsedConfig, true);
  } catch (e) {
    var detail = e.differenceDetail || e.message;
    var entry = buildDifferenceAbnormalEntry_('本実行', e);
    updateDashboardStatus_('❌ 差分抽出異常終了');
    completeOperation_(entry,
      '❌ 佐渡市 画像差分抽出 異常終了', detail, true);
    throw e;
  } finally { lock.releaseLock(); }
}

function resumeDifferenceCollect() {
  deleteTriggersByFunction_('resumeDifferenceCollect');
  var props = PropertiesService.getScriptProperties();
  var progress = props.getProperty(PROP_KEYS.DIFF_PROGRESS);
  if (!progress) return;
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(3000)) {
    try {
      scheduleSingleDifferenceTrigger_('resumeDifferenceCollect', EXEC_CONFIG.RESUME_DELAY_MS);
    } catch (scheduleError) {
      clearDifferenceState_();
      throw scheduleError;
    }
    return;
  }
  try {
    var config;
    try {
      config = JSON.parse(props.getProperty(PROP_KEYS.DIFF_CONFIG) || '{}');
    } catch (ignoredConfigError) {
      config = {};
      props.setProperty(PROP_KEYS.DIFF_CONFIG, '{}');
    }
    runDifferenceCollect_(config, true);
  } catch (e) {
    var detail = e.differenceDetail || e.message;
    var entry = buildDifferenceAbnormalEntry_('自動再開', e);
    updateDashboardStatus_('❌ 差分抽出異常終了');
    completeOperation_(entry, '❌ 佐渡市 画像差分抽出 異常終了', detail, true);
    throw e;
  } finally { lock.releaseLock(); }
}

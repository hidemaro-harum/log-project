/**
 * ==============================================================================
 * FTP登録失敗画像コピー (FtpFailedImageCopy.js)
 * R-CabinetのFTP登録で失敗したファイル名だけをDrive内で抽出コピーする
 * ==============================================================================
 */

function getFtpFailedImageHeaders_() {
  return ['ファイル名', 'ステータス', 'コピー先URL', '備考'];
}

function normalizeFtpFailedFileKey_(fileName) {
  return String(fileName || '').trim().toLowerCase();
}

function buildFtpFailedSourceMap_(sourceInfos) {
  var map = {};
  for (var i = 0; i < sourceInfos.length; i++) {
    var info = sourceInfos[i] || {};
    var key = normalizeFtpFailedFileKey_(info.name);
    if (key && !map[key]) map[key] = info;
  }
  return map;
}

function buildFtpFailedImageCopyPlan_(requestedNames, sourceInfos, destinationNameSet) {
  var sourceMap = buildFtpFailedSourceMap_(sourceInfos || []);
  var destinationSet = destinationNameSet || {};
  var seenRequests = {};
  var rows = [];
  var copyTasks = [];

  for (var i = 0; i < requestedNames.length; i++) {
    var requestedName = String(requestedNames[i] || '').trim();
    var key = normalizeFtpFailedFileKey_(requestedName);
    var row = { fileName: requestedName, status: '', destinationUrl: '', note: '' };

    if (!key) {
      row.status = 'スキップ';
      row.note = 'ファイル名が空です';
      rows.push(row);
      continue;
    }
    if (seenRequests[key]) {
      row.status = '重複指定';
      row.note = '同じファイル名が上の行で指定されています';
      rows.push(row);
      continue;
    }
    seenRequests[key] = true;

    var sourceInfo = sourceMap[key];
    if (!sourceInfo) {
      row.status = '未検出';
      row.note = 'コピー元フォルダに同名ファイルがありません';
      rows.push(row);
      continue;
    }

    var mimeType = String(sourceInfo.mimeType || '');
    if (!mimeType || mimeType.indexOf('image/') !== 0) {
      row.status = '画像以外';
      row.note = 'MIMEタイプ: ' + (mimeType || '(不明)');
      rows.push(row);
      continue;
    }

    if (destinationSet[key]) {
      row.status = 'コピー先に存在';
      row.note = '同名ファイルがコピー先にあります';
      rows.push(row);
      continue;
    }

    row.status = 'コピー対象';
    row.note = 'コピーできます';
    copyTasks.push({
      rowIndex: rows.length,
      requestedName: requestedName,
      sourceName: sourceInfo.name,
      file: sourceInfo.file || null,
    });
    rows.push(row);
  }

  return { rows: rows, copyTasks: copyTasks };
}

function ensureFtpFailedImageSheet_(ss) {
  var sheet = ss.getSheetByName(SHEET_NAMES.RAKUTEN_FAILED_FILES);
  if (!sheet) sheet = ss.insertSheet(SHEET_NAMES.RAKUTEN_FAILED_FILES);
  initializeSheetHeadersIfBlank_(sheet, getFtpFailedImageHeaders_());
  return sheet;
}

function collectFtpFailedFolderFiles_(folder) {
  var files = folder.getFiles();
  var result = [];
  while (files.hasNext()) {
    var file = files.next();
    result.push({
      name: file.getName(),
      mimeType: file.getMimeType(),
      file: file,
    });
  }
  return result;
}

function buildFtpFailedDestinationNameSet_(folder) {
  var set = {};
  var files = folder.getFiles();
  while (files.hasNext()) {
    var file = files.next();
    var key = normalizeFtpFailedFileKey_(file.getName());
    if (key) set[key] = true;
  }
  return set;
}

function writeFtpFailedImageResults_(sheet, planRows) {
  if (!planRows.length) return;
  var values = planRows.map(function(row) {
    return [row.status, row.destinationUrl, row.note];
  });
  sheet.getRange(2, 2, values.length, 3).setValues(values);
}

function copyFtpFailedImages() {
  var ui = SpreadsheetApp.getUi();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ensureFtpFailedImageSheet_(ss);

  if (sheet.getLastRow() < 2) {
    ui.alert('対象なし', SHEET_NAMES.RAKUTEN_FAILED_FILES + 'シートのA列に失敗ファイル名を貼り付けてください。', ui.ButtonSet.OK);
    return;
  }

  var sourcePrompt = ui.prompt('FTP失敗画像コピー', 'コピー元のGoogle DriveフォルダURLを入力してください。', ui.ButtonSet.OK_CANCEL);
  if (sourcePrompt.getSelectedButton() !== ui.Button.OK) return;
  var destinationPrompt = ui.prompt('FTP失敗画像コピー', 'コピー先のGoogle DriveフォルダURLを入力してください。', ui.ButtonSet.OK_CANCEL);
  if (destinationPrompt.getSelectedButton() !== ui.Button.OK) return;

  try {
    var sourceId = extractFolderIdFromUrl_(sourcePrompt.getResponseText());
    var destinationId = extractFolderIdFromUrl_(destinationPrompt.getResponseText());
    if (sourceId === destinationId) throw new Error('コピー元とコピー先に同じフォルダは指定できません。');

    var fileNameValues = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();
    var requestedNames = fileNameValues.map(function(row) { return row[0]; });
    var confirm = ui.alert(
      'FTP失敗画像コピー',
      requestedNames.length + '行の失敗ファイル名を確認し、コピー元フォルダ直下から一致画像だけをコピーします。\n\n実行しますか？',
      ui.ButtonSet.OK_CANCEL
    );
    if (confirm !== ui.Button.OK) return;

    var sourceFolder = DriveApp.getFolderById(sourceId);
    var destinationFolder = DriveApp.getFolderById(destinationId);
    var plan = buildFtpFailedImageCopyPlan_(
      requestedNames,
      collectFtpFailedFolderFiles_(sourceFolder),
      buildFtpFailedDestinationNameSet_(destinationFolder)
    );

    var copied = 0;
    var errors = 0;
    for (var i = 0; i < plan.copyTasks.length; i++) {
      var task = plan.copyTasks[i];
      try {
        var copiedFile = task.file.makeCopy(task.sourceName, destinationFolder);
        plan.rows[task.rowIndex].status = 'コピー済み';
        plan.rows[task.rowIndex].destinationUrl = copiedFile.getUrl();
        plan.rows[task.rowIndex].note = 'コピー完了';
        copied++;
      } catch (e) {
        plan.rows[task.rowIndex].status = 'コピー失敗';
        plan.rows[task.rowIndex].note = e.message;
        errors++;
      }
    }

    writeFtpFailedImageResults_(sheet, plan.rows);
    var skipped = plan.rows.length - copied - errors;
    completeOperation_({ operation: 'FTP失敗画像コピー', mode: 'Driveコピー', status: errors ? '完了（エラーあり）' : '完了',
      success: copied, skipped: skipped, errors: errors },
      (errors ? '⚠️' : '✅') + ' 佐渡市 FTP失敗画像コピー完了',
      'コピー: ' + copied + '件\nスキップ: ' + skipped + '件\nエラー: ' + errors + '件',
      true);
    ui.alert('完了', 'コピー: ' + copied + '件\nスキップ: ' + skipped + '件\nエラー: ' + errors + '件', ui.ButtonSet.OK);
  } catch (e) {
    completeOperation_({ operation: 'FTP失敗画像コピー', mode: 'Driveコピー', status: '異常終了', errors: 1, detail: e.message },
      '❌ 佐渡市 FTP失敗画像コピー異常終了', e.message, true);
    ui.alert('エラー', e.message, ui.ButtonSet.OK);
  }
}

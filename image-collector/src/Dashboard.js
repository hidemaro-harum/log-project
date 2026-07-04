/**
 * ==============================================================================
 * ダッシュボード管理 (Dashboard.js)
 * 処理進捗の可視化と管理 — 共通ビルダーパターン
 * ==============================================================================
 */

// =========================================================================
//  共通ダッシュボードビルダー
// =========================================================================

/**
 * バッチ処理系ダッシュボードを初期化する汎用ビルダー
 * @param {Object} config - ダッシュボード設定
 * @param {string} config.sheetName - ダッシュボードシート名
 * @param {string} config.title - ダッシュボードタイトル
 * @param {string} config.bgColor - サマリーエリアの背景色
 * @param {string} [config.headerColor] - ヘッダーの背景色
 * @param {Array<{label: string, value: *}>} config.summaryRows - サマリー行の定義
 * @param {string[]} config.detailHeaders - 詳細テーブルのヘッダー
 * @param {number[]} config.columnWidths - 各列の幅
 * @param {boolean} [config.hasCheckbox] - 詳細行にチェックボックスを付けるか
 */
function initDashboardGeneric_(config) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(config.sheetName);

  if (sheet) {
    sheet.clear();
  } else {
    sheet = ss.insertSheet(config.sheetName);
  }

  // タイトル
  sheet.getRange('A1').setValue(config.title).setFontSize(14).setFontWeight('bold');

  // 開始時刻 + ステータス（共通固定行）
  sheet.getRange('A2').setValue('開始時刻:');
  sheet.getRange('B2').setValue(Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm:ss'));
  sheet.getRange('A3').setValue('ステータス:');
  sheet.getRange('B3').setValue('準備中');

  // サマリー行を動的生成
  var summaryStartRow = 4;
  for (var i = 0; i < config.summaryRows.length; i++) {
    var row = config.summaryRows[i];
    sheet.getRange(summaryStartRow + i, 1).setValue(row.label);
    sheet.getRange(summaryStartRow + i, 2).setValue(row.value);
  }

  var summaryEndRow = summaryStartRow + config.summaryRows.length - 1;

  // 書式
  var mergeWidth = Math.max(config.detailHeaders.length, 2);
  sheet.getRange(1, 1, 1, mergeWidth).merge();
  sheet.getRange(2, 1, summaryEndRow - 1, 1).setFontWeight('bold');
  sheet.getRange(1, 1, summaryEndRow, 2).setBackground(config.bgColor || '#F3F4F6');

  // 詳細ヘッダー
  var detailRow = summaryEndRow + 2;
  sheet.getRange(detailRow, 1, 1, config.detailHeaders.length).setValues([config.detailHeaders]);
  sheet.getRange(detailRow, 1, 1, config.detailHeaders.length)
    .setBackground(config.headerColor || '#424242')
    .setFontColor('#FFFFFF')
    .setFontWeight('bold');

  // 列幅
  if (config.columnWidths) {
    for (var w = 0; w < config.columnWidths.length; w++) {
      sheet.setColumnWidth(w + 1, config.columnWidths[w]);
    }
  }

  sheet.setFrozenRows(detailRow);
}

/**
 * ダッシュボードのステータスセル(B3)を更新する汎用関数
 * @param {string} sheetName - ダッシュボードシート名
 * @param {string} status - ステータス文字列
 */
function updateDashboardStatusGeneric_(sheetName, status) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) return;
  sheet.getRange('B3').setValue(status);
}

/**
 * ダッシュボードに結果行を追加する汎用関数
 * @param {string} sheetName - ダッシュボードシート名
 * @param {Array<*>} rowData - 書き込む行データ配列
 * @param {number} statusColIndex - ステータス列の1始まりインデックス
 * @param {boolean} [hasCheckbox] - 1列目にチェックボックスを付けるか
 */
function addDashboardRowGeneric_(sheetName, rowData, statusColIndex, hasCheckbox) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) return;

  var lastRow = sheet.getLastRow() + 1;
  sheet.getRange(lastRow, 1, 1, rowData.length).setValues([rowData]);

  if (hasCheckbox) {
    sheet.getRange(lastRow, 1).insertCheckboxes();
  }

  // ステータスに応じた色分け
  var statusValue = String(rowData[statusColIndex - 1] || '');
  if (statusValue.indexOf('❌') !== -1) {
    sheet.getRange(lastRow, statusColIndex).setBackground('#FFCDD2');
  } else if (statusValue.indexOf('⚠️') !== -1) {
    sheet.getRange(lastRow, statusColIndex).setBackground('#FFF9C4');
  } else if (statusValue.indexOf('✅') !== -1) {
    sheet.getRange(lastRow, statusColIndex).setBackground('#C8E6C9');
  }
}

/**
 * ダッシュボードの統計セルを一括更新する汎用関数
 * @param {string} sheetName - ダッシュボードシート名
 * @param {Array<{cell: string, value: *}>} updates - セル参照と値のペア配列
 */
function updateDashboardStatsGeneric_(sheetName, updates) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) return;
  for (var i = 0; i < updates.length; i++) {
    sheet.getRange(updates[i].cell).setValue(updates[i].value);
  }
}


// =========================================================================
//  画像集約ダッシュボード（Collector用）
// =========================================================================

/**
 * ダッシュボードを初期化する
 * @param {number} totalRows - 全処理行数
 * @param {boolean} [isDryRun] - ドライランかどうか
 */
function initDashboard_(totalRows, isDryRun) {
  initDashboardGeneric_({
    sheetName: SHEET_NAMES.DASHBOARD,
    title: '📊 画像集約ダッシュボード',
    bgColor: '#F3F4F6',
    summaryRows: [
      { label: '全対象行数:', value: totalRows },
      { label: '処理済み:', value: 0 },
      { label: isDryRun ? '✅ コピー予定:' : '✅ 成功:', value: 0 },
      { label: '⏭️ スキップ:', value: 0 },
      { label: '❌ エラー:', value: 0 },
      { label: '📋 重複スキップ:', value: 0 },
    ],
    detailHeaders: ['#', '管理番号', 'フォルダURL', 'コピー枚数', 'ステータス', '備考'],
    columnWidths: [50, 200, 500, 100, 120, 500],
  });
}

/**
 * ダッシュボードのステータスを更新する
 * @param {string} status - ステータス文字列
 */
function updateDashboardStatus_(status) {
  updateDashboardStatusGeneric_(SHEET_NAMES.DASHBOARD, status);
}

/**
 * ダッシュボードのサマリーを更新する
 * @param {Object} stats - 統計情報
 */
function updateDashboardSummary_(stats) {
  updateDashboardStatsGeneric_(SHEET_NAMES.DASHBOARD, [
    { cell: 'B5', value: stats.processedRows },
    { cell: 'B6', value: stats.successCount },
    { cell: 'B7', value: stats.skipCount },
    { cell: 'B8', value: stats.errorCount },
    { cell: 'B9', value: stats.duplicateCount },
  ]);
}

/**
 * ダッシュボードに処理結果の行を追加する
 * @param {number} rowNum - 元データの行番号
 * @param {string} mgmtCode - 管理番号
 * @param {string} folderUrl - コピー元フォルダURL
 * @param {string} copyCount - コピー枚数（例: "3/5"）
 * @param {string} status - ステータス絵文字
 * @param {string} notes - 備考
 */
function addDashboardRow_(rowNum, mgmtCode, folderUrl, copyCount, status, notes) {
  addDashboardRowGeneric_(
    SHEET_NAMES.DASHBOARD,
    [rowNum, mgmtCode, folderUrl, copyCount, status, notes],
    5  // ステータスは5列目
  );
}


// =========================================================================
//  Choice配置ダッシュボード
// =========================================================================

/**
 * Choice配置用ダッシュボードを初期化する
 * @param {number} totalTsvRows - TSV全行数
 * @param {number} matchedCount - マッチ品数
 * @param {number} unmatchedCount - 未マッチ品数
 * @param {number} batchCount - バッチ数
 * @param {number} totalFiles - 合計ファイル数
 */
function initChoiceDashboard_(totalTsvRows, matchedCount, unmatchedCount, batchCount, totalFiles) {
  initDashboardGeneric_({
    sheetName: SHEET_NAMES.CHOICE_DASHBOARD,
    title: '📦 Choice画像配置ダッシュボード',
    bgColor: '#F3F4F6',
    headerColor: '#424242',
    summaryRows: [
      { label: 'TSV行数:', value: totalTsvRows },
      { label: '✅ マッチ品:', value: matchedCount },
      { label: '❌ 未マッチ品:', value: unmatchedCount },
      { label: '📦 バッチ数:', value: batchCount },
      { label: '📷 合計画像数:', value: totalFiles },
      { label: '✅ コピー成功:', value: 0 },
      { label: '⏭️ スキップ:', value: 0 },
      { label: '❌ エラー:', value: 0 },
    ],
    detailHeaders: ['作業完了', 'バッチ#', '品数', '画像数', 'サイズ', 'ステータス', '備考'],
    columnWidths: [80, 80, 80, 80, 120, 150, 500]
  });
}

/**
 * Choice配置ダッシュボードのステータスを更新する
 * @param {string} status - ステータス文字列
 */
function updateChoiceDashboardStatus_(status) {
  updateDashboardStatusGeneric_(SHEET_NAMES.CHOICE_DASHBOARD, status);
}

/**
 * Choice配置ダッシュボードの統計を更新する
 * @param {Object} stats - 統計情報
 */
function _updateChoiceStats(stats) {
  updateDashboardStatsGeneric_(SHEET_NAMES.CHOICE_DASHBOARD, [
    { cell: 'B9', value: stats.copiedFiles },
    { cell: 'B10', value: stats.skippedFiles },
    { cell: 'B11', value: stats.errorFiles }
  ]);
}

/**
 * Choice配置ダッシュボードにバッチ結果行を追加する
 * @param {number} batchNum - バッチ番号
 * @param {number} itemCount - 品数
 * @param {number} fileCount - 画像数
 * @param {string} size - サイズ文字列
 * @param {string} status - ステータス
 * @param {string} notes - 備考
 */
function addChoiceDashboardRow_(batchNum, itemCount, fileCount, size, status, notes) {
  addDashboardRowGeneric_(
    SHEET_NAMES.CHOICE_DASHBOARD,
    ['', batchNum, itemCount, fileCount, size, status, notes],
    6, // ステータスは6列目
    true // 1列目にチェックボックスを挿入
  );
}


// =========================================================================
//  ANA配置ダッシュボード
// =========================================================================

/**
 * ANA配置用ダッシュボードを初期化する
 * @param {number} totalCsvRows - CSV全行数
 * @param {number} matchedCount - マッチ品数
 * @param {number} unmatchedCount - 未マッチ品数
 * @param {number} batchCount - バッチ数
 * @param {number} totalFiles - 合計ファイル数
 */
function initAnaDashboard_(totalCsvRows, matchedCount, unmatchedCount, batchCount, totalFiles) {
  initDashboardGeneric_({
    sheetName: SHEET_NAMES.ANA_DASHBOARD,
    title: '📦 ANA画像配置ダッシュボード',
    bgColor: '#ECEFF1',
    headerColor: '#37474F',
    summaryRows: [
      { label: 'CSV行数:', value: totalCsvRows },
      { label: '✅ マッチ品:', value: matchedCount },
      { label: '❌ 未マッチ品:', value: unmatchedCount },
      { label: '📦 バッチ数:', value: batchCount },
      { label: '📷 コピー予定総数:', value: totalFiles },
      { label: '✅ コピー成功:', value: 0 },
      { label: '⏭️ スキップ:', value: 0 },
      { label: '❌ エラー:', value: 0 },
    ],
    detailHeaders: ['作業完了', 'バッチ#', '品数', '画像数', 'サイズ', 'ステータス', '備考'],
    columnWidths: [80, 80, 80, 80, 120, 150, 500]
  });
}

/**
 * ANA配置ダッシュボードのステータスを更新する
 * @param {string} status - ステータス文字列
 */
function updateAnaDashboardStatus_(status) {
  updateDashboardStatusGeneric_(SHEET_NAMES.ANA_DASHBOARD, status);
}

/**
 * ANA配置ダッシュボードの統計を更新する
 * @param {Object} stats - 統計情報
 */
function _updateAnaStats(stats) {
  updateDashboardStatsGeneric_(SHEET_NAMES.ANA_DASHBOARD, [
    { cell: 'B9', value: stats.copiedFiles },
    { cell: 'B10', value: stats.skippedFiles },
    { cell: 'B11', value: stats.errorFiles }
  ]);
}

/**
 * ANA配置ダッシュボードにバッチ結果行を追加する
 * @param {number} batchNum - バッチ番号
 * @param {number} itemCount - 品数
 * @param {number} fileCount - 画像数
 * @param {string} size - サイズ文字列
 * @param {string} status - ステータス
 * @param {string} notes - 備考
 */
function addAnaDashboardRow_(batchNum, itemCount, fileCount, size, status, notes) {
  addDashboardRowGeneric_(
    SHEET_NAMES.ANA_DASHBOARD,
    ['', batchNum, itemCount, fileCount, size, status, notes],
    6, // ステータスは6列目
    true // 1列目にチェックボックスを挿入
  );
}

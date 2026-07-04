/** 共通の実行履歴、通知、出力検証、HTTP再試行。 */

var OPERATION_HISTORY_HEADERS_ = ['実行日時', '実行者', '処理名', 'モード', '結果', '成功', 'スキップ', 'エラー', '詳細'];

function ensureOperationHistorySheet_(ss) {
  var sheet = ss.getSheetByName(SHEET_NAMES.EXECUTION_HISTORY);
  if (!sheet) sheet = ss.insertSheet(SHEET_NAMES.EXECUTION_HISTORY);
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, OPERATION_HISTORY_HEADERS_.length).setValues([OPERATION_HISTORY_HEADERS_]);
    sheet.getRange(1, 1, 1, OPERATION_HISTORY_HEADERS_.length)
      .setBackground('#424242').setFontColor('#FFFFFF').setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function recordOperationResult_(entry) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ensureOperationHistorySheet_(ss);
    var email = '';
    try { email = Session.getActiveUser().getEmail() || ''; } catch (ignored) {}
    var timestamp = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm:ss');
    sheet.getRange(sheet.getLastRow() + 1, 1, 1, OPERATION_HISTORY_HEADERS_.length).setValues([[
      timestamp,
      email,
      entry.operation || '',
      entry.mode || '',
      entry.status || '',
      Number(entry.success) || 0,
      Number(entry.skipped) || 0,
      Number(entry.errors) || 0,
      entry.detail || '',
    ]]);
  } catch (e) {
    if (typeof Logger !== 'undefined') Logger.log('実行履歴の記録失敗: ' + e.message);
  }
}

function completeOperation_(entry, subject, body, shouldEmail) {
  recordOperationResult_(entry);
  if (shouldEmail !== false && subject && body) sendNotificationEmail_(subject, body);
}

function findRequiredHeaderIssues_(headers, requiredHeaders) {
  var counts = {};
  for (var i = 0; i < headers.length; i++) {
    var name = String(headers[i]).trim();
    counts[name] = (counts[name] || 0) + 1;
  }
  var issues = [];
  var missing = requiredHeaders.filter(function(name) { return !counts[name]; });
  var duplicate = requiredHeaders.filter(function(name) { return counts[name] > 1; });
  if (missing.length) issues.push('必須ヘッダー不足: ' + missing.join(', '));
  if (duplicate.length) issues.push('必須ヘッダー重複: ' + duplicate.join(', '));
  return issues;
}

function validateAnaExportRows_(data, requiredHeaders, targetIndices) {
  if (!data || !data.length) return ['データがありません'];
  var issues = findRequiredHeaderIssues_(data[0], requiredHeaders);
  if (issues.length) return issues;
  var map = {};
  data[0].forEach(function(header, index) { map[String(header).trim()] = index; });
  var indices = targetIndices || data.slice(1).map(function(_, index) { return index + 1; });
  indices.forEach(function(index) {
    var row = data[index];
    if (!row) return;
    if (!String(row[map['返礼品識別コード']] || '').trim()) issues.push((index + 1) + '行目: 返礼品識別コードが空欄');
    if (map['出力バッチ'] !== undefined && String(row[map['出力バッチ']]).trim() === 'エラー') {
      issues.push((index + 1) + '行目: 出力バッチがエラー');
    }
  });
  return issues;
}

function validateRakutenExportRows_(data, requiredHeaders, targetIndices) {
  if (!data || !data.length) return ['データがありません'];
  var issues = findRequiredHeaderIssues_(data[0], requiredHeaders);
  if (issues.length && issues.some(function(issue) { return issue.indexOf('不足') !== -1; })) return issues;
  var map = {};
  data[0].forEach(function(header, index) { if (map[String(header).trim()] === undefined) map[String(header).trim()] = index; });
  var indices = targetIndices || data.slice(1).map(function(_, index) { return index + 1; });
  indices.forEach(function(index) {
    var row = data[index];
    if (!row) return;
    if (String(row[map['商品名']] || '').trim() && !String(row[map['商品管理番号（商品URL）']] || '').trim()) {
      issues.push((index + 1) + '行目: 商品管理番号（商品URL）が空欄');
    }
  });
  return issues;
}

function buildRakutenCsvDownloadMessage_(mode, targetRowCount, validationIssues) {
  var message = 'rakuten_csvシート' + (mode === '選択行' ? 'の選択行' : '') +
    'をShift-JIS CSVとしてダウンロードします。\n\n' +
    'ファイル名: normal-item.csv\n対象行数: ' + targetRowCount + '行';
  if (validationIssues && validationIssues.length > 0) {
    message += '\n\n出力前チェック警告（今回は停止せず出力します）:\n' +
      validationIssues.slice(0, 20).join('\n');
  }
  return message + '\n\n実行しますか？';
}

/**
 * HTTP リクエストを指数バックオフ付きでリトライする
 * @param {string} url - リクエストURL
 * @param {Object} options - UrlFetchApp.fetch() のオプション
 * @param {string=} label - エラーメッセージ用のラベル
 * @return {GoogleAppsScript.URL_Fetch.HTTPResponse}
 */
function fetchWithRetry_(url, options, label) {
  var maxAttempts = 4;
  var lastResponse;
  for (var attempt = 0; attempt < maxAttempts; attempt++) {
    lastResponse = UrlFetchApp.fetch(url, options);
    var code = lastResponse.getResponseCode();
    if (code >= 200 && code < 300) return lastResponse;
    var retryable = code === 429 || (code >= 500 && code <= 599);
    if (!retryable || attempt === maxAttempts - 1) {
      var body = String(lastResponse.getContentText() || '').slice(0, 300);
      throw new Error((label || 'API') + '失敗: HTTP ' + code + (body ? ' - ' + body : ''));
    }
    // 指数バックオフ: 2秒 → 8秒 → 32秒
    var delayMs = Math.pow(2, 2 * attempt + 1) * 1000;
    Utilities.sleep(delayMs);
  }
  return lastResponse;
}

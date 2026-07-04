/**
 * ==============================================================================
 * ユーティリティ関数 (Utils.js)
 * 佐渡市 画像集約ツール共通ヘルパー関数群
 * ==============================================================================
 */

/**
 * settingシートから値を取得する
 * @param {string} key - A列のキー名
 * @returns {string} B列の値（見つからない場合は空文字）
 */
function getSettingValue_(key) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAMES.SETTING);
  if (!sheet) return '';

  var data = sheet.getDataRange().getValues();
  for (var i = 0; i < data.length; i++) {
    if (String(data[i][0]).trim() === key) {
      return String(data[i][1]).trim();
    }
  }
  return '';
}

/**
 * Google DriveのURLからフォルダIDを抽出する
 * 以下の形式に対応:
 * - https://drive.google.com/drive/folders/FOLDER_ID
 * - https://drive.google.com/drive/folders/FOLDER_ID?usp=sharing
 * - フォルダIDそのもの
 * @param {string} url - Google DriveのフォルダURL
 * @returns {string} フォルダID
 */
function extractFolderIdFromUrl_(url) {
  var str = String(url).trim();

  // https://drive.google.com/drive/folders/FOLDER_ID 形式
  var match = str.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (match) return match[1];

  // フォルダIDがそのまま入っている場合
  if (/^[a-zA-Z0-9_-]+$/.test(str)) return str;

  throw new Error('フォルダIDを抽出できません: ' + str);
}

/**
 * ヘッダー行からカラム名→インデックスのマップを作成する
 * @param {Array} headers - ヘッダー行の値配列
 * @returns {Object} カラム名→インデックスのマップ
 */
function createColumnMap_(headers) {
  var map = {};
  for (var i = 0; i < headers.length; i++) {
    map[String(headers[i]).trim()] = i;
  }
  return map;
}

/**
 * 必須ヘッダーのうち存在しないものを指定順で返す
 * @param {Array} headers - 実際のヘッダー行
 * @param {Array<string>} required - 必須ヘッダー名
 * @returns {Array<string>} 不足ヘッダー名
 */
function findMissingHeaders_(headers, required) {
  var colMap = createColumnMap_(headers);
  return required.filter(function(header) {
    return colMap[header] === undefined;
  });
}

/**
 * 名前をtrim正規化し、重複した名前を出現順で一度ずつ返す
 * @param {Array} values - 検査する名前
 * @returns {Array<string>} 重複した名前
 */
function findDuplicateNames_(values) {
  var seen = {};
  var reported = {};
  var duplicates = [];
  for (var i = 0; i < values.length; i++) {
    var name = String(values[i]).trim();
    if (!name) continue;
    if (seen[name] && !reported[name]) {
      duplicates.push(name);
      reported[name] = true;
    }
    seen[name] = true;
  }
  return duplicates;
}

/**
 * 指定された関数名のトリガーを全削除する
 * @param {string} funcName - 関数名
 */
function deleteTriggersByFunction_(funcName) {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === funcName) {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
}

/**
 * フォルダ内の既存ファイル名セットを構築する（重複チェック用）
 * @param {Folder} folder - 対象フォルダ
 * @returns {Object} ファイル名（小文字）をキーとするオブジェクト
 */
function buildExistingFileSet_(folder) {
  var set = {};
  var iter = folder.getFiles();
  while (iter.hasNext()) {
    var f = iter.next();
    set[f.getName().toLowerCase()] = true;
  }
  return set;
}

/**
 * ファイル名を安全な文字列に変換する
 * @param {string} name - ファイル名
 * @returns {string} サニタイズされたファイル名
 */
function sanitizeFileName_(name) {
  return String(name).replace(/[\/\\:*?"<>|]/g, '_').trim();
}

/**
 * メール通知を送信する
 * @param {string} subject - 件名
 * @param {string} body - 本文
 */
function sendNotificationEmail_(subject, body) {
  var email = getSettingValue_(SETTING_KEYS.NOTIFICATION_EMAIL);
  if (!email) return;

  try {
    MailApp.sendEmail(email, subject, body);
    Logger.log('通知メール送信: ' + email);
  } catch (e) {
    Logger.log('メール送信失敗: ' + e.message);
  }
}

/**
 * UIが使える場合はalert、トリガー実行時はtoastとログで通知する
 * @param {?Object} ui - Spreadsheet UI
 * @param {Spreadsheet} ss - スプレッドシート
 * @param {string} title - 通知タイトル
 * @param {string} message - 通知本文
 */
function notifyMessage_(ui, ss, title, message) {
  if (ui) {
    ui.alert(title, message, ui.ButtonSet.OK);
    return;
  }

  Logger.log(title + ': ' + message);
  if (ss) {
    ss.toast(String(message).split('\n')[0], title, 10);
  }
}

/**
 * フォルダ内の全ファイルを名前→情報のマップで返す（画像のみスキャン）
 * @param {Folder} folder - 対象フォルダ
 * @returns {Object} ファイル名（小文字）→ { file, name, size } のマップ
 */
function buildFileMapFromFolder_(folder) {
  var map = {};
  var iter = folder.getFiles();
  while (iter.hasNext()) {
    var file = iter.next();
    var name = file.getName();
    var nameLower = name.toLowerCase();
    var mimeType = file.getMimeType();
    if (mimeType && mimeType.indexOf('image/') === 0) {
      map[nameLower] = {
        file: file,
        name: name,
        size: file.getSize(),
      };
    }
  }
  return map;
}

/**
 * 数値を指定桁数でゼロ埋めする
 * @param {number} num - 対象数値
 * @param {number} digits - 桁数
 * @returns {string} ゼロ埋めされた文字列
 */
function padNumber_(num, digits) {
  var s = String(num);
  while (s.length < digits) s = '0' + s;
  return s;
}

/**
 * バイト数を人間が読みやすい形式に変換する
 * @param {number} bytes - バイト数
 * @returns {string} 変換後の文字列（KB, MB等）
 */
function formatBytes_(bytes) {
  if (bytes === 0) return '0 B';
  var units = ['B', 'KB', 'MB', 'GB'];
  var i = Math.floor(Math.log(bytes) / Math.log(1024));
  if (i >= units.length) i = units.length - 1;
  return (bytes / Math.pow(1024, i)).toFixed(1) + ' ' + units[i];
}

/**
 * 親フォルダ内に指定名のサブフォルダがあれば取得し、なければ作成する
 * @param {Folder} parentFolder - 親フォルダ
 * @param {string} folderName - フォルダ名
 * @returns {Folder}
 */
function getOrCreateFolder_(parentFolder, folderName) {
  var folders = parentFolder.getFoldersByName(folderName);
  return folders.hasNext() ? folders.next() : parentFolder.createFolder(folderName);
}

/**
 * バッチ分割計画のサマリーテキストを生成する
 * @param {Array} batches - バッチオブジェクトの配列
 * @returns {string}
 */
function buildBatchSummaryText_(batches) {
  var lines = [];
  for (var b = 0; b < batches.length; b++) {
    lines.push(
      'バッチ ' + (b + 1) + ': ' +
      batches[b].items.length + '品 / ' +
      batches[b].totalFiles + '枚 / ' +
      formatBytes_(batches[b].totalSize)
    );
  }
  return lines.join('\n');
}

/**
 * CSVフィールドをRFC 4180形式でエスケープする
 * @param {*} field - CSVフィールド値
 * @returns {string}
 */
function escapeCsvField_(field) {
  var str = String(field === null || field === undefined ? '' : field);
  if (/[",\r\n]/.test(str)) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

/**
 * 二次元配列をCRLF区切りのCSV文字列へ変換する
 * @param {Array<Array>} data - CSVデータ
 * @returns {string}
 */
function buildCsvText_(data) {
  return data.map(function(row) {
    return row.map(escapeCsvField_).join(',');
  }).join('\r\n');
}

/**
 * 指定ヘッダーだけを指定順に並べたテーブルを返す
 * @param {Array<Array>} data - ヘッダー行を含む元データ
 * @param {Array<string>} targetHeaders - 出力するヘッダー
 * @returns {Array<Array>}
 */
function projectTableByHeaders_(data, targetHeaders) {
  if (!data || data.length === 0) return [targetHeaders.slice()];

  var sourceMap = createColumnMap_(data[0]);
  var missing = targetHeaders.filter(function(header) {
    return sourceMap[header] === undefined;
  });
  if (missing.length > 0) {
    throw new Error('必須ヘッダー不足: ' + missing.join(', '));
  }

  return [targetHeaders.slice()].concat(data.slice(1).map(function(row) {
    return targetHeaders.map(function(header) {
      return row[sourceMap[header]];
    });
  }));
}

/**
 * HTMLのinline scriptへ安全に埋め込めるJavaScriptリテラルを返す
 * @param {*} value - 埋め込む値
 * @returns {string}
 */
function serializeForInlineScript_(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/**
 * UTF-8（BOM付き）CSVをブラウザからダウンロードする
 * @param {Array<Array>} data - CSVデータ
 * @param {string} filename - ダウンロードファイル名
 * @param {string} dialogTitle - ダイアログタイトル
 */
function downloadCsvUtf8_(data, filename, dialogTitle) {
  var csvText = buildCsvText_(data);
  var htmlOutput = HtmlService.createHtmlOutput(
    '<!DOCTYPE html>' +
    '<html>' +
    '<head><meta charset="utf-8"></head>' +
    '<body>' +
    '<p style="font-family:sans-serif;padding:20px;">ダウンロードを開始しています...</p>' +
    '<script>' +
    '(function() {' +
    '  try {' +
    '    var csvContent = ' + serializeForInlineScript_(csvText) + ';' +
    '    var filename = ' + serializeForInlineScript_(filename) + ';' +
    '    var BOM = "\\uFEFF";' +
    '    var blob = new Blob([BOM + csvContent], { type: "text/csv; charset=utf-8" });' +
    '    var link = document.createElement("a");' +
    '    link.href = URL.createObjectURL(blob);' +
    '    link.download = filename;' +
    '    document.body.appendChild(link);' +
    '    link.click();' +
    '    document.body.removeChild(link);' +
    '    setTimeout(function() { google.script.host.close(); }, 1000);' +
    '  } catch (e) {' +
    '    document.body.innerHTML = "<p style=\\"color:red;padding:20px;font-family:sans-serif;\\">ダウンロードに失敗しました: " + e.message + "</p>";' +
    '  }' +
    '})();' +
    '</script>' +
    '</body>' +
    '</html>'
  ).setWidth(400).setHeight(150);

  SpreadsheetApp.getUi().showModalDialog(htmlOutput, dialogTitle);
}

/**
 * Shift-JIS CSVをブラウザからダウンロードする
 * @param {Array<Array>} data - CSVデータ
 * @param {string} filename - ダウンロードファイル名
 * @param {string} dialogTitle - ダイアログタイトル
 */
function downloadCsvShiftJis_(data, filename, dialogTitle) {
  var csvText = buildCsvText_(data);
  var htmlOutput = HtmlService.createHtmlOutput(
    '<!DOCTYPE html>' +
    '<html>' +
    '<head>' +
    '<meta charset="utf-8">' +
    '<script src="https://cdnjs.cloudflare.com/ajax/libs/encoding-japanese/2.0.0/encoding.min.js"></script>' +
    '</head>' +
    '<body>' +
    '<p style="font-family:sans-serif;padding:20px;">ダウンロードを開始しています...</p>' +
    '<script>' +
    '(function() {' +
    '  try {' +
    '    var csvContent = ' + serializeForInlineScript_(csvText) + ';' +
    '    var filename = ' + serializeForInlineScript_(filename) + ';' +
    '    var unicodeArray = Encoding.stringToCode(csvContent);' +
    '    var sjisArray = Encoding.convert(unicodeArray, { to: "SJIS", from: "UNICODE" });' +
    '    var uint8Array = new Uint8Array(sjisArray);' +
    '    var blob = new Blob([uint8Array], { type: "text/csv; charset=Shift_JIS" });' +
    '    var link = document.createElement("a");' +
    '    link.href = URL.createObjectURL(blob);' +
    '    link.download = filename;' +
    '    document.body.appendChild(link);' +
    '    link.click();' +
    '    document.body.removeChild(link);' +
    '    google.script.host.close();' +
    '  } catch (e) {' +
    '    document.body.innerHTML = "<p style=\\"color:red;padding:20px;font-family:sans-serif;\\">ダウンロードに失敗しました: " + e.message + "</p>";' +
    '  }' +
    '})();' +
    '</script>' +
    '</body>' +
    '</html>'
  ).setWidth(400).setHeight(150);

  SpreadsheetApp.getUi().showModalDialog(htmlOutput, dialogTitle);
}

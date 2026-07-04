/**
 * ==============================================================================
 * 楽天画像配置・マッピングエンジン (DistributorRakuten.js)
 * R-Cabinet API連携、画像パス生成、HTMLテンプレート差し込み、CSVダウンロード
 * ==============================================================================
 */

// =========================================================================
//  楽天 CSV ヘッダー定義
// =========================================================================



/**
 * Google Sheetsの1セルへ書き込める文字数以内か判定する
 * @param {*} value
 * @return {boolean}
 * @private
 */
function isRakutenCellValueWithinLimit_(value) {
  var text = value === undefined || value === null ? '' : String(value);
  return text.length <= RAKUTEN_CONFIG.SHEETS_CELL_MAX_CHARACTERS;
}

/**
 * 楽天画像補助シートのヘッダーを返す
 * @param {string} prefix URLまたはPath
 * @return {string[]}
 * @private
 */
function getRakutenImageSlotHeaders_(prefix) {
  var headers = ['商品番号'];
  for (var i = 1; i <= RAKUTEN_CONFIG.IMAGE_SLOT_COUNT; i++) {
    headers.push(prefix + i);
  }
  return headers;
}

/**
 * 楽天テンプレート処理ログシートを検証し、未作成または空なら初期化する
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss
 * @return {GoogleAppsScript.Spreadsheet.Sheet}
 * @private
 */
function ensureRakutenLogSheet_(ss) {
  var expectedHeaders = ['実行日時', '楽天行番号', '管理コード', '内容', '種別'];
  var sheet = ss.getSheetByName(SHEET_NAMES.RAKUTEN_DASHBOARD);
  if (!sheet) sheet = ss.insertSheet(SHEET_NAMES.RAKUTEN_DASHBOARD);

  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, expectedHeaders.length).setValues([expectedHeaders]);
    return sheet;
  }

  var lastColumn = sheet.getLastColumn();
  var actualHeaders = sheet.getRange(1, 1, 1, Math.max(lastColumn, expectedHeaders.length)).getValues()[0];
  var isValid = lastColumn === expectedHeaders.length;
  for (var i = 0; i < expectedHeaders.length && isValid; i++) {
    if (actualHeaders[i] !== expectedHeaders[i]) isValid = false;
  }
  if (!isValid) {
    throw new Error(
      SHEET_NAMES.RAKUTEN_DASHBOARD + 'シートのヘッダーが不正です。期待値: ' + expectedHeaders.join(', ')
    );
  }
  return sheet;
}

/**
 * 楽天処理ログを追記し、後続のシート変更前に確定する
 * @param {GoogleAppsScript.Spreadsheet.Sheet} logSheet
 * @param {Array<Array<*>>} entries
 * @private
 */
function appendRakutenLogEntries_(logSheet, entries) {
  if (!logSheet || !entries || entries.length === 0) return;
  logSheet.getRange(logSheet.getLastRow() + 1, 1, entries.length, 5).setValues(entries);
  SpreadsheetApp.flush();
}

/**
 * 楽天通常商品CSV（normal-item.csv）の初期ヘッダー
 * ※ 実際には店舗で利用するCSVヘッダーに自動的に適合します。
 * @return {string[]} ヘッダー配列
 */
function getRakutenCsvHeaders() {
  var headers = [
    '商品管理番号（商品URL）', '商品番号', '商品名', 'PC用キャッチコピー', 'モバイル用キャッチコピー',
    '商品画像URL', '商品画像名（ALT）', '動画表示用HTML', 'PC用商品説明文', 'スマートフォン用商品説明文',
    'PC用販売説明文', '消費税', '送料', '個別送料', '注文受付数',
    '在庫数', '在庫数表示', '項目選択肢別在庫用横軸選択肢', '項目選択肢別在庫用縦軸選択肢', '項目選択肢別在庫用残り表示',
    'ヘッダー・フッター・レフトナビ', '表示項目の並び順'
  ];
  for (var i = 1; i <= RAKUTEN_CONFIG.IMAGE_SLOT_COUNT; i++) {
    headers.push('商品画像タイプ' + i, '商品画像パス' + i, '商品画像名（ALT）' + i);
  }
  headers.push('SKU管理番号', 'システム連携用SKU番号', 'SKU画像タイプ', 'SKU画像パス', 'SKU画像名（ALT）');
  return headers;
}

// =========================================================================
//  R-Cabinet API: 共通処理（認証）
// =========================================================================

/**
 * 楽天のAPI接続用ヘッダーを作成する
 * @return {{Authorization: string}} APIヘッダー
 * @private
 */
function getRakutenApiAuthHeader_() {
  var serviceSecret = getSettingValue_(SETTING_KEYS.RAKUTEN_API_SERVICE_SECRET);
  var licenseKey = getSettingValue_(SETTING_KEYS.RAKUTEN_API_LICENSE_KEY);

  if (!serviceSecret || !licenseKey) {
    throw new Error('settingシートに「' + SETTING_KEYS.RAKUTEN_API_SERVICE_SECRET + '」または「' + SETTING_KEYS.RAKUTEN_API_LICENSE_KEY + '」が設定されていません。');
  }

  var authValue = 'ESA ' + Utilities.base64Encode(serviceSecret + ':' + licenseKey);
  return { 'Authorization': authValue };
}

// =========================================================================
//  ⑦ R-Cabinet フォルダ取得
// =========================================================================

/**
 * R-Cabinetから全フォルダの一覧を取得してシートに同期する
 */
function fetchAllFolders() {
  var ui = SpreadsheetApp.getUi();
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  var confirm = ui.alert('フォルダ一覧取得', 'R-Cabinetのすべてのフォルダ情報を同期します。よろしいですか？', ui.ButtonSet.OK_CANCEL);
  if (confirm !== ui.Button.OK) return;

  try {
    var authHeader = getRakutenApiAuthHeader_();
    var firstResponse = fetchFolderDataFromRms_(authHeader, 1, 1);
    var totalCount = getFolderTotalCount_(firstResponse);

    if (totalCount === 0) {
      ui.alert('情報', '取得対象のフォルダは見つかりませんでした。', ui.ButtonSet.OK);
      return;
    }

    var limit = 100;
    var totalRequests = Math.ceil(totalCount / limit);
    var allFolderData = [];

    for (var i = 1; i <= totalRequests; i++) {
      var response = fetchFolderDataFromRms_(authHeader, i, limit);
      var folderData = extractFolderData_(response);
      if (folderData.length > 0) {
        allFolderData = allFolderData.concat(folderData);
      } else {
        break;
      }
      if (i < totalRequests) Utilities.sleep(500); // API負荷軽減
    }

    var sheet = ss.getSheetByName(SHEET_NAMES.RAKUTEN_IMAGE_FOLDERS);
    if (!sheet) throw new Error('「' + SHEET_NAMES.RAKUTEN_IMAGE_FOLDERS + '」シートが見つかりません。');
    
    if (sheet.getLastRow() > 1) {
      sheet.getRange(2, 1, sheet.getLastRow() - 1, 7).clearContent();
    }
    if (allFolderData.length > 0) {
      sheet.getRange(2, 1, allFolderData.length, allFolderData[0].length).setValues(allFolderData);
    }

    completeOperation_({ operation: '楽天フォルダ同期', mode: 'API', status: '完了', success: allFolderData.length },
      '✅ 佐渡市 楽天フォルダ同期完了', allFolderData.length + '件のフォルダ情報を同期しました。', true);
    ui.alert('成功', allFolderData.length + '件のフォルダ情報を取得・同期しました。', ui.ButtonSet.OK);
  } catch (e) {
    completeOperation_({ operation: '楽天フォルダ同期', mode: 'API', status: '異常終了', errors: 1, detail: e.message },
      '❌ 佐渡市 楽天フォルダ同期異常終了', e.message, true);
    ui.alert('エラー', 'フォルダ取得に失敗しました:\n' + e.message, ui.ButtonSet.OK);
  }
}

function fetchFolderDataFromRms_(authHeader, offset, limit) {
  var url = 'https://api.rms.rakuten.co.jp/es/1.0/cabinet/folders/get?offset=' + offset + '&limit=' + limit;
  var response = fetchWithRetry_(url, { method: 'get', headers: authHeader, muteHttpExceptions: true }, 'R-Cabinetフォルダ取得');
  if (response.getResponseCode() !== 200) {
    throw new Error('APIリクエスト失敗: ステータスコード ' + response.getResponseCode());
  }
  return response.getContentText();
}

function getFolderTotalCount_(responseText) {
  var xml = XmlService.parse(responseText);
  var result = xml.getRootElement().getChild('cabinetFoldersGetResult');
  return parseInt(result.getChildText('folderAllCount'), 10) || 0;
}

function extractFolderData_(responseText) {
  var xml = XmlService.parse(responseText);
  var root = xml.getRootElement();
  if (root.getChild('status').getChildText('systemStatus') !== 'OK') {
    throw new Error('APIエラー: ' + root.getChild('status').getChildText('message'));
  }
  var foldersNode = root.getChild('cabinetFoldersGetResult').getChild('folders');
  if (!foldersNode) return [];
  
  return foldersNode.getChildren('folder').map(function(f) {
    return [
      f.getChildText('FolderId') || f.getChildText('folderId') || '',
      f.getChildText('FolderName') || f.getChildText('folderName') || '',
      f.getChildText('FolderPath') || f.getChildText('folderPath') || '',
      f.getChildText('FolderNode') || f.getChildText('folderNode') || '',
      f.getChildText('FileCount') || f.getChildText('fileCount') || '',
      f.getChildText('FileSize') || f.getChildText('fileSize') || '',
      f.getChildText('TimeStamp') || f.getChildText('timeStamp') || ''
    ];
  });
}

// =========================================================================
//  ⑧ R-Cabinet 画像取得
// =========================================================================

/**
 * ユーザーが入力したR-CabinetフォルダIDから画像一覧を取得する
 */
function showGetImagesDialog() {
  var ui = SpreadsheetApp.getUi();
  var defaultFolderId = getSettingValue_(SETTING_KEYS.RAKUTEN_CABINET_FOLDER_ID);
  
  var response = ui.prompt(
    'R-Cabinet 画像一覧取得',
    '取得したいR-CabinetのフォルダIDを入力してください。\n複数ある場合はカンマ区切りまたは改行区切りで入力できます。\n（画像フォルダ一覧シートから確認できます）',
    ui.ButtonSet.OK_CANCEL
  );

  if (response.getSelectedButton() !== ui.Button.OK) return;

  var folderId = response.getResponseText().trim();
  if (!folderId) {
    ui.alert('エラー', 'フォルダIDが空です。', ui.ButtonSet.OK);
    return;
  }

  try {
    fetchCabinetImages_(folderId);
  } catch (e) {
    completeOperation_({ operation: '楽天画像情報同期', mode: 'API', status: '異常終了', errors: 1, detail: e.message },
      '❌ 佐渡市 楽天画像情報同期異常終了', e.message, true);
    ui.alert('エラー', '画像取得に失敗しました:\n' + e.message, ui.ButtonSet.OK);
  }
}

/**
 * フォルダ名やフォルダパス、あるいはフォルダID（数値）から、実際の数値のフォルダIDを解決する
 * @param {string|number} inputId 入力されたフォルダIDまたは名
 * @return {string} 解決された数値のフォルダID
 * @private
 */
function resolveFolderId_(inputId) {
  if (!inputId) {
    throw new Error('フォルダIDが空です。');
  }

  var idStr = String(inputId).trim();
  // すでに数値のみの場合はそのまま返す
  if (/^\d+$/.test(idStr)) {
    return idStr;
  }

  // 数値でない場合は、フォルダ同期シートから検索する
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAMES.RAKUTEN_IMAGE_FOLDERS);
  if (!sheet) {
    throw new Error('フォルダ名からIDを解決しようとしましたが、「' + SHEET_NAMES.RAKUTEN_IMAGE_FOLDERS + '」シートが見つかりません。');
  }

  var lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    throw new Error('フォルダ同期シートにデータがありません。先にメニューから「R-Cabinet フォルダ取得」を実行してください。');
  }

  var data = sheet.getRange(2, 1, lastRow - 1, 3).getValues();
  for (var i = 0; i < data.length; i++) {
    var row = data[i];
    var folderIdVal = String(row[0]).trim();
    var folderNameVal = String(row[1]).trim();
    var folderPathVal = String(row[2]).trim();

    // フォルダ名またはフォルダパスが完全一致、もしくはスラッシュを除いたパスが一致する場合
    if (folderNameVal === idStr || 
        folderPathVal === idStr || 
        folderPathVal === '/' + idStr || 
        idStr === '/' + folderPathVal) {
      if (folderIdVal && /^\d+$/.test(folderIdVal)) {
        Logger.log('フォルダ名「' + idStr + '」からフォルダID「' + folderIdVal + '」を自動解決しました。');
        return folderIdVal;
      }
    }
  }

  // 部分一致でも検索してみる（前方一致や後方一致など）
  for (var i = 0; i < data.length; i++) {
    var row = data[i];
    var folderIdVal = String(row[0]).trim();
    var folderNameVal = String(row[1]).trim();
    var folderPathVal = String(row[2]).trim();

    if (folderNameVal.indexOf(idStr) !== -1 || folderPathVal.indexOf(idStr) !== -1) {
      if (folderIdVal && /^\d+$/.test(folderIdVal)) {
        Logger.log('フォルダ名部分一致「' + idStr + '」からフォルダID「' + folderIdVal + '」を自動解決しました。');
        return folderIdVal;
      }
    }
  }

  throw new Error('入力された「' + idStr + '」は数値のフォルダIDではなく、フォルダ一覧シートからも該当するフォルダ名/フォルダパスが見つかりませんでした。正しいフォルダID(数値)を入力するか、事前に「R-Cabinet フォルダ取得」を実行してください。');
}

function parseCabinetFolderInputs_(input) {
  var values = String(input || '').split(/[\n\r,]+/);
  var seen = {};
  var result = [];
  for (var i = 0; i < values.length; i++) {
    var value = String(values[i] || '').trim();
    if (!value || seen[value]) continue;
    seen[value] = true;
    result.push(value);
  }
  return result;
}

function getCabinetFolderMetaMap_(ss) {
  var map = {};
  var folderSheet = ss.getSheetByName(SHEET_NAMES.RAKUTEN_IMAGE_FOLDERS);
  if (folderSheet && folderSheet.getLastRow() > 1) {
    var folderData = folderSheet.getRange(2, 1, folderSheet.getLastRow() - 1, 3).getValues();
    for (var i = 0; i < folderData.length; i++) {
      var folderId = String(folderData[i][0]).trim();
      if (!folderId) continue;
      map[folderId] = {
        name: String(folderData[i][1]).trim() || '不明',
        path: String(folderData[i][2]).trim(),
      };
    }
  }
  return map;
}

function assertNoDuplicateCabinetImageNames_(imageRows) {
  var seen = {};
  for (var i = 0; i < imageRows.length; i++) {
    var fileName = String(imageRows[i][0] || '').trim();
    if (!fileName) continue;
    var key = fileName.toLowerCase();
    var folderId = String(imageRows[i][8] || '').trim();
    if (seen[key]) {
      throw new Error('R-Cabinet画像取得結果に同名画像があります: ' +
        seen[key].fileName + ' (' + seen[key].folderId + ' / ' + folderId + ')');
    }
    seen[key] = { fileName: fileName, folderId: folderId };
  }
}

function fetchCabinetImages_(folderId) {
  var ui = SpreadsheetApp.getUi();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var authHeader = getRakutenApiAuthHeader_();

  var folderInputs = parseCabinetFolderInputs_(folderId);
  if (folderInputs.length === 0) throw new Error('フォルダIDが空です。');
  var folderMetaMap = getCabinetFolderMetaMap_(ss);
  var limit = 100;
  var allImageData = [];

  for (var f = 0; f < folderInputs.length; f++) {
    var resolvedFolderId = resolveFolderId_(folderInputs[f]);
    var folderMeta = folderMetaMap[resolvedFolderId] || { name: '不明', path: '' };
    var firstResponse = fetchImageDataFromRms_(authHeader, resolvedFolderId, 1, 1);
    var totalCount = getImageTotalCount_(firstResponse);
    if (totalCount === 0) continue;

    var totalRequests = Math.ceil(totalCount / limit);
    for (var i = 1; i <= totalRequests; i++) {
      var response = fetchImageDataFromRms_(authHeader, resolvedFolderId, i, limit);
      var imageData = extractImageData_(response, folderMeta.name, resolvedFolderId, folderMeta.path);
      if (imageData.length > 0) {
        allImageData = allImageData.concat(imageData);
      } else {
        break;
      }
      if (i < totalRequests) Utilities.sleep(500);
    }
    if (f < folderInputs.length - 1) Utilities.sleep(500);
  }

  if (allImageData.length === 0) {
    ui.alert('情報', '指定フォルダには画像が見つかりませんでした。', ui.ButtonSet.OK);
    return;
  }

  assertNoDuplicateCabinetImageNames_(allImageData);

  var sheet = ss.getSheetByName(SHEET_NAMES.RAKUTEN_IMAGE_LIST);
  if (!sheet) throw new Error('「' + SHEET_NAMES.RAKUTEN_IMAGE_LIST + '」シートが見つかりません。');
  
  if (sheet.getLastRow() > 1) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, 10).clearContent();
  }
  if (allImageData.length > 0) {
    sheet.getRange(2, 1, allImageData.length, allImageData[0].length).setValues(allImageData);
  }

  completeOperation_({ operation: '楽天画像情報同期', mode: 'API', status: '完了', success: allImageData.length },
    '✅ 佐渡市 楽天画像情報同期完了', allImageData.length + '件の画像情報を同期しました。対象フォルダ: ' + folderInputs.length + '件', true);
  ui.alert('成功', allImageData.length + '件の画像情報を同期しました。\n対象フォルダ: ' + folderInputs.length + '件', ui.ButtonSet.OK);
}

function fetchImageDataFromRms_(authHeader, folderId, offset, limit) {
  var url = 'https://api.rms.rakuten.co.jp/es/1.0/cabinet/folder/files/get?folderId=' + folderId + '&offset=' + offset + '&limit=' + limit;
  var response = fetchWithRetry_(url, { method: 'get', headers: authHeader, muteHttpExceptions: true }, 'R-Cabinet画像取得');
  if (response.getResponseCode() !== 200) {
    throw new Error('APIリクエスト失敗: ' + response.getResponseCode());
  }
  return response.getContentText();
}

function getImageTotalCount_(responseText) {
  var xml = XmlService.parse(responseText);
  var result = xml.getRootElement().getChild('cabinetFolderFilesGetResult');
  return parseInt(result.getChildText('fileAllCount'), 10) || 0;
}

function extractImageData_(responseText, folderName, folderId, folderPath) {
  var xml = XmlService.parse(responseText);
  var root = xml.getRootElement();
  if (root.getChild('status').getChildText('systemStatus') !== 'OK') {
    throw new Error('APIエラー: ' + root.getChild('status').getChildText('message'));
  }
  var filesNode = root.getChild('cabinetFolderFilesGetResult').getChild('files');
  if (!filesNode) return [];

  return filesNode.getChildren('file').map(function(f) {
    var width = f.getChildText('FileWidth') || f.getChildText('fileWidth') || '';
    var height = f.getChildText('FileHeight') || f.getChildText('fileHeight') || '';
    var sizeBytes = parseInt(f.getChildText('FileSize') || f.getChildText('fileSize') || '0', 10);
    var sizeKb = (sizeBytes / 1024).toFixed(2);

    return [
      f.getChildText('FileName') || f.getChildText('fileName') || '',
      f.getChildText('FileUrl') || f.getChildText('fileUrl') || '',
      f.getChildText('FileId') || f.getChildText('fileId') || '',
      sizeKb,
      width && height ? width + 'x' + height : '',
      f.getChildText('FileAccessDate') || f.getChildText('fileAccessDate') || '',
      f.getChildText('TimeStamp') || f.getChildText('timeStamp') || '',
      folderName || '',
      folderId || '',
      folderPath || ''
    ];
  });
}

// =========================================================================
//  ⑨ 画像パイプライン（一括実行）
// =========================================================================

/**
 * 画像リストの再配置、画像パスの生成、マッピング自動補完をまとめて実行する
 */
function runImagePipeline() {
  var ui = SpreadsheetApp.getUi();
  var confirm = ui.alert('画像パイプライン実行', '画像横並びの作成、画像パス生成、およびマッピングの自動補完を一括で実行します。よろしいですか？', ui.ButtonSet.OK_CANCEL);
  if (confirm !== ui.Button.OK) return;

  try {
    // 1. 画像横並びシートの再編成
    reorganizeImages_();
    // 2. 画像パス生成
    createImagePaths_();
    // 3. マッピングの自動補完
    autoFillImageMapping_();
    completeOperation_({ operation: '楽天画像パイプライン', mode: '本実行', status: '完了', detail: '画像パイプライン完了' },
      '✅ 佐渡市 楽天画像パイプライン完了', '楽天画像パイプラインが完了しました。', true);
    ui.alert('成功', '画像パイプラインの一括処理が完了しました！', ui.ButtonSet.OK);
  } catch (e) {
    completeOperation_({ operation: '楽天画像パイプライン', mode: '本実行', status: '異常終了', errors: 1, detail: e.message },
      '❌ 佐渡市 楽天画像パイプライン異常終了', e.message, true);
    ui.alert('エラー', 'パイプライン処理中にエラーが発生しました:\n' + e.message, ui.ButtonSet.OK);
  }
}

/**
 * Step2: 画像リストを1行1商品の横並び（URL1〜20）に再編成する
 */
function reorganizeImages_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sourceSheet = ss.getSheetByName(SHEET_NAMES.RAKUTEN_IMAGE_LIST);
  var destSheet = ss.getSheetByName(SHEET_NAMES.RAKUTEN_IMAGE_GRID);
  if (!sourceSheet || !destSheet) throw new Error('必要なシートが見つかりません。');

  var sourceData = sourceSheet.getRange(2, 1, Math.max(1, sourceSheet.getLastRow() - 1), 2).getValues();
  if (sourceSheet.getLastRow() < 2) return;

  var processedData = {};

  for (var r = 0; r < sourceData.length; r++) {
    var imageName = String(sourceData[r][0]);
    var imageUrl = sourceData[r][1];
    var lastIdx = imageName.lastIndexOf('_');
    if (!imageName || lastIdx === -1) continue;

    var productNumber = imageName.substring(0, lastIdx);
    var sequence = parseInt(imageName.substring(lastIdx + 1), 10);
    if (isNaN(sequence)) continue;

    if (!processedData[productNumber]) {
      processedData[productNumber] = new Array(RAKUTEN_CONFIG.IMAGE_SLOT_COUNT + 1).fill('');
      processedData[productNumber][0] = productNumber;
    }
    if (sequence >= 1 && sequence <= RAKUTEN_CONFIG.IMAGE_SLOT_COUNT) {
      processedData[productNumber][sequence] = imageUrl;
    }
  }

  var outputArray = Object.keys(processedData).map(function(k) { return processedData[k]; });
  if (destSheet.getLastRow() > 1) {
    destSheet.getRange(2, 1, destSheet.getLastRow() - 1, RAKUTEN_CONFIG.IMAGE_SLOT_COUNT + 1).clearContent();
  }
  if (outputArray.length > 0) {
    destSheet.getRange(2, 1, outputArray.length, RAKUTEN_CONFIG.IMAGE_SLOT_COUNT + 1).setValues(outputArray);
  }
}

/**
 * Step3: 横並び画像URLからR-Cabinet画像パス（folderPath + filename）を生成する
 */
function createImagePaths_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var imageListSheet = ss.getSheetByName(SHEET_NAMES.RAKUTEN_IMAGE_LIST);
  var sourceSheet = ss.getSheetByName(SHEET_NAMES.RAKUTEN_IMAGE_GRID);
  var destSheet = ss.getSheetByName(SHEET_NAMES.RAKUTEN_IMAGE_PATHS);
  if (!imageListSheet || !sourceSheet || !destSheet) throw new Error('必要なシートが見つかりません。');

  if (imageListSheet.getLastRow() < 2 || sourceSheet.getLastRow() < 2) return;

  var imageListData = imageListSheet.getRange(2, 1, imageListSheet.getLastRow() - 1, 10).getValues();
  var sourceData = sourceSheet.getRange(2, 1, sourceSheet.getLastRow() - 1, RAKUTEN_CONFIG.IMAGE_SLOT_COUNT + 1).getValues();

  // URL → フォルダパスのMapを作成
  var urlToPathMap = {};
  for (var i = 0; i < imageListData.length; i++) {
    var url = String(imageListData[i][1]).trim();
    var path = imageListData[i][9] ? String(imageListData[i][9]).trim() : '';
    if (url) urlToPathMap[url] = path;
  }

  var outputData = sourceData.map(function(sourceRow) {
    var newRow = [sourceRow[0]];
    for (var i = 1; i < sourceRow.length; i++) {
      var url = sourceRow[i];
      if (!url || typeof url !== 'string' || url.trim() === '') {
        newRow.push('');
        continue;
      }
      var currentUrl = url.trim();
      var filename = currentUrl.substring(currentUrl.lastIndexOf('/') + 1);
      var folderPath = urlToPathMap[currentUrl];
      if (folderPath) {
        if (!folderPath.endsWith('/')) folderPath += '/';
        newRow.push(folderPath + filename);
      } else {
        newRow.push(filename);
      }
    }
    return newRow;
  });

  if (destSheet.getLastRow() > 1) {
    destSheet.getRange(2, 1, destSheet.getLastRow() - 1, RAKUTEN_CONFIG.IMAGE_SLOT_COUNT + 1).clearContent();
  }
  if (outputData.length > 0) {
    destSheet.getRange(2, 1, outputData.length, RAKUTEN_CONFIG.IMAGE_SLOT_COUNT + 1).setValues(outputData);
  }
}

/**
 * Step4: マッピング自動補完（Choice_TSVの管理コードと、Cabinet画像の商品番号を自動マッピング）
 */
function autoFillImageMapping_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var pathSheet = ss.getSheetByName(SHEET_NAMES.RAKUTEN_IMAGE_PATHS);
  var mappingSheet = ss.getSheetByName(SHEET_NAMES.RAKUTEN_IMAGE_MAPPING);
  var choiceSheet = ss.getSheetByName(SHEET_NAMES.CHOICE_TSV);
  if (!pathSheet || !mappingSheet || !choiceSheet) throw new Error('必要なシートが見つかりません。');

  if (pathSheet.getLastRow() < 2) return;

  // choice_tsvの管理コードのリスト（設定から列名を取得）
  var choiceLastRow = choiceSheet.getLastRow();
  var mgmtCodes = {};
  
  if (choiceLastRow > 1) {
    var mgmtColName = getSettingValue_(SETTING_KEYS.CHOICE_MGMT_CODE_COL) || CHOICE_COLUMNS.MGMT_CODE;
    var choiceHeaders = choiceSheet.getRange(1, 1, 1, choiceSheet.getLastColumn()).getValues()[0];
    var colMap = createColumnMap_(choiceHeaders);
    var mgmtIdx = colMap[mgmtColName];

    if (mgmtIdx !== undefined) {
      var mgmtData = choiceSheet.getRange(2, mgmtIdx + 1, choiceLastRow - 1, 1).getValues();
      for (var i = 0; i < mgmtData.length; i++) {
        var v = String(mgmtData[i][0]).trim();
        if (v) mgmtCodes[v] = true;
      }
    }
  }

  // 既存マッピングをMapに読み込み
  var existingMap = {};
  if (mappingSheet.getLastRow() > 1) {
    var existing = mappingSheet.getRange(2, 1, mappingSheet.getLastRow() - 1, 2).getValues();
    for (var i = 0; i < existing.length; i++) {
      var k = String(existing[i][0]).trim();
      if (k) existingMap[k] = String(existing[i][1]).trim();
    }
  }

  // 画像パスシートの商品番号を取得
  var pathData = pathSheet.getRange(2, 1, pathSheet.getLastRow() - 1, 1).getValues();
  var newMappings = [];
  var COLOR_YELLOW = '#FFFF00';

  for (var i = 0; i < pathData.length; i++) {
    var productNum = String(pathData[i][0]).trim();
    if (!productNum || existingMap.hasOwnProperty(productNum)) continue;

    if (mgmtCodes.hasOwnProperty(productNum)) {
      newMappings.push([productNum, productNum, '自動（一致）']);
    } else {
      newMappings.push([productNum, '', '要手動入力']);
    }
  }

  if (newMappings.length > 0) {
    var startRow = Math.max(2, mappingSheet.getLastRow() + 1);
    mappingSheet.getRange(startRow, 1, newMappings.length, 3).setValues(newMappings);
    for (var i = 0; i < newMappings.length; i++) {
      if (!newMappings[i][1]) {
        mappingSheet.getRange(startRow + i, 1, 1, 3).setBackground(COLOR_YELLOW);
      }
    }
  }
}

// =========================================================================
//  ⑩ HTMLテンプレート差込
// =========================================================================

/**
 * choiceデータをテンプレートに差し込み、rakuten商品説明文＆画像パスをマッピング
 */
function applyTemplateInjection() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ui = SpreadsheetApp.getUi();

  var confirm = ui.alert(
    'HTMLテンプレート差込（楽天）',
    'choiceデータをHTMLテンプレートに差し込み、rakuten_csvの\n' +
    '・PC用商品説明文\n・スマートフォン用商品説明文\n・PC用販売説明文\n' +
    'に転記し、同時に商品画像パス1〜20の自動マッピングを行います。\n\n実行しますか？',
    ui.ButtonSet.OK_CANCEL
  );
  if (confirm !== ui.Button.OK) return;

  try {
    var jobStats = runRakutenTemplateInjectionJob_(false);
    if (jobStats.paused) {
      ui.alert('処理継続中', '処理時間上限のため中断しました。約1分後に自動再開します。', ui.ButtonSet.OK);
      return;
    }
    var result = { updated: jobStats.updated,
      skipped: jobStats.choiceMissing + jobStats.imageMissing + jobStats.otherSkipped,
      charErrors: jobStats.charErrors, mutationErrors: jobStats.mutationErrors, skuImageErrors: 0 };
    var errorCount = result.charErrors + result.mutationErrors + (result.skuImageErrors || 0);
    var resultStatus = errorCount > 0 ? '完了（エラーあり）' : '完了';
    completeOperation_({ operation: '楽天テンプレート差込', mode: '本実行', status: resultStatus,
      success: result.updated, skipped: result.skipped, errors: errorCount, detail: 'テンプレート差込' + resultStatus },
      (errorCount > 0 ? '⚠️' : '✅') + ' 佐渡市 楽天テンプレート差込' + resultStatus,
      '更新: ' + result.updated + '件\nChoiceなし: ' + jobStats.choiceMissing + '件\n画像なし: ' + jobStats.imageMissing +
      '件\nその他スキップ: ' + jobStats.otherSkipped + '件\n文字数超過: ' + jobStats.charErrors +
      '件\n書込みエラー: ' + jobStats.mutationErrors + '件', true);
  } catch (e) {
    PropertiesService.getScriptProperties().setProperty(PROP_KEYS.RAKUTEN_LAST_TEMPLATE_ERRORS, '1');
    var checkpointDetail = e.rakutenCheckpoint ? '\n処理位置: ' + e.rakutenCheckpoint.nextBlockIndex +
      '\n累計: ' + JSON.stringify(e.rakutenCheckpoint.stats) : '';
    completeOperation_({ operation: '楽天テンプレート差込', mode: '本実行', status: '異常終了', errors: 1,
      detail: e.message + checkpointDetail }, '❌ 佐渡市 楽天テンプレート差込異常終了', e.message + checkpointDetail, true);
    ui.alert('エラー', 'テンプレート差込でエラーが発生しました:\n' + e.message + checkpointDetail, ui.ButtonSet.OK);
  }
}

/**
 * テンプレートプレビュー（サンプル1件のみ）
 */
function previewTemplate() {
  var ui = SpreadsheetApp.getUi();
  var confirm = ui.alert(
    'テンプレートプレビュー',
    '最初の商品ブロック1件だけでテンプレート差込を実行します。\n結果はrakuten_csvシートに直接書き込まれます。\n\n実行しますか？',
    ui.ButtonSet.OK_CANCEL
  );
  if (confirm !== ui.Button.OK) return;

  try {
    runRakutenTemplatePreview_();
  } catch (e) {
    ui.alert('エラー', 'プレビューでエラーが発生しました:\n' + e.message, ui.ButtonSet.OK);
  }
}

/** 先頭の空白、タブ、改行だけを除去する。 */
function normalizeRakutenHtmlLeadingWhitespace_(html) {
  return String(html === undefined || html === null ? '' : html).replace(/^[ \t\r\n]+/, '');
}

/** 全画像枠をクリアした後の完成値を、タイプ・パス・ALT順で返す。 */
function buildRakutenProductImageValues_(paths, altText, slotCount) {
  var usable = (paths || []).filter(function(path) { return String(path || '').trim() !== ''; })
    .slice(0, slotCount);
  var values = [];
  for (var i = 0; i < slotCount; i++) {
    if (i < usable.length) values.push('CABINET', String(usable[i]).trim(), String(altText || ''));
    else values.push('', '', '');
  }
  return values;
}

function buildRakutenTemplateImageHtml_(urls, start, count, sales) {
  var selected = selectRakutenTemplateImageUrls_(urls || [], start, count);
  var html = '';
  for (var i = 0; i < selected.length; i++) {
    var url = String(selected[i] || '').trim();
    if (!url) continue;
    html += '<img src="' + url + '" width="' + (sales ? '750px' : '100%') + '">';
    html += sales ? '<br><br>\n' : '<br>\n';
  }
  return sales && html ? '<center>' + html + '</center><br>' : html;
}

/** Choice、画像、テンプレートから商品1件の原子的な変更計画を作る。 */
function planRakutenTemplateProduct_(input) {
  if (!input.choiceData) return { status: 'CHOICE_MISSING', htmlValues: [], imageValues: [], warnings: [] };
  var paths = (input.imagePaths || []).filter(function(path) { return String(path || '').trim() !== ''; });
  if (paths.length === 0) return { status: 'IMAGE_MISSING', htmlValues: [], imageValues: [], warnings: [] };

  var defs = [
    { key: RAKUTEN_CONFIG.TEMPLATE_KEYS.PC_DESC, count: 0, start: 0, sales: false },
    { key: RAKUTEN_CONFIG.TEMPLATE_KEYS.SP_DESC, count: 7, start: 1, sales: false },
    { key: RAKUTEN_CONFIG.TEMPLATE_KEYS.PC_SALES, count: 9, start: 0, sales: true },
  ];
  var htmlValues = [];
  var warnings = [];
  var warned = Object.create(null);
  for (var i = 0; i < defs.length; i++) {
    var def = defs[i];
    var rendered = renderRakutenTemplate_(input.templates[def.key], input.choiceData);
    for (var w = 0; w < rendered.warnings.length; w++) {
      if (!warned[rendered.warnings[w]]) {
        warned[rendered.warnings[w]] = true;
        warnings.push(rendered.warnings[w]);
      }
    }
    var html = rendered.html;
    if (def.count) {
      var imageHtml = buildRakutenTemplateImageHtml_(input.imageUrls, def.start, def.count, def.sales);
      if (html.indexOf('<!-- 画像挿入位置') !== -1) {
        html = html.replace(/<!--\s*画像挿入位置[\s\S]*?-->/g, imageHtml);
      } else if (def.key === RAKUTEN_CONFIG.TEMPLATE_KEYS.SP_DESC) {
        html = imageHtml + html;
      } else {
        html = html.replace(/<\/center>\s*\n/, '</center>\n' + imageHtml + '\n');
      }
    }
    html = normalizeRakutenHtmlLeadingWhitespace_(html.replace(/^<!--[\s\S]*?-->\s*/m, ''));
    if (!isRakutenCellValueWithinLimit_(html)) {
      return { status: 'HTML_ERROR', htmlValues: [], imageValues: [], warnings: warnings,
        error: def.key + ' が文字数超過 (' + html.length + '文字)' };
    }
    htmlValues.push(html);
  }
  var alt = String(input.productName || '').trim();
  if (!alt) alt = String(input.choiceData['（必須）お礼の品名'] || input.choiceData['お礼の品名'] || '').trim();
  alt = alt.split(/[|｜]/)[0].trim();
  return { status: 'UPDATE', htmlValues: htmlValues,
    imageValues: buildRakutenProductImageValues_(paths, alt, input.slotCount || 20), warnings: warnings };
}

function groupAdjacentRakutenMutationColumns_(columns) {
  var sorted = (columns || []).filter(function(value, index, self) {
    return value && self.indexOf(value) === index;
  }).sort(function(a, b) { return a - b; });
  var groups = [];
  for (var i = 0; i < sorted.length; i++) {
    var last = groups[groups.length - 1];
    if (!last || sorted[i] !== last.endColumn + 1) {
      groups.push({ startColumn: sorted[i], endColumn: sorted[i], columns: [sorted[i]] });
    } else {
      last.endColumn = sorted[i];
      last.columns.push(sorted[i]);
    }
  }
  return groups;
}

/** 読み込んだ隣接範囲へ商品計画だけを適用したsetValues payloadを作る。 */
function buildRakutenTemplateBatchWrites_(existingByGroup, productPlans, groups, firstRow) {
  return groups.map(function(group, groupIndex) {
    var values = existingByGroup[groupIndex].values.map(function(row) { return row.slice(); });
    var formulas = existingByGroup[groupIndex].formulas || [];
    for (var r = 0; r < values.length; r++) {
      for (var c = 0; c < values[r].length; c++) if (formulas[r] && formulas[r][c]) values[r][c] = formulas[r][c];
    }
    productPlans.forEach(function(plan) {
      if (plan.status !== 'UPDATE') return;
      var rowIndex = plan.row - firstRow;
      plan.mutations.forEach(function(mutation) {
        if (mutation.column >= group.startColumn && mutation.column <= group.endColumn) {
          values[rowIndex][mutation.column - group.startColumn] = mutation.value;
        }
      });
    });
    return { row: firstRow, column: group.startColumn, numRows: values.length,
      numColumns: group.endColumn - group.startColumn + 1, values: values };
  });
}

function applyRakutenTemplateBatchWrites_(sheet, writes, rollbackWrites) {
  var completed = 0;
  try {
    writes.forEach(function(write) {
      sheet.getRange(write.row, write.column, write.numRows, write.numColumns).setValues(write.values);
      completed++;
    });
  } catch (error) {
    var rollbackErrors = [];
    for (var i = completed - 1; i >= 0; i--) {
      try {
        var original = rollbackWrites[i];
        sheet.getRange(original.row, original.column, original.numRows, original.numColumns).setValues(original.values);
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError.message);
      }
    }
    if (rollbackErrors.length) error.message += ' / ロールバック失敗: ' + rollbackErrors.join('; ');
    throw error;
  }
}

function buildRakutenTemplateCheckpoint_(nextBlockIndex, stats, signature, backupFileId) {
  return { nextBlockIndex: nextBlockIndex, stats: {
    updated: stats.updated || 0, choiceMissing: stats.choiceMissing || 0,
    imageMissing: stats.imageMissing || 0, otherSkipped: stats.otherSkipped || 0,
    charErrors: stats.charErrors || 0, mutationErrors: stats.mutationErrors || 0,
  }, signature: signature, backupFileId: backupFileId || '' };
}

/**
 * テンプレート差込 コア処理
 * @param {boolean} previewMode
 * @private
 */
function runTemplateInjectionLegacy_(previewMode) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ui = SpreadsheetApp.getUi();
  var logSheet = ensureRakutenLogSheet_(ss);

  // 1. テンプレートのロード
  var templateSheet = ss.getSheetByName(SHEET_NAMES.RAKUTEN_TEMPLATE);
  if (!templateSheet) throw new Error('「' + SHEET_NAMES.RAKUTEN_TEMPLATE + '」シートが見つかりません。');

  var tmplData = templateSheet.getDataRange().getValues();
  var templates = {};
  for (var i = 1; i < tmplData.length; i++) {
    var key = String(tmplData[i][RAKUTEN_CONFIG.TEMPLATE_KEY_COL - 1]).trim();
    var val = String(tmplData[i][RAKUTEN_CONFIG.TEMPLATE_VALUE_COL - 1]).trim();
    if (key) templates[key] = val;
  }

  var tmplPC = RAKUTEN_CONFIG.TEMPLATE_KEYS.PC_DESC;
  var tmplSP = RAKUTEN_CONFIG.TEMPLATE_KEYS.SP_DESC;
  var tmplSales = RAKUTEN_CONFIG.TEMPLATE_KEYS.PC_SALES;

  if (!templates[tmplPC] || !templates[tmplSP] || !templates[tmplSales]) {
    throw new Error('rakuten_templateシートにPC_DESC, SP_DESC, PC_SALESのテンプレートが必要です。');
  }

  // 2. Choice_tsvデータのロード
  var choiceSheet = ss.getSheetByName(SHEET_NAMES.CHOICE_TSV);
  if (!choiceSheet) throw new Error('「' + SHEET_NAMES.CHOICE_TSV + '」シートが見つかりません。');
  var choiceMap = buildFullChoiceMap_(choiceSheet);

  // 3. 画像データのロード
  var imageUrlMap = buildImageUrlMap_(ss);
  var imagePathMap = buildImagePathMapForTemplate_(ss);
  var imageMappingMap = buildImageMappingMap_(ss);

  // 4. 楽天シートのロード
  var rakutenSheet = ss.getSheetByName(SHEET_NAMES.RAKUTEN_CSV);
  if (!rakutenSheet) throw new Error('「' + SHEET_NAMES.RAKUTEN_CSV + '」シートが見つかりません。');

  var lastRow = rakutenSheet.getLastRow();
  if (lastRow <= 1) throw new Error('rakuten_csvシートにデータがありません。');

  // カラム位置の自動検出
  var rHeaders = rakutenSheet.getRange(1, 1, 1, rakutenSheet.getLastColumn()).getValues()[0];
  var imageColumns = findRakutenImageColumns_(rHeaders, RAKUTEN_CONFIG.IMAGE_SLOT_COUNT);
  var colMap = {};
  var colNameDefs = {
    'PRODUCT_MGMT_NUM': '商品管理番号',
    'SKU_MGMT_NUM': 'SKU管理番号',
    'SYSTEM_SKU_NUM': 'システム連携用SKU番号',
    'PC_DESC': 'PC用商品説明文',
    'SP_DESC': 'スマートフォン用商品説明文',
    'PC_SALES_DESC': 'PC用販売説明文',
  };

  for (var rh = 0; rh < rHeaders.length; rh++) {
    var hdr = String(rHeaders[rh]).trim();
    for (var constKey in colNameDefs) {
      var headerName = colNameDefs[constKey];
      if (hdr.indexOf(headerName) !== -1 && !colMap[constKey]) {
        colMap[constKey] = rh + 1;
      }
    }
    // 任意ヘッダー「商品名」の検出
    if (hdr.indexOf('商品名') !== -1 && !colMap['PRODUCT_NAME']) {
      colMap['PRODUCT_NAME'] = rh + 1;
    }
    if (hdr === '商品番号' && !colMap['PRODUCT_NUM']) {
      colMap['PRODUCT_NUM'] = rh + 1;
    }
  }

  // 不足カラム確認
  var missingCols = [];
  for (var k in colNameDefs) {
    if (!colMap[k]) missingCols.push(colNameDefs[k]);
  }
  if (missingCols.length > 0) {
    throw new Error('rakuten_csvシートのヘッダーに以下が見つかりません:\n' + missingCols.join('\n'));
  }

  // データ取得
  var productData = rakutenSheet.getRange(2, colMap.PRODUCT_MGMT_NUM, lastRow - 1, 1).getValues();
  var skuMgmtData = rakutenSheet.getRange(2, colMap.SKU_MGMT_NUM, lastRow - 1, 1).getValues();
  var sysSKUData  = rakutenSheet.getRange(2, colMap.SYSTEM_SKU_NUM, lastRow - 1, 1).getValues();
  var productNumData = colMap.PRODUCT_NUM ?
    rakutenSheet.getRange(2, colMap.PRODUCT_NUM, lastRow - 1, 1).getValues() : null;

  var nameData = null;
  if (colMap.PRODUCT_NAME) {
    nameData = rakutenSheet.getRange(2, colMap.PRODUCT_NAME, lastRow - 1, 1).getValues();
  }

  // 楽天のブロック構造解析 (3層構造)
  var blocks = parseProductBlocks_(productData, nameData, skuMgmtData, lastRow);

  // ログシートの初期化
  var logEntryCount = 0;
  var timestamp = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm:ss');

  var missingImageHeaderSets = [];
  for (var ic = 0; ic < imageColumns.length; ic++) {
    if (!imageColumns[ic].type || !imageColumns[ic].path || !imageColumns[ic].alt) {
      missingImageHeaderSets.push(ic + 1);
    }
  }
  if (missingImageHeaderSets.length > 0) {
    appendRakutenLogEntries_(logSheet, [[
      timestamp,
      '',
      '',
      '商品画像ヘッダー不足: ' + missingImageHeaderSets.join(', '),
      'ERROR'
    ]]);
    logEntryCount++;
  }

  var updated = 0;
  var skipped = 0;
  var charErrors = 0;
  var mutationErrors = 0;
  var targetBlocks = previewMode ? blocks.slice(0, 1) : blocks;

  for (var bi = 0; bi < targetBlocks.length; bi++) {
    var block = targetBlocks[bi];
    var productRow = block.startIndex + 2;

    if (block.skuIndices.length === 0) {
      skipped++;
      appendRakutenLogEntries_(logSheet, [[
        timestamp,
        productRow,
        String(productData[block.startIndex][0]).trim(),
        '商品ブロックをスキップ: SKU行なし',
        'WARNING'
      ]]);
      logEntryCount++;
      continue;
    }

    // 最初のSKUのシステム連携用SKU番号をキーにする
    var firstSkuIdx = block.skuIndices[0];
    var sysNum = String(sysSKUData[firstSkuIdx][0]).trim();
    if (!sysNum) {
      skipped++;
      appendRakutenLogEntries_(logSheet, [[
        timestamp,
        productRow,
        String(productData[block.startIndex][0]).trim(),
        '商品ブロックをスキップ: システム連携用SKU番号なし',
        'WARNING'
      ]]);
      logEntryCount++;
      continue;
    }

    var choiceData = choiceMap[sysNum];
    if (!choiceData) {
      skipped++;
      appendRakutenLogEntries_(logSheet, [[
        timestamp,
        productRow,
        sysNum,
        '商品ブロックをスキップ: Choiceデータなし',
        'WARNING'
      ]]);
      logEntryCount++;
      continue;
    }

    // 画像キーは商品番号を優先し、見つからない場合だけシステム連携用SKU番号へフォールバックする。
    var productNum = productNumData && productNumData[block.startIndex] ? String(productNumData[block.startIndex][0]).trim() : '';
    var imageKey = resolveRakutenTemplateImageKey_({ productNumber: productNum, systemSkuNumber: sysNum,
      imageMappingMap: imageMappingMap, imageUrlMap: imageUrlMap, imagePathMap: imagePathMap });

    var templateDefs = [
      { key: tmplPC,    col: colMap.PC_DESC,       imageCount: 0 },
      { key: tmplSP,    col: colMap.SP_DESC,       imageCount: 7 },
      { key: tmplSales, col: colMap.PC_SALES_DESC, imageCount: 9 },
    ];
    var productLogEntries = [];
    var productMutations = [];
    var productWarningKeys = Object.create(null);

    // 各テンプレート差し込み
    for (var ti = 0; ti < templateDefs.length; ti++) {
      var tmplDef = templateDefs[ti];
      var rendered = renderRakutenTemplate_(templates[tmplDef.key], choiceData);
      var html = rendered.html;
      for (var wi = 0; wi < rendered.warnings.length; wi++) {
        var warningKey = rendered.warnings[wi];
        if (productWarningKeys[warningKey]) continue;
        productWarningKeys[warningKey] = true;
        productLogEntries.push([
          timestamp,
          productRow,
          sysNum,
          '空プレースホルダー: {{' + warningKey + '}}',
          'WARNING'
        ]);
      }

      // 画像タグ挿入 (SP用、PC販売説明文のみ)
      if (tmplDef.imageCount > 0 && imageKey) {
        var urls = imageUrlMap[imageKey];
        if (urls) {
          var width = tmplDef.key === tmplSales ? '750px' : '100%';
          var isCenter = tmplDef.key === tmplSales;
          var imgHtml = '';
          var imgStart = tmplDef.key === tmplSP ? 1 : 0; // SPは2枚目から挿入

          var selectedUrls = selectRakutenTemplateImageUrls_(urls, imgStart, tmplDef.imageCount);
          for (var im = 0; im < selectedUrls.length; im++) {
            if (selectedUrls[im]) {
              imgHtml += '<img src="' + selectedUrls[im] + '" width="' + width + '">';
              if (tmplDef.key === tmplSales) imgHtml += '<br><br>\n';
              else imgHtml += '<br>\n';
            }
          }
          if (isCenter) imgHtml = '<center>' + imgHtml + '</center><br>';

          if (html.indexOf('<!-- 画像挿入位置') !== -1) {
            html = html.replace(/<!--\s*画像挿入位置[\s\S]*?-->/g, imgHtml);
          } else if (tmplDef.key === tmplSP) {
            html = imgHtml + '\n' + html;
          } else {
            html = html.replace(/<\/center>\s*\n/, '</center>\n' + imgHtml + '\n');
          }
        }
      }

      // コメント削除
      html = html.replace(/^<!--[\s\S]*?-->\s*/m, '');

      // 文字数チェック
      if (!isRakutenCellValueWithinLimit_(html)) {
        charErrors++;
        productLogEntries.push([
          timestamp,
          productRow,
          sysNum,
          tmplDef.key + ' が文字数超過 (' + html.length + '文字)',
          'ERROR'
        ]);
        continue;
      }

      productMutations.push({ row: productRow, column: tmplDef.col, value: html });
    }

    // 商品画像パスの書き込み (商品レベル行)
    if (imageKey) {
      var paths = imagePathMap[imageKey];
      if (paths) {
        var productName = '';
        if (nameData && nameData[block.startIndex]) {
          productName = String(nameData[block.startIndex][0]).trim();
        }
        if (!productName && choiceData) {
          productName = String(choiceData['（必須）お礼の品名'] || choiceData['お礼の品名'] || '').split(/[|｜]/)[0].trim();
        }
        for (var p = 0; p < paths.length && p < imageColumns.length; p++) {
          var imageColumn = imageColumns[p];
          if (paths[p] && imageColumn.type && imageColumn.path && imageColumn.alt) {
            productMutations.push({ row: productRow, column: imageColumn.type, value: 'CABINET' });
            productMutations.push({ row: productRow, column: imageColumn.path, value: paths[p] });
            productMutations.push({ row: productRow, column: imageColumn.alt, value: productName });
          }
        }
      }
    }

    appendRakutenLogEntries_(logSheet, productLogEntries);
    logEntryCount += productLogEntries.length;

    if (productMutations.length === 0) continue;

    try {
      var minMutationColumn = productMutations[0].column;
      var maxMutationColumn = productMutations[0].column;
      for (var mi = 0; mi < productMutations.length; mi++) {
        var mutation = productMutations[mi];
        if (mutation.column < minMutationColumn) minMutationColumn = mutation.column;
        if (mutation.column > maxMutationColumn) maxMutationColumn = mutation.column;
      }

      var mutationColumnCount = maxMutationColumn - minMutationColumn + 1;
      var mutationRange = rakutenSheet.getRange(productRow, minMutationColumn, 1, mutationColumnCount);
      var mutationValues = mutationRange.getValues()[0];
      var mutationFormulas = mutationRange.getFormulas()[0];
      for (var fi = 0; fi < mutationFormulas.length; fi++) {
        if (mutationFormulas[fi]) mutationValues[fi] = mutationFormulas[fi];
      }
      for (var mvi = 0; mvi < productMutations.length; mvi++) {
        var productMutation = productMutations[mvi];
        mutationValues[productMutation.column - minMutationColumn] = productMutation.value;
      }
      mutationRange.setValues([mutationValues]);
      updated++;
    } catch (mutationError) {
      mutationErrors++;
      appendRakutenLogEntries_(logSheet, [[
        timestamp,
        productRow,
        sysNum,
        '商品更新エラー: ' + mutationError.message,
        'ERROR'
      ]]);
      logEntryCount++;
    }
  }

  // マルチSKU行には、各システム連携用SKU番号に対応する先頭画像を設定する。
  var skuImageErrors = 0;
  if (!previewMode && typeof loadNumberMapping_ === 'function') {
    var migrationMap = loadNumberMapping_();
    if (migrationMap.errors.length > 0) throw new Error('number_mappingにエラーがあります:\n' + migrationMap.errors.join('\n'));
    var currentRakutenData = rakutenSheet.getDataRange().getValues();
    var skuPathMap = {};
    migrationMap.rows.forEach(function(mappingRow) {
      var newImageKey = resolveImageKey_(mappingRow.newSku, imageMappingMap);
      var oldImageKey = resolveImageKey_(mappingRow.oldSku, imageMappingMap);
      if (imagePathMap[newImageKey]) skuPathMap[numberKey_(mappingRow.newSku)] = imagePathMap[newImageKey];
      if (imagePathMap[oldImageKey]) skuPathMap[numberKey_(mappingRow.oldSku)] = imagePathMap[oldImageKey];
    });
    var skuImagePlan = planMultiSkuImages_(currentRakutenData, skuPathMap, migrationMap);
    applyMultiSkuImageChanges_(rakutenSheet, currentRakutenData, skuImagePlan.changes);
    skuImageErrors = skuImagePlan.errors.length;
    var skuLogEntries = [];
    skuImagePlan.warnings.forEach(function(message) { skuLogEntries.push([timestamp, '', '', message, 'WARNING']); });
    skuImagePlan.errors.forEach(function(message) { skuLogEntries.push([timestamp, '', '', message, 'ERROR']); });
    appendRakutenLogEntries_(logSheet, skuLogEntries);
    PropertiesService.getScriptProperties().setProperty(PROP_KEYS.RAKUTEN_LAST_SKU_IMAGE_ERRORS, String(skuImageErrors));
  }

  if (logEntryCount > 0) Logger.log('テンプレート差し込みログ数: ' + logEntryCount);

  var resultMsg = [
    (previewMode ? 'プレビュー' : 'テンプレート差込') + '完了！\n',
    '✅ 更新: ' + updated + ' 件',
    '⚠️ スキップ: ' + skipped + ' 件',
  ];
  if (charErrors > 0) resultMsg.push('❌ 文字数超過: ' + charErrors + ' 件');
  if (mutationErrors > 0) resultMsg.push('❌ 更新エラー: ' + mutationErrors + ' 件');
  if (skuImageErrors > 0) resultMsg.push('❌ マルチSKU画像不足: ' + skuImageErrors + ' 件');

  if (!previewMode && typeof PropertiesService !== 'undefined') {
    PropertiesService.getScriptProperties().setProperty(
      PROP_KEYS.RAKUTEN_LAST_TEMPLATE_ERRORS,
      String(charErrors + mutationErrors)
    );
  }

  ui.alert('実行結果', resultMsg.join('\n'), ui.ButtonSet.OK);
  return { updated: updated, skipped: skipped, charErrors: charErrors, mutationErrors: mutationErrors, skuImageErrors: skuImageErrors };
}

function getRakutenTemplateColumnMap_(headers) {
  var names = { PRODUCT_MGMT_NUM: '商品管理番号', SKU_MGMT_NUM: 'SKU管理番号',
    SYSTEM_SKU_NUM: 'システム連携用SKU番号', PC_DESC: 'PC用商品説明文',
    SP_DESC: 'スマートフォン用商品説明文', PC_SALES_DESC: 'PC用販売説明文' };
  var map = {};
  headers.forEach(function(header, index) {
    var text = String(header || '').trim();
    Object.keys(names).forEach(function(key) {
      if (!map[key] && text.indexOf(names[key]) !== -1) map[key] = index + 1;
    });
    if (!map.PRODUCT_NAME && text === '商品名') map.PRODUCT_NAME = index + 1;
    if (!map.PRODUCT_NUM && text === '商品番号') map.PRODUCT_NUM = index + 1;
  });
  var missing = Object.keys(names).filter(function(key) { return !map[key]; }).map(function(key) { return names[key]; });
  if (missing.length) throw new Error('rakuten_csvシートのヘッダーに以下が見つかりません:\n' + missing.join('\n'));
  return map;
}

function loadRakutenTemplateJobContext_(ss) {
  var templateSheet = ss.getSheetByName(SHEET_NAMES.RAKUTEN_TEMPLATE);
  var choiceSheet = ss.getSheetByName(SHEET_NAMES.CHOICE_TSV);
  var sheet = ss.getSheetByName(SHEET_NAMES.RAKUTEN_CSV);
  if (!templateSheet || !choiceSheet || !sheet) throw new Error('楽天テンプレート差込に必要なシートが見つかりません。');
  var templateRows = templateSheet.getDataRange().getValues();
  var templates = {};
  for (var i = 1; i < templateRows.length; i++) {
    var key = String(templateRows[i][RAKUTEN_CONFIG.TEMPLATE_KEY_COL - 1] || '').trim();
    if (key) templates[key] = String(templateRows[i][RAKUTEN_CONFIG.TEMPLATE_VALUE_COL - 1] || '');
  }
  Object.keys(RAKUTEN_CONFIG.TEMPLATE_KEYS).forEach(function(key) {
    if (!templates[RAKUTEN_CONFIG.TEMPLATE_KEYS[key]]) throw new Error('rakuten_templateシートに必要なテンプレートがありません。');
  });
  var rakutenRange = sheet.getDataRange();
  var values = rakutenRange.getValues();
  if (values.length < 2) throw new Error('rakuten_csvシートにデータがありません。');
  var headers = values[0];
  var colMap = getRakutenTemplateColumnMap_(headers);
  var imageColumns = findRakutenImageColumns_(headers, RAKUTEN_CONFIG.IMAGE_SLOT_COUNT);
  var missingImages = imageColumns.filter(function(cols) { return !cols.type || !cols.path || !cols.alt; });
  if (missingImages.length) throw new Error('商品画像ヘッダー不足: 1〜20のタイプ・パス・ALTが必要です。');
  var productData = values.slice(1).map(function(row) { return [row[colMap.PRODUCT_MGMT_NUM - 1]]; });
  var skuData = values.slice(1).map(function(row) { return [row[colMap.SKU_MGMT_NUM - 1]]; });
  var nameData = colMap.PRODUCT_NAME ? values.slice(1).map(function(row) { return [row[colMap.PRODUCT_NAME - 1]]; }) : null;
  var choiceRange = choiceSheet.getDataRange();
  var choiceValues = choiceRange.getValues();
  return { sheet: sheet, values: values, headers: headers, colMap: colMap, imageColumns: imageColumns,
    templates: templates, choiceMap: buildFullChoiceMapFromValues_(choiceValues[0] || [], choiceValues.slice(1)), imageUrlMap: buildImageUrlMap_(ss),
    imagePathMap: buildImagePathMapForTemplate_(ss), imageMappingMap: buildImageMappingMap_(ss),
    blocks: parseProductBlocks_(productData, nameData, skuData, values.length), templateRows: templateRows,
    choiceValues: choiceValues };
}

function computeRakutenTemplateSignature_(context) {
  var identity = context.values.map(function(row, index) {
    if (index === 0) return [];
    return [row[context.colMap.PRODUCT_MGMT_NUM - 1], row[context.colMap.SKU_MGMT_NUM - 1], row[context.colMap.SYSTEM_SKU_NUM - 1]];
  });
  var source = JSON.stringify([context.templateRows, context.choiceValues, context.imageUrlMap,
    context.imagePathMap, context.imageMappingMap, identity]);
  if (typeof Utilities === 'undefined' || !Utilities.computeDigest) return source;
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, source, Utilities.Charset.UTF_8)
    .map(function(byte) { return ('0' + ((byte + 256) % 256).toString(16)).slice(-2); }).join('');
}

function escapeRakutenBackupCsv_(value) {
  var text = String(value === undefined || value === null ? '' : value);
  return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}

function loadRakutenBackupFormulaOverrides_(sheet, blocks, columns, chunkSize) {
  var overrides = Object.create(null);
  var groups = groupAdjacentRakutenMutationColumns_(columns);
  var size = chunkSize || RAKUTEN_TEMPLATE_CONFIG_.BATCH_PRODUCTS;
  for (var offset = 0; offset < blocks.length; offset += size) {
    var chunk = blocks.slice(offset, offset + size);
    if (!chunk.length) continue;
    var firstRow = chunk[0].startIndex + 2;
    var lastRow = chunk[chunk.length - 1].startIndex + 2;
    groups.forEach(function(group) {
      var formulas = sheet.getRange(firstRow, group.startColumn, lastRow - firstRow + 1,
        group.endColumn - group.startColumn + 1).getFormulas();
      chunk.forEach(function(block) {
        var row = block.startIndex + 2;
        var source = formulas[row - firstRow] || [];
        for (var i = 0; i < source.length; i++) {
          if (!source[i]) continue;
          if (!overrides[row]) overrides[row] = Object.create(null);
          overrides[row][group.startColumn + i] = source[i];
        }
      });
    });
  }
  return overrides;
}

function backupRakutenTemplateTargets_(spreadsheet, sheet, blocks, columnMap, sourceValues, formulaOverrides) {
  var headers = ['楽天元行番号', '商品管理番号', 'システム連携用SKU番号', 'PC用商品説明文',
    'スマートフォン用商品説明文', 'PC用販売説明文'];
  for (var i = 1; i <= 20; i++) headers.push('商品画像タイプ' + i, '商品画像パス' + i, '商品画像名（ALT）' + i);
  var all = sourceValues || sheet.getDataRange().getValues();
  var imageColumns = findRakutenImageColumns_(all[0], 20);
  var targetColumns = [columnMap.PC_DESC, columnMap.SP_DESC, columnMap.PC_SALES_DESC];
  imageColumns.forEach(function(cols) { targetColumns.push(cols.type, cols.path, cols.alt); });
  var overrides = formulaOverrides || loadRakutenBackupFormulaOverrides_(sheet, blocks, targetColumns,
    RAKUTEN_TEMPLATE_CONFIG_.BATCH_PRODUCTS);
  var rows = [headers];
  blocks.forEach(function(block) {
    var sourceIndex = block.startIndex + 1;
    var source = all[sourceIndex];
    function cell(column) { return overrides[block.startIndex + 2] && overrides[block.startIndex + 2][column] || source[column - 1]; }
    var skuIndex = block.skuIndices.length ? block.skuIndices[0] + 1 : -1;
    var row = [block.startIndex + 2, cell(columnMap.PRODUCT_MGMT_NUM),
      skuIndex >= 0 ? all[skuIndex][columnMap.SYSTEM_SKU_NUM - 1] : '', source[columnMap.PC_DESC - 1],
      cell(columnMap.SP_DESC), cell(columnMap.PC_SALES_DESC)];
    row[3] = cell(columnMap.PC_DESC);
    imageColumns.forEach(function(cols) { row.push(cell(cols.type), cell(cols.path), cell(cols.alt)); });
    rows.push(row);
  });
  var csv = '\uFEFF' + rows.map(function(row) { return row.map(escapeRakutenBackupCsv_).join(','); }).join('\r\n');
  var blob = Utilities.newBlob(csv, 'text/csv', 'rakuten_template_backup_' + Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyyMMdd_HHmmss') + '.csv');
  var spreadsheetFile = DriveApp.getFileById(spreadsheet.getId());
  var parents = spreadsheetFile.getParents();
  var folder = parents.hasNext() ? parents.next() : DriveApp.getRootFolder();
  return folder.createFile(blob).getId();
}

function buildRakutenTemplatePlans_(context, blocks, timestamp) {
  var plans = [], logs = [], stats = { updated: 0, choiceMissing: 0, imageMissing: 0,
    otherSkipped: 0, charErrors: 0, mutationErrors: 0 };
  blocks.forEach(function(block) {
    var rowNumber = block.startIndex + 2;
    var productRow = context.values[block.startIndex + 1];
    var productCode = String(productRow[context.colMap.PRODUCT_MGMT_NUM - 1] || '').trim();
    if (!block.skuIndices.length) {
      stats.otherSkipped++; logs.push([timestamp, rowNumber, '', productCode + ': SKU行なし', 'WARNING']); return;
    }
    var skuRow = context.values[block.skuIndices[0] + 1];
    var sysNum = String(skuRow[context.colMap.SYSTEM_SKU_NUM - 1] || '').trim();
    if (!sysNum) { stats.otherSkipped++; logs.push([timestamp, rowNumber, '', productCode + ': システム連携用SKU番号なし', 'WARNING']); return; }
    var productNum = context.colMap.PRODUCT_NUM ? String(productRow[context.colMap.PRODUCT_NUM - 1] || '').trim() : '';
    var imageKey = resolveRakutenTemplateImageKey_({ productNumber: productNum, systemSkuNumber: sysNum,
      imageMappingMap: context.imageMappingMap, imageUrlMap: context.imageUrlMap, imagePathMap: context.imagePathMap });
    var plan = planRakutenTemplateProduct_({ choiceData: context.choiceMap[sysNum], templates: context.templates,
      imageUrls: context.imageUrlMap[imageKey] || [], imagePaths: context.imagePathMap[imageKey] || [],
      productName: context.colMap.PRODUCT_NAME ? productRow[context.colMap.PRODUCT_NAME - 1] : '', slotCount: 20 });
    if (plan.status !== 'UPDATE') {
      var reason = plan.status === 'CHOICE_MISSING' ? 'Choiceデータなし' : plan.status === 'IMAGE_MISSING' ? '新画像なし' : plan.error;
      if (plan.status === 'CHOICE_MISSING') stats.choiceMissing++;
      else if (plan.status === 'IMAGE_MISSING') stats.imageMissing++;
      else stats.charErrors++;
      logs.push([timestamp, rowNumber, sysNum, productCode + ': ' + reason, plan.status === 'HTML_ERROR' ? 'ERROR' : 'WARNING']);
      return;
    }
    var mutations = [
      { column: context.colMap.PC_DESC, value: plan.htmlValues[0] },
      { column: context.colMap.SP_DESC, value: plan.htmlValues[1] },
      { column: context.colMap.PC_SALES_DESC, value: plan.htmlValues[2] },
    ];
    context.imageColumns.forEach(function(cols, index) {
      mutations.push({ column: cols.type, value: plan.imageValues[index * 3] },
        { column: cols.path, value: plan.imageValues[index * 3 + 1] },
        { column: cols.alt, value: plan.imageValues[index * 3 + 2] });
    });
    plan.warnings.forEach(function(key) { logs.push([timestamp, rowNumber, sysNum, productCode + ': 空プレースホルダー: {{' + key + '}}', 'WARNING']); });
    plans.push({ row: rowNumber, status: 'UPDATE', mutations: mutations, systemSku: sysNum, productCode: productCode });
  });
  return { plans: plans, logs: logs, stats: stats };
}

/** バックアップ対象判定用。商品計画は1件ずつ生成し、変更配列を保持しない。 */
function findEligibleRakutenTemplateBlocks_(context) {
  var eligible = [];
  for (var i = 0; i < context.blocks.length; i++) {
    var block = context.blocks[i];
    if (!block.skuIndices.length) continue;
    var productRow = context.values[block.startIndex + 1];
    var skuRow = context.values[block.skuIndices[0] + 1];
    var sysNum = String(skuRow[context.colMap.SYSTEM_SKU_NUM - 1] || '').trim();
    if (!sysNum || !context.choiceMap[sysNum]) continue;
    var productNum = context.colMap.PRODUCT_NUM ? String(productRow[context.colMap.PRODUCT_NUM - 1] || '').trim() : '';
    var imageKey = resolveRakutenTemplateImageKey_({ productNumber: productNum, systemSkuNumber: sysNum,
      imageMappingMap: context.imageMappingMap, imageUrlMap: context.imageUrlMap, imagePathMap: context.imagePathMap });
    var plan = planRakutenTemplateProduct_({ choiceData: context.choiceMap[sysNum], templates: context.templates,
      imageUrls: context.imageUrlMap[imageKey] || [], imagePaths: context.imagePathMap[imageKey] || [],
      productName: context.colMap.PRODUCT_NAME ? productRow[context.colMap.PRODUCT_NAME - 1] : '', slotCount: 20 });
    if (plan.status === 'UPDATE') eligible.push(block);
  }
  return eligible;
}

function executeRakutenTemplateBatch_(context, blocks, logSheet, timestamp) {
  var built = buildRakutenTemplatePlans_(context, blocks, timestamp);
  if (built.plans.length) {
    var firstRow = blocks[0].startIndex + 2;
    var lastRow = blocks[blocks.length - 1].endIndex + 2;
    var columns = [];
    built.plans.forEach(function(plan) { plan.mutations.forEach(function(mutation) { columns.push(mutation.column); }); });
    var groups = groupAdjacentRakutenMutationColumns_(columns);
    var existing = groups.map(function(group) {
      var range = context.sheet.getRange(firstRow, group.startColumn, lastRow - firstRow + 1, group.endColumn - group.startColumn + 1);
      return { values: range.getValues(), formulas: range.getFormulas() };
    });
    var rollbackWrites = groups.map(function(group, index) {
      var original = existing[index].values.map(function(row, rowIndex) {
        return row.map(function(value, columnIndex) {
          return existing[index].formulas[rowIndex] && existing[index].formulas[rowIndex][columnIndex] || value;
        });
      });
      return { row: firstRow, column: group.startColumn, numRows: original.length,
        numColumns: group.endColumn - group.startColumn + 1, values: original };
    });
    try {
      applyRakutenTemplateBatchWrites_(context.sheet,
        buildRakutenTemplateBatchWrites_(existing, built.plans, groups, firstRow), rollbackWrites);
      built.stats.updated += built.plans.length;
    } catch (error) {
      built.stats.mutationErrors += built.plans.length;
      built.plans.forEach(function(plan) { built.logs.push([timestamp, plan.row, plan.systemSku,
        plan.productCode + ': 書込みエラー: ' + error.message, 'ERROR']); });
      error.rakutenBatchStats = built.stats;
      throw error;
    } finally {
      appendRakutenLogEntries_(logSheet, built.logs);
    }
  } else appendRakutenLogEntries_(logSheet, built.logs);
  return built.stats;
}

function mergeRakutenTemplateStats_(target, source) {
  Object.keys(target).forEach(function(key) { target[key] += source[key] || 0; });
}

function runRakutenTemplatePreview_() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) throw new Error('楽天テンプレート差込は実行中です。');
  var stats;
  try {
    var props = PropertiesService.getScriptProperties();
    if (props.getProperty(PROP_KEYS.RAKUTEN_TEMPLATE_PROGRESS) || hasRakutenTemplateResumeTrigger_()) {
      throw new Error('楽天テンプレート差込は実行中または再開待ちです。');
    }
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var context = loadRakutenTemplateJobContext_(ss);
    var logSheet = ensureRakutenLogSheet_(ss);
    var timestamp = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm:ss');
    stats = executeRakutenTemplateBatch_(context, context.blocks.slice(0, 1), logSheet, timestamp);
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }
  var reason = stats.choiceMissing ? 'Choiceデータなし' : stats.imageMissing ? '新画像なし' :
    stats.otherSkipped ? 'SKU情報不足' : stats.charErrors ? 'HTML文字数超過' : '';
  SpreadsheetApp.getUi().alert('実行結果', 'プレビュー完了！\n\n✅ 更新: ' + stats.updated + ' 件' +
    (reason ? '\n⚠️ 変更なし: ' + reason : ''), SpreadsheetApp.getUi().ButtonSet.OK);
  return { updated: stats.updated, skipped: stats.choiceMissing + stats.imageMissing + stats.otherSkipped,
    charErrors: stats.charErrors, mutationErrors: stats.mutationErrors, skuImageErrors: 0 };
}

/* 旧内部APIは既存連携向けに残す。本番メニューとプレビューは新ジョブを使用する。 */
function runTemplateInjection_(previewMode) {
  return runTemplateInjectionLegacy_(previewMode);
}

function scheduleRakutenTemplateResume_() {
  deleteTriggersByFunction_('resumeRakutenTemplateInjection');
  ScriptApp.newTrigger('resumeRakutenTemplateInjection').timeBased().after(RAKUTEN_TEMPLATE_CONFIG_.RESUME_DELAY_MS).create();
}

function hasRakutenTemplateResumeTrigger_() {
  if (typeof ScriptApp === 'undefined' || !ScriptApp.getProjectTriggers) return false;
  return ScriptApp.getProjectTriggers().some(function(trigger) {
    return trigger.getHandlerFunction() === 'resumeRakutenTemplateInjection';
  });
}

function isRakutenTemplateTimeLimitReached_(startedAt) {
  return Date.now() - startedAt >= RAKUTEN_TEMPLATE_CONFIG_.TIME_LIMIT_MS;
}

function runRakutenTemplateInjectionJob_(isResume) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) throw new Error('楽天テンプレート差込は実行中です。');
  var start = Date.now();
  var shouldCleanupResumeTrigger = false;
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var props = PropertiesService.getScriptProperties();
    var savedText = props.getProperty(PROP_KEYS.RAKUTEN_TEMPLATE_PROGRESS);
    if (!isResume && (savedText || hasRakutenTemplateResumeTrigger_())) {
      throw new Error('楽天テンプレート差込は実行中または再開待ちです。');
    }
    if (isResume && !savedText) return null;
    shouldCleanupResumeTrigger = true;
    var context = loadRakutenTemplateJobContext_(ss);
    var signature = computeRakutenTemplateSignature_(context);
    var checkpoint = savedText ? JSON.parse(savedText) : buildRakutenTemplateCheckpoint_(0, {}, signature, '');
    if (checkpoint.signature !== signature) {
      deleteTriggersByFunction_('resumeRakutenTemplateInjection');
      throw new Error('入力データが開始時から変更されました。進捗リセット後に再実行してください。');
    }
    if (!checkpoint.backupFileId) {
      var eligibleBlocks = findEligibleRakutenTemplateBlocks_(context);
      checkpoint.backupFileId = backupRakutenTemplateTargets_(ss, context.sheet, eligibleBlocks, context.colMap,
        context.values);
      props.setProperty(PROP_KEYS.RAKUTEN_TEMPLATE_PROGRESS, JSON.stringify(checkpoint));
    }
    var timestamp = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm:ss');
    var logSheet = ensureRakutenLogSheet_(ss);
    while (checkpoint.nextBlockIndex < context.blocks.length) {
      if (isRakutenTemplateTimeLimitReached_(start)) {
        props.setProperty(PROP_KEYS.RAKUTEN_TEMPLATE_PROGRESS, JSON.stringify(checkpoint));
        scheduleRakutenTemplateResume_();
        checkpoint.stats.paused = true;
        return checkpoint.stats;
      }
      var end = Math.min(checkpoint.nextBlockIndex + RAKUTEN_TEMPLATE_CONFIG_.BATCH_PRODUCTS, context.blocks.length);
      var batchStats = executeRakutenTemplateBatch_(context, context.blocks.slice(checkpoint.nextBlockIndex, end), logSheet, timestamp);
      SpreadsheetApp.flush();
      mergeRakutenTemplateStats_(checkpoint.stats, batchStats);
      checkpoint.nextBlockIndex = end;
      props.setProperty(PROP_KEYS.RAKUTEN_TEMPLATE_PROGRESS, JSON.stringify(checkpoint));
    }
    SpreadsheetApp.flush();
    props.deleteProperty(PROP_KEYS.RAKUTEN_TEMPLATE_PROGRESS);
    deleteTriggersByFunction_('resumeRakutenTemplateInjection');
    props.setProperty(PROP_KEYS.RAKUTEN_LAST_TEMPLATE_ERRORS, String(checkpoint.stats.charErrors + checkpoint.stats.mutationErrors));
    checkpoint.stats.paused = false;
    return checkpoint.stats;
  } catch (error) {
    if (shouldCleanupResumeTrigger && typeof deleteTriggersByFunction_ === 'function') {
      deleteTriggersByFunction_('resumeRakutenTemplateInjection');
    }
    if (typeof checkpoint !== 'undefined' && checkpoint && typeof props !== 'undefined' && props) {
      if (error.rakutenBatchStats) mergeRakutenTemplateStats_(checkpoint.stats, error.rakutenBatchStats);
      checkpoint.lastError = error.message;
      checkpoint.failedBlockIndex = checkpoint.nextBlockIndex;
      props.setProperty(PROP_KEYS.RAKUTEN_TEMPLATE_PROGRESS, JSON.stringify(checkpoint));
      error.rakutenCheckpoint = checkpoint;
    }
    throw error;
  } finally {
    lock.releaseLock();
  }
}

function resumeRakutenTemplateInjection() {
  try {
    var stats = runRakutenTemplateInjectionJob_(true);
    if (stats && !stats.paused && typeof completeOperation_ === 'function') {
      completeOperation_({ operation: '楽天テンプレート差込', mode: '自動再開', status: '完了',
        success: stats.updated, skipped: stats.choiceMissing + stats.imageMissing + stats.otherSkipped,
        errors: stats.charErrors + stats.mutationErrors }, '✅ 佐渡市 楽天テンプレート差込完了',
        '更新: ' + stats.updated + '件\nChoiceなし: ' + stats.choiceMissing + '件\n画像なし: ' + stats.imageMissing +
        '件\nその他スキップ: ' + stats.otherSkipped + '件\n文字数超過: ' + stats.charErrors +
        '件\n書込みエラー: ' + stats.mutationErrors + '件', true);
    }
    return stats;
  } catch (error) {
    var failed = error.rakutenCheckpoint;
    var detail = error.message + (failed ? '\n処理済み位置: ' + failed.nextBlockIndex +
      '\n累計: ' + JSON.stringify(failed.stats) : '');
    if (typeof completeOperation_ === 'function') completeOperation_({ operation: '楽天テンプレート差込', mode: '自動再開',
      status: '異常終了', errors: 1, detail: detail }, '❌ 佐渡市 楽天テンプレート差込異常終了', detail, true);
    throw error;
  }
}

// =========================================================================
//  テンプレート差込: ヘルパー関数
// =========================================================================

/**
 * 楽天CSVヘッダーから各画像番号の3列を完全一致で検出する
 * @param {Array<*>} headers
 * @param {number} maxImages
 * @return {Array<{type: (number|null), path: (number|null), alt: (number|null)}>} 1始まりの列番号
 * @private
 */
function findRakutenImageColumns_(headers, maxImages) {
  var requiredHeaders = Object.create(null);
  for (var i = 1; i <= maxImages; i++) {
    requiredHeaders['商品画像タイプ' + i] = true;
    requiredHeaders['商品画像パス' + i] = true;
    requiredHeaders['商品画像名（ALT）' + i] = true;
  }

  var positions = Object.create(null);
  var duplicateHeaders = [];
  for (var h = 0; h < headers.length; h++) {
    var header = headers[h];
    if (!requiredHeaders[header]) continue;
    if (Object.prototype.hasOwnProperty.call(positions, header)) {
      if (duplicateHeaders.indexOf(header) === -1) duplicateHeaders.push(header);
    } else {
      positions[header] = h + 1;
    }
  }
  if (duplicateHeaders.length > 0) {
    throw new Error('楽天画像ヘッダーが重複しています: ' + duplicateHeaders.join(', '));
  }

  var imageColumns = [];
  for (var i = 1; i <= maxImages; i++) {
    imageColumns.push({
      type: positions['商品画像タイプ' + i] || null,
      path: positions['商品画像パス' + i] || null,
      alt: positions['商品画像名（ALT）' + i] || null,
    });
  }
  return imageColumns;
}

/**
 * Choiceのヘッダー・データ行から管理コード別の全カラムMapを作成する
 * @param {Array<*>} headers
 * @param {Array<Array<*>>} rows
 * @param {string=} mgmtHeader
 * @return {Object}
 * @private
 */
function buildFullChoiceMapFromValues_(headers, rows, mgmtHeader) {
  var managementHeader = mgmtHeader || CHOICE_COLUMNS.MGMT_CODE;
  var mgmtColIdx = -1;
  for (var h = 0; h < headers.length; h++) {
    if (headers[h] === managementHeader) {
      mgmtColIdx = h;
      break;
    }
  }
  if (mgmtColIdx < 0) {
    throw new Error('必須ヘッダー不足: ' + managementHeader);
  }

  var map = {};
  for (var i = 0; i < rows.length; i++) {
    var mgmtCode = String(rows[i][mgmtColIdx] === undefined ? '' : rows[i][mgmtColIdx]).trim();
    if (!mgmtCode) continue;

    var rowData = {};
    for (var c = 0; c < headers.length; c++) {
      var headerName = headers[c];
      if (headerName !== undefined && headerName !== null && String(headerName) !== '') {
        rowData[String(headerName)] = rows[i][c];
      }
    }
    map[mgmtCode] = rowData;
  }
  return map;
}

/**
 * Choiceシートから管理コード別の全カラムMapを作成する
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @return {Object}
 * @private
 */
function buildFullChoiceMap_(sheet) {
  var values = sheet.getDataRange().getValues();
  var headers = values.length > 0 ? values[0] : [];
  return buildFullChoiceMapFromValues_(headers, values.slice(1));
}

/**
 * Choiceの配送フラグから配送温度帯を生成する
 * @param {Object} choiceData
 * @return {string}
 * @private
 */
function generateDeliveryType_(choiceData) {
  var data = choiceData || {};
  var types = [];
  if (String(data['（必須）常温配送']) === '1') types.push('常温配送');
  if (String(data['（必須）冷蔵配送']) === '1') types.push('冷蔵配送');
  if (String(data['（必須）冷凍配送']) === '1') types.push('冷凍配送');
  return types.length > 0 ? types.join('、') : '-';
}

/**
 * HTMLテンプレートのChoiceプレースホルダーを置換する
 * @param {string} template
 * @param {Object} choiceData
 * @return {{html: string, warnings: string[]}}
 * @private
 */
function renderRakutenTemplate_(template, choiceData) {
  var warnings = [];
  var data = choiceData || {};
  var html = String(template === undefined || template === null ? '' : template);

  html = html.replace(/{{\s*([^}]+)\s*}}/g, function(match, phName) {
    var key = phName.trim();
    if (key === '配送温度帯') {
      var deliveryType = generateDeliveryType_(data);
      if (deliveryType === '-') warnings.push(key);
      return deliveryType;
    }

    var value = data[key];
    if (value === undefined || value === null || String(value).trim() === '') {
      warnings.push(key);
      return '-';
    }

    var result = String(value);
    if (key === '（必須）お礼の品名') {
      result = result.split(/[|｜]/)[0].trim();
    }
    return result.replace(/\r\n?|\n/g, '<br>');
  });

  return { html: html, warnings: warnings };
}

/**
 * 楽天CSVの商品行を起点に商品ブロックとSKU行を解析する
 * @param {Array<Array<*>>} productData
 * @param {Array<Array<*>>} nameData
 * @param {Array<Array<*>>} skuMgmtData
 * @param {number} targetLastRow
 * @return {Array<{startIndex: number, endIndex: number, skuIndices: number[]}>}
 * @private
 */
function parseProductBlocks_(productData, nameData, skuMgmtData, targetLastRow) {
  var blocks = [];
  var currentBlock = null;
  var prevMgmtNum = '';

  for (var i = 0; i < productData.length; i++) {
    var mgmtNum = String(productData[i][0]).trim();
    var productName = nameData && nameData[i] ? String(nameData[i][0]).trim() : '';
    var skuMgmt = String(skuMgmtData[i][0]).trim();

    // 商品レベル行の判定：
    // 1. 商品名が入力されている行
    // 2. または、商品名情報がない（nameData自体がない）場合に、商品管理番号があり、それが直前の商品管理番号とは異なり、かつSKU管理番号が空である行
    var isProductRow = false;
    if (productName) {
      isProductRow = true;
    } else if (!nameData && mgmtNum && mgmtNum !== prevMgmtNum && !skuMgmt) {
      isProductRow = true;
    }

    if (isProductRow) {
      if (currentBlock) {
        currentBlock.endIndex = i - 1;
        blocks.push(currentBlock);
      }
      currentBlock = { startIndex: i, endIndex: i, skuIndices: [] };
      prevMgmtNum = mgmtNum;
    }

    if (skuMgmt && currentBlock) currentBlock.skuIndices.push(i);
    if (currentBlock) currentBlock.endIndex = i;
  }

  if (currentBlock) blocks.push(currentBlock);
  return blocks;
}

/**
 * 画像横並びシートから商品番号別URL Mapを作成する
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss
 * @return {Object}
 * @private
 */
function buildImageUrlMap_(ss) {
  var sheet = ss.getSheetByName(SHEET_NAMES.RAKUTEN_IMAGE_GRID);
  if (!sheet || sheet.getLastRow() < 2) return {};
  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, RAKUTEN_CONFIG.IMAGE_SLOT_COUNT + 1).getValues();
  var map = {};
  for (var i = 0; i < data.length; i++) {
    var key = String(data[i][0]).trim();
    if (key) map[key] = data[i].slice(1);
  }
  return map;
}

/**
 * 画像パスシートから商品番号別パスMapを作成する
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss
 * @return {Object}
 * @private
 */
function buildImagePathMapForTemplate_(ss) {
  var sheet = ss.getSheetByName(SHEET_NAMES.RAKUTEN_IMAGE_PATHS);
  if (!sheet || sheet.getLastRow() < 2) return {};
  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, RAKUTEN_CONFIG.IMAGE_SLOT_COUNT + 1).getValues();
  var map = {};
  for (var i = 0; i < data.length; i++) {
    var key = String(data[i][0]).trim();
    if (key) map[key] = data[i].slice(1);
  }
  return map;
}

/**
 * 画像マッピングシートから管理コード別の商品番号Mapを作成する
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss
 * @return {Object}
 * @private
 */
function buildImageMappingMap_(ss) {
  var sheet = ss.getSheetByName(SHEET_NAMES.RAKUTEN_IMAGE_MAPPING);
  if (!sheet || sheet.getLastRow() < 2) return {};
  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues();
  var map = {};
  for (var i = 0; i < data.length; i++) {
    var productNum = String(data[i][0]).trim();
    var mgmtCode = String(data[i][1]).trim();
    if (mgmtCode && productNum) map[mgmtCode] = productNum;
  }
  return map;
}

/**
 * 管理コードに対応する画像商品番号を解決する
 * @param {string} mgmtCode
 * @param {Object} mappingMap
 * @return {string}
 * @private
 */
function resolveImageKey_(mgmtCode, mappingMap) {
  if (mappingMap && mappingMap[mgmtCode]) return mappingMap[mgmtCode];
  return mgmtCode;
}

function hasRakutenTemplateImagesForKey_(key, imageUrlMap, imagePathMap) {
  if (!key) return false;
  var urls = imageUrlMap && imageUrlMap[key] || [];
  var paths = imagePathMap && imagePathMap[key] || [];
  for (var i = 0; i < urls.length; i++) {
    if (String(urls[i] || '').trim()) return true;
  }
  for (var p = 0; p < paths.length; p++) {
    if (String(paths[p] || '').trim()) return true;
  }
  return false;
}

function resolveRakutenTemplateImageKey_(input) {
  var mappingMap = input && input.imageMappingMap || {};
  var imageUrlMap = input && input.imageUrlMap || {};
  var imagePathMap = input && input.imagePathMap || {};
  var candidates = [input && input.productNumber, input && input.systemSkuNumber];
  var checked = {};

  for (var i = 0; i < candidates.length; i++) {
    var sourceKey = String(candidates[i] || '').trim();
    if (!sourceKey || checked[sourceKey]) continue;
    checked[sourceKey] = true;
    var imageKey = resolveImageKey_(sourceKey, mappingMap);
    if (hasRakutenTemplateImagesForKey_(imageKey, imageUrlMap, imagePathMap)) return imageKey;
  }

  return resolveImageKey_(String(input && input.productNumber || input && input.systemSkuNumber || '').trim(), mappingMap);
}

/**
 * テンプレートに挿入する画像URLを開始位置と最大枚数で選択する
 * @param {Array<*>} urls
 * @param {number} startIndex
 * @param {number} maxCount
 * @return {Array<*>}
 * @private
 */
function selectRakutenTemplateImageUrls_(urls, startIndex, maxCount) {
  return urls.slice(startIndex, startIndex + maxCount);
}

// =========================================================================
//  ⑰ R-Cabinet 選択行をアップロード
// =========================================================================

/**
 * Drive画像一覧シートで選択された行のファイルを Cabinet API で直接アップロードする
 */
function uploadSelectedToRCabinet() {
  var ui = SpreadsheetApp.getUi();
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  var driveFilesSheet = ss.getSheetByName(SHEET_NAMES.RAKUTEN_DRIVE_FILES);
  if (!driveFilesSheet) {
    ui.alert('エラー', '「' + SHEET_NAMES.RAKUTEN_DRIVE_FILES + '」シートが見つかりません。', ui.ButtonSet.OK);
    return;
  }

  if (ss.getActiveSheet().getName() !== SHEET_NAMES.RAKUTEN_DRIVE_FILES) {
    ui.alert('エラー', '「' + SHEET_NAMES.RAKUTEN_DRIVE_FILES + '」シートを選択した状態で実行してください。', ui.ButtonSet.OK);
    return;
  }

  var activeRange = driveFilesSheet.getActiveRange();
  if (!activeRange) {
    ui.alert('エラー', 'アップロードする行を選択してください。', ui.ButtonSet.OK);
    return;
  }

  // フォルダIDの取得（設定から優先、なければユーザーに入力させる）
  var targetFolderId = getSettingValue_(SETTING_KEYS.RAKUTEN_CABINET_FOLDER_ID);
  if (!targetFolderId) {
    var folderPrompt = ui.prompt('R-Cabinet フォルダID入力', 'アップロード先のR-CabinetフォルダIDを入力してください。', ui.ButtonSet.OK_CANCEL);
    if (folderPrompt.getSelectedButton() !== ui.Button.OK) return;
    targetFolderId = folderPrompt.getResponseText().trim();
  }

  if (!targetFolderId) {
    ui.alert('エラー', 'フォルダIDが指定されていません。', ui.ButtonSet.OK);
    return;
  }

  // フォルダIDを自動解決（フォルダ名などから数値IDに変換）
  try {
    targetFolderId = resolveFolderId_(targetFolderId);
  } catch (e) {
    ui.alert('エラー', 'フォルダIDの解決に失敗しました:\n' + e.message, ui.ButtonSet.OK);
    return;
  }

  var startRow = Math.max(2, activeRange.getRow());
  var endRow = activeRange.getLastRow();

  var confirm = ui.alert(
    'R-Cabinet アップロード実行',
    '選択された行 (' + startRow + '〜' + endRow + ' 行目) の画像を\n' +
    'R-Cabinetのフォルダ ID: ' + targetFolderId + ' にアップロードします。\n\nよろしいですか？',
    ui.ButtonSet.YES_NO
  );
  if (confirm !== ui.Button.YES) return;

  var authHeader;
  try {
    authHeader = getRakutenApiAuthHeader_();
  } catch (e) {
    ui.alert('エラー', e.message, ui.ButtonSet.OK);
    return;
  }

  var successCount = 0;
  var failCount = 0;
  var uploadLogSheet = ss.getSheetByName(SHEET_NAMES.RAKUTEN_UPLOAD_LOG);

  for (var r = startRow; r <= endRow; r++) {
    var fileName = String(driveFilesSheet.getRange(r, 1).getValue()).trim();
    var fileId = String(driveFilesSheet.getRange(r, 2).getValue()).trim();

    if (!fileName || !fileId) continue;

    try {
      var file = DriveApp.getFileById(fileId);
      var blob = file.getBlob();

      // R-Cabinet APIでアップロード
      var apiResult = uploadToRCabinet_(authHeader, targetFolderId, fileName, blob);
      
      if (apiResult.status === 'SUCCESS') {
        driveFilesSheet.getRange(r, 6).setValue('アップロード完了');
        successCount++;
      } else {
        driveFilesSheet.getRange(r, 6).setValue('エラー: ' + apiResult.message);
        failCount++;
      }

      // ログ出力
      if (uploadLogSheet) {
        uploadLogSheet.appendRow([new Date(), fileName, targetFolderId, apiResult.status, apiResult.message]);
      }
    } catch (e) {
      driveFilesSheet.getRange(r, 6).setValue('例外エラー: ' + e.message);
      failCount++;
      if (uploadLogSheet) {
        uploadLogSheet.appendRow([new Date(), fileName, targetFolderId, 'ERROR', e.message]);
      }
    }

    Utilities.sleep(500); // RMS負荷軽減
  }

  var uploadSummary = '成功: ' + successCount + ' 件\n失敗: ' + failCount + ' 件';
  completeOperation_({ operation: '楽天R-Cabinetアップロード', mode: '選択行',
    status: failCount > 0 ? '完了（エラーあり）' : '完了', success: successCount, errors: failCount, detail: uploadSummary },
    (failCount > 0 ? '⚠️' : '✅') + ' 佐渡市 楽天R-Cabinetアップロード完了', uploadSummary, true);
  ui.alert('アップロード完了', uploadSummary, ui.ButtonSet.OK);
}

/**
 * 1ファイルをR-Cabinet APIにアップロードする内部実装
 * XMLマルチパートリクエストを構築
 */
function uploadToRCabinet_(authHeader, folderId, fileName, blob) {
  var url = 'https://api.rms.rakuten.co.jp/es/1.0/cabinet/file/insert';

  // 1. XMLリクエストの作成
  var xmlPayload = 
    '<?xml version="1.0" encoding="utf-8"?>\n' +
    '<request>\n' +
    '  <fileInsertRequest>\n' +
    '    <file>\n' +
    '      <fileName>' + fileName + '</fileName>\n' +
    '      <folderId>' + folderId + '</folderId>\n' +
    '    </file>\n' +
    '  </fileInsertRequest>\n' +
    '</request>';

  // 2. マルチパートボディの構築
  var boundary = '----GASBoundary_' + Utilities.getUuid();
  var headerAuth = authHeader.Authorization;

  var requestBody = [];
  
  // XMLパート
  requestBody.push('--' + boundary + '\r\n');
  requestBody.push('Content-Disposition: form-data; name="xml"\r\n');
  requestBody.push('Content-Type: text/xml; charset=utf-8\r\n\r\n');
  requestBody.push(xmlPayload + '\r\n');

  // ファイルデータパート
  requestBody.push('--' + boundary + '\r\n');
  requestBody.push('Content-Disposition: form-data; name="file"; filename="' + fileName + '"\r\n');
  requestBody.push('Content-Type: ' + blob.getContentType() + '\r\n\r\n');

  // バイナリ連結のための処理
  var bodyHeaderBlob = Utilities.newBlob(requestBody.join(''));
  var bodyFooterBlob = Utilities.newBlob('\r\n--' + boundary + '--\r\n');

  // 実際にはGASでバイナリと文字列を正しく繋ぐため、Byte配列にするかBlob配列にする
  var payloadBytes = [];
  payloadBytes = payloadBytes.concat(bodyHeaderBlob.getBytes());
  payloadBytes = payloadBytes.concat(blob.getBytes());
  payloadBytes = payloadBytes.concat(bodyFooterBlob.getBytes());

  var finalBlob = Utilities.newBlob(payloadBytes, 'multipart/form-data; boundary=' + boundary);

  var options = {
    method: 'post',
    headers: {
      'Authorization': headerAuth
    },
    payload: finalBlob,
    muteHttpExceptions: true
  };

  var response = fetchWithRetry_(url, options, 'R-Cabinetアップロード');
  var responseText = response.getContentText();

  if (response.getResponseCode() !== 200) {
    return { status: 'FAIL', message: 'API接続失敗 (' + response.getResponseCode() + '): ' + responseText };
  }

  // レスポンス解析
  try {
    var xml = XmlService.parse(responseText);
    var root = xml.getRootElement();
    var systemStatus = root.getChild('status').getChildText('systemStatus');
    var message = root.getChild('status').getChildText('message');
    
    if (systemStatus === 'OK') {
      return { status: 'SUCCESS', message: 'OK' };
    } else {
      return { status: 'FAIL', message: message };
    }
  } catch (e) {
    return { status: 'FAIL', message: 'レスポンス解析失敗: ' + e.message };
  }
}

// =========================================================================
//  Google Drive内の画像一覧を rakuten_drive_files シートにスキャン
// =========================================================================

/**
 * 集約フォルダ（統合先フォルダ）の画像をスキャンして「Driveファイル一覧」に書き出す
 */
function listDriveImages() {
  var ui = SpreadsheetApp.getUi();
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  var destFolderUrl = getSettingValue_(SETTING_KEYS.DEST_FOLDER_URL);
  if (!destFolderUrl) {
    ui.alert('エラー', 'settingシートに「' + SETTING_KEYS.DEST_FOLDER_URL + '」が設定されていません。', ui.ButtonSet.OK);
    return;
  }

  var folderId = extractFolderIdFromUrl_(destFolderUrl);
  var folder;
  try {
    folder = DriveApp.getFolderById(folderId);
  } catch (e) {
    ui.alert('エラー', '画像集約フォルダにアクセスできません。\n' + e.message, ui.ButtonSet.OK);
    return;
  }

  var confirm = ui.alert('画像スキャン', '統合フォルダ内の画像ファイルをスキャンし、一覧シートを更新します。よろしいですか？', ui.ButtonSet.OK_CANCEL);
  if (confirm !== ui.Button.OK) return;

  var sheet = ss.getSheetByName(SHEET_NAMES.RAKUTEN_DRIVE_FILES);
  if (!sheet) throw new Error('「' + SHEET_NAMES.RAKUTEN_DRIVE_FILES + '」シートが見つかりません。');

  if (sheet.getLastRow() > 1) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, 6).clearContent();
  }

  var files = folder.getFiles();
  var rows = [];

  while (files.hasNext()) {
    var file = files.next();
    var name = file.getName();
    var sizeKB = (file.getSize() / 1024).toFixed(1);
    var mime = file.getMimeType();
    
    // 画像のみを対象とする
    if (mime && mime.indexOf('image/') === 0) {
      rows.push([
        name,
        file.getId(),
        sizeKB,
        mime,
        file.getUrl(),
        '未処理'
      ]);
    }
  }

  if (rows.length > 0) {
    sheet.getRange(2, 1, rows.length, 6).setValues(rows);
  }

  ui.alert('完了', rows.length + '件の画像ファイルを検出・リスト化しました。', ui.ButtonSet.OK);
}

// =========================================================================
//  楽天 CSVダウンロード (Shift-JIS)
// =========================================================================

function downloadRakutenCsv() {
  var ui = SpreadsheetApp.getUi();
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  var rakutenSheet = ss.getSheetByName(SHEET_NAMES.RAKUTEN_CSV);
  if (!rakutenSheet) {
    ui.alert('エラー', 'シート「' + SHEET_NAMES.RAKUTEN_CSV + '」が見つかりません。', ui.ButtonSet.OK);
    return;
  }

  var data = rakutenSheet.getDataRange().getValues();
  if (data.length <= 1) {
    ui.alert('データがありません。');
    return;
  }

  var validationIssues = validateRakutenExportRows_(data, getRakutenCsvHeaders());
  var lastTemplateErrors = Number(PropertiesService.getScriptProperties().getProperty(PROP_KEYS.RAKUTEN_LAST_TEMPLATE_ERRORS)) || 0;
  if (lastTemplateErrors > 0) validationIssues.push('直近のテンプレート差込にエラーがあります: ' + lastTemplateErrors + '件');
  var lastSkuImageErrors = Number(PropertiesService.getScriptProperties().getProperty(PROP_KEYS.RAKUTEN_LAST_SKU_IMAGE_ERRORS)) || 0;
  if (lastSkuImageErrors > 0) validationIssues.push('マルチSKU画像が不足しています: ' + lastSkuImageErrors + '件');

  var confirm = ui.alert(
    'CSVダウンロード（楽天）',
    buildRakutenCsvDownloadMessage_('全行', data.length - 1, validationIssues),
    ui.ButtonSet.YES_NO
  );
  if (confirm !== ui.Button.YES) return;

  downloadCsvShiftJis_(data, 'normal-item.csv', '楽天CSV作成中...');
  recordOperationResult_({ operation: '楽天CSV', mode: '全行',
    status: validationIssues.length ? '生成完了（警告あり）' : '生成完了',
    success: data.length - 1, errors: 0, detail: validationIssues.join('\n') });
}

function downloadRakutenSelectedCsv() {
  var ui = SpreadsheetApp.getUi();
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  var rakutenSheet = ss.getSheetByName(SHEET_NAMES.RAKUTEN_CSV);
  if (!rakutenSheet) {
    ui.alert('エラー', 'シート「' + SHEET_NAMES.RAKUTEN_CSV + '」が見つかりません。', ui.ButtonSet.OK);
    return;
  }

  if (ss.getActiveSheet().getName() !== SHEET_NAMES.RAKUTEN_CSV) {
    ui.alert('エラー', '「' + SHEET_NAMES.RAKUTEN_CSV + '」シートを選択した状態で実行してください。', ui.ButtonSet.OK);
    return;
  }

  var data = rakutenSheet.getDataRange().getValues();
  if (data.length <= 1) {
    ui.alert('データがありません。');
    return;
  }

  var selection = ss.getSelection().getActiveRangeList();
  if (!selection) {
    ui.alert('エラー', '行が選択されていません。', ui.ButtonSet.OK);
    return;
  }

  var selectedSet = new Set();
  selection.getRanges().forEach(function(range) {
    for (var r = range.getRow(); r <= range.getLastRow(); r++) {
      if (r > 1) selectedSet.add(r - 1); // 0-based
    }
  });

  if (selectedSet.size === 0) {
    ui.alert('エラー', 'データ行が選択されていません。', ui.ButtonSet.OK);
    return;
  }

  var sortedIndices = Array.from(selectedSet).sort(function(a, b) { return a - b; });
  var validationIssues = validateRakutenExportRows_(data, getRakutenCsvHeaders(), sortedIndices);
  var lastTemplateErrors = Number(PropertiesService.getScriptProperties().getProperty(PROP_KEYS.RAKUTEN_LAST_TEMPLATE_ERRORS)) || 0;
  if (lastTemplateErrors > 0) validationIssues.push('直近のテンプレート差込にエラーがあります: ' + lastTemplateErrors + '件');
  var lastSkuImageErrors = Number(PropertiesService.getScriptProperties().getProperty(PROP_KEYS.RAKUTEN_LAST_SKU_IMAGE_ERRORS)) || 0;
  if (lastSkuImageErrors > 0) validationIssues.push('マルチSKU画像が不足しています: ' + lastSkuImageErrors + '件');
  var exportData = [data[0]];
  sortedIndices.forEach(function(idx) {
    if (idx < data.length) {
      exportData.push(data[idx]);
    }
  });

  var confirm = ui.alert(
    'CSVダウンロード（選択行）',
    buildRakutenCsvDownloadMessage_('選択行', exportData.length - 1, validationIssues),
    ui.ButtonSet.YES_NO
  );
  if (confirm !== ui.Button.YES) return;

  downloadCsvShiftJis_(exportData, 'normal-item.csv', '楽天CSV（選択行）作成中...');
  recordOperationResult_({ operation: '楽天CSV', mode: '選択行',
    status: validationIssues.length ? '生成完了（警告あり）' : '生成完了',
    success: exportData.length - 1, errors: 0, detail: validationIssues.join('\n') });
}

/**
 * ==============================================================================
 * ANA画像配置エンジン (DistributorANA.js)
 * 集約済み画像をANAシートとマッチングし、バッチ分割して配置およびCSVマッピングする
 * ==============================================================================
 */



// =========================================================================
//  ANA CSV ヘッダー定義
// =========================================================================

/**
 * ANA返礼品登録CSVの全ヘッダー定義（100列）
 * @return {string[]} ヘッダー配列
 */
function getAnaCsvHeaders() {
  return [
    '返礼品識別コード', '自治体コード', '自治体カテゴリコード', '事業者コード', '返礼品名',
    'バリエーショングループ', 'バリエーション順序', '同一バリエーション画像表示', 'サイズ', 'カラー',
    '状態(掲載フラグ)', '販売開始日', '販売終了日', '返礼品種別', '自治体イチ押し',
    '宅配ボックス可否', '置き配可否', '酒類フラグ', 'ランキング対象外フラグ', 'S画像ファイル',
    'S画像説明', 'Ｌ画像ファイル', 'Ｌ画像説明', 'C画像ファイル', 'C画像説明',
    '１画像ファイル', '１画像説明', '２画像ファイル', '２画像説明', '３画像ファイル',
    '３画像説明', '４画像ファイル', '４画像説明', '５画像ファイル', '５画像説明',
    'D9画像ファイル', 'D9画像説明', 'D10画像ファイル', 'D10画像説明', '返礼品コメント1',
    '返礼品コメント2', '返礼品コメント3', '返礼品コメント4', '返礼品コメント5', '返礼品コメント6',
    '返礼品コメント7', '返礼品コメント8', 'その他説明事項', 'ギフティ商品ID', 'アイコン１',
    'アイコン２', 'アイコン３', '備考(内部用)', '寄付金額', '返礼品情報',
    '内容量の詳細', '賞味期限', '原産国', '加工地', 'アレルギー表示',
    '栄養成分', '配送時期', '日持ちの目安', '特定原材料等', '地場産品類型番号',
    '地場産品に該当する理由', '定期便コメント', '配送可能温度帯', '在庫数', '在庫扱いの種別',
    '在庫少量時コメント', '在庫切れコメント', '在庫通常時コメント', 'コメントしきい値', '在庫数の表示方法',
    '購入グループ', '配送希望日指定不可フラグ', '営業日カレンダー', 'お届け開始日', '寄付明細拡張',
    '寄付明細拡張入力画面設定', '購入限定数', '購入最低数', 'かご投入時メッセージ(購入時の注意)', '掲載開始日',
    '掲載終了日', '並び順', '一覧画面有無', '詳細画面有無', 'サイズ別カート表示',
    'カラー別カート表示', 'タイトル', 'メタキーワーズ', 'メタディスクリプション', '返礼品インポート',
    '在庫インポート', '在庫アラートメール閾値', '配送不可エリア', '販売期間外の検索結果', '在庫切れ時の検索結果'
  ];
}

var ANA_OPTIONAL_EXPORT_HEADERS_ = ['C画像ファイル', 'C画像説明', 'ギフティ商品ID'];

function getAnaRequiredExportHeaders_() {
  var optional = {};
  for (var i = 0; i < ANA_OPTIONAL_EXPORT_HEADERS_.length; i++) {
    optional[ANA_OPTIONAL_EXPORT_HEADERS_[i]] = true;
  }
  return getAnaCsvHeaders().filter(function(header) {
    return optional[header] !== true;
  });
}

function normalizeAnaSalesStartDateTime_(value) {
  if (value === null || value === undefined) return null;

  var text;
  if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime())) {
    if (value.getHours() || value.getMinutes() || value.getSeconds()) return null;
    text = [
      value.getFullYear(),
      padNumber_(value.getMonth() + 1, 2),
      padNumber_(value.getDate(), 2)
    ].join('/');
  } else {
    text = String(value).trim();
  }

  if (!text) return null;

  var dateTimeMatch = text.match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})\s+(\d{1,2}):(\d{2}):(\d{2})$/);
  if (dateTimeMatch) {
    var dateTimeParts = validateAnaDateParts_(
      Number(dateTimeMatch[1]),
      Number(dateTimeMatch[2]),
      Number(dateTimeMatch[3])
    );
    if (!dateTimeParts) return null;
    var hour = Number(dateTimeMatch[4]);
    if (hour < 0 || hour > 23) return null;
    if (Number(dateTimeMatch[5]) > 59 || Number(dateTimeMatch[6]) > 59) return null;
    var normalizedDateTime = dateTimeParts.dateText + ' ' +
      padNumber_(hour, 2) + ':' + dateTimeMatch[5] + ':' + dateTimeMatch[6];
    return normalizedDateTime === text ? null : normalizedDateTime;
  }

  if (/\d{1,2}:\d{2}(?::\d{2})?/.test(text)) return null;

  var match = text.match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})$/);
  if (!match) return null;

  var dateParts = validateAnaDateParts_(
    Number(match[1]),
    Number(match[2]),
    Number(match[3])
  );
  if (!dateParts) return null;

  return dateParts.dateText + ' 00:00:00';
}

function validateAnaDateParts_(year, month, day) {
  var parsed = new Date(year, month - 1, day);
  if (
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day
  ) {
    return null;
  }

  return {
    dateText: [
      padNumber_(year, 4),
      padNumber_(month, 2),
      padNumber_(day, 2)
    ].join('/')
  };
}

function fillAnaSalesStartTime() {
  var ui = SpreadsheetApp.getUi();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAMES.ANA_CSV);
  if (!sheet) {
    ui.alert('「' + SHEET_NAMES.ANA_CSV + '」シートが見つかりません。');
    return;
  }

  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) {
    ui.alert('ana_csvシートにデータがありません。');
    return;
  }

  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var colMap = createColumnMap_(headers);
  var colSalesStart = colMap['販売開始日'];
  if (colSalesStart === undefined) {
    ui.alert('ana_csvシートに「販売開始日」列が見つかりません。');
    return;
  }

  var rowCount = lastRow - 1;
  var range = sheet.getRange(2, colSalesStart + 1, rowCount, 1);
  var values = range.getValues();
  var changed = 0;
  var skipped = 0;
  var output = values.map(function(row) {
    var normalized = normalizeAnaSalesStartDateTime_(row[0]);
    if (normalized) {
      changed++;
      return [normalized];
    }
    if (String(row[0] || '').trim()) skipped++;
    return [row[0]];
  });

  if (changed > 0) {
    range.setNumberFormat('@');
    range.setValues(output);
  }

  recordOperationResult_({
    operation: 'ANA販売開始日時刻補完',
    mode: '全行',
    status: '完了',
    success: changed,
    skipped: skipped,
    detail: '販売開始日に日付のみ入っているセルへ 00:00:00 を補完しました。'
  });

  ui.alert(
    'ANA販売開始日時刻補完',
    '完了しました。\n\n補完: ' + changed + '件\n変更なし: ' + skipped + '件',
    ui.ButtonSet.OK
  );
}

/**
 * ANA配置時のJPEGファイル名と変換要否を返す。
 * MIMEが取得できる場合はMIMEを変換判定の正とし、拡張子は出力名だけに使う。
 * @param {string} fileName - 元ファイル名
 * @param {string} mimeType - 元ファイルのMIME type
 * @return {{fileName: string, convert: boolean}}
 */
function getAnaJpegCopyPlan_(fileName, mimeType) {
  var sourceName = String(fileName || '');
  var hasJpegExtension = /\.jpe?g$/i.test(sourceName);
  var normalizedMime = String(mimeType || '').trim().toLowerCase();
  var convert = normalizedMime
    ? normalizedMime !== 'image/jpeg'
    : !hasJpegExtension;
  var outputName = hasJpegExtension && !convert
    ? sourceName
    : (/\.[^.]+$/.test(sourceName)
      ? sourceName.replace(/\.[^.]+$/, '.jpg')
      : sourceName + '.jpg');

  return {
    fileName: outputName,
    convert: convert
  };
}

/**
 * ANA標準列だけを標準順に並べたCSVデータを返す。
 * @param {Array<Array>} data - ヘッダー行を含むシートデータ
 * @return {Array<Array>}
 */
function buildAnaExportData_(data) {
  var targetHeaders = getAnaCsvHeaders();
  if (!data || data.length === 0) return [targetHeaders.slice()];

  var sourceMap = createColumnMap_(data[0]);
  var optional = {};
  for (var i = 0; i < ANA_OPTIONAL_EXPORT_HEADERS_.length; i++) {
    optional[ANA_OPTIONAL_EXPORT_HEADERS_[i]] = true;
  }
  var missing = targetHeaders.filter(function(header) {
    return sourceMap[header] === undefined && optional[header] !== true;
  });
  if (missing.length > 0) {
    throw new Error('必須ヘッダー不足: ' + missing.join(', '));
  }

  return [targetHeaders.slice()].concat(data.slice(1).map(function(row) {
    return targetHeaders.map(function(header) {
      return sourceMap[header] === undefined ? '' : row[sourceMap[header]];
    });
  }));
}

/**
 * ANA画像配置に必要な管理コード列と画像ファイル列を検証する。
 * @param {Array} headers - ana_csvのヘッダー行
 * @return {Object} ヘッダー名から列番号へのMap
 */
function validateAnaDistributionHeaders_(headers) {
  var requiredHeaders = ['備考(内部用)'];
  for (var imageNum in ANA_CONFIG.IMAGE_NUMBER_MAP) {
    requiredHeaders = requiredHeaders.concat(ANA_CONFIG.IMAGE_NUMBER_MAP[imageNum]);
  }

  var missingHeaders = findMissingHeaders_(headers, requiredHeaders);
  if (missingHeaders.length > 0) {
    throw new Error('ANA必須カラム不足: ' + missingHeaders.join(', '));
  }

  var requiredSet = {};
  for (var i = 0; i < requiredHeaders.length; i++) requiredSet[requiredHeaders[i]] = true;
  var duplicateHeaders = findDuplicateNames_(headers).filter(function(header) {
    return requiredSet[header] === true;
  });
  if (duplicateHeaders.length > 0) {
    throw new Error('ANA必須カラム重複: ' + duplicateHeaders.join(', '));
  }

  return createColumnMap_(headers);
}

/**
 * 計画に従ってANA配置先へ画像をコピーする。
 * @param {File} file - コピー元Driveファイル
 * @param {Folder} targetDir - 配置先フォルダ
 * @param {{fileName: string, convert: boolean}} plan - JPEG配置計画
 * @param {string} mimeType - コピー元ファイルのMIME type
 * @return {File} 作成されたDriveファイル
 */
function copyAnaJpegFile_(file, targetDir, plan, mimeType) {
  if (!plan.convert) {
    return file.makeCopy(plan.fileName, targetDir);
  }

  var jpegBlob = prepareAnaJpegBlob_(file, plan, mimeType);
  return targetDir.createFile(jpegBlob.setName(plan.fileName));
}

/**
 * JPEG変換済みBlobを準備する。Driveへのファイル作成は行わない。
 * @param {File} file - コピー元Driveファイル
 * @param {{fileName: string, convert: boolean}} plan - JPEG配置計画
 * @param {string} mimeType - コピー元ファイルのMIME type
 * @return {Blob|null} JPEG Blob。変換不要ならnull
 */
function prepareAnaJpegBlob_(file, plan, mimeType) {
  if (!plan.convert) return null;

  var normalizedMime = String(mimeType || '').trim().toLowerCase();
  var nativeSupportedMimeTypes = [
    'image/bmp',
    'image/gif',
    'image/jpeg',
    'image/png'
  ];
  var jpegBlob = null;

  if (nativeSupportedMimeTypes.indexOf(normalizedMime) !== -1) {
    try {
      jpegBlob = file.getBlob().getAs('image/jpeg');
    } catch (nativeError) {
      Logger.log('ANA native JPEG変換失敗: ' + plan.fileName + ' -> ' + nativeError.message);
    }
  }

  if (!jpegBlob) {
    Logger.log('ANA JPEG変換: サムネイルを使用します（解像度が変わる可能性があります）: ' + plan.fileName);
    var thumbnail = file.getThumbnail();
    if (!thumbnail) {
      var thumbnailError = 'JPEG変換用のサムネイルを取得できません: ' + plan.fileName;
      Logger.log('ANA JPEG変換エラー: ' + thumbnailError);
      throw new Error(thumbnailError);
    }

    var thumbnailMime = String(thumbnail.getContentType() || '').trim().toLowerCase();
    jpegBlob = thumbnailMime === 'image/jpeg'
      ? thumbnail
      : thumbnail.getAs('image/jpeg');
  }

  return jpegBlob;
}

/**
 * 配置先を作らずにJPEG変換可否を検証する。
 * @return {{success: boolean, error: string}}
 */
function validateAnaJpegCopyPlan_(file, plan, mimeType) {
  if (!plan.convert) return { success: true, error: '' };

  var normalizedMime = String(mimeType || '').trim().toLowerCase();
  if (['image/bmp', 'image/gif', 'image/jpeg', 'image/png'].indexOf(normalizedMime) !== -1) {
    return { success: true, error: '' };
  }

  try {
    if (!file.getThumbnail()) {
      throw new Error('JPEG変換用のサムネイルを取得できません: ' + plan.fileName);
    }
    return { success: true, error: '' };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * 同名既存ファイルを検査し、不正な非JPEG重複をゴミ箱へ移す。
 * @return {boolean} 有効なJPEGが1件以上存在するか
 */
function cleanAnaExistingJpegDuplicates_(existingFiles) {
  var invalidFiles = [];
  var hasValidJpeg = false;

  while (existingFiles.hasNext()) {
    var existingFile = existingFiles.next();
    var existingMime = String(existingFile.getMimeType() || '').trim().toLowerCase();
    if (existingMime === 'image/jpeg') {
      hasValidJpeg = true;
    } else {
      invalidFiles.push(existingFile);
    }
  }

  for (var i = 0; i < invalidFiles.length; i++) {
    invalidFiles[i].setTrashed(true);
  }
  return hasValidJpeg;
}

/**
 * ANAの1配置先へ画像を配置し、結果を集計する。
 * @param {{file: File, name: string}} fileInfo - コピー元ファイル情報
 * @param {Folder} targetDir - 配置先フォルダ
 * @param {Object} stats - コピー統計
 * @param {string[]} batchErrors - バッチエラー一覧
 * @param {string} mgmtCode - 管理コード
 * @param {string} subName - ANAサブフォルダ名
 * @return {{status: string, fileName: string}} 配置結果と計画ファイル名
 */
function placeAnaImageTarget_(fileInfo, targetDir, stats, batchErrors, mgmtCode, subName) {
  var destinationName = fileInfo && fileInfo.name ? String(fileInfo.name) : '(ファイル名不明)';

  try {
    var mimeType = fileInfo.file.getMimeType();
    var plan = getAnaJpegCopyPlan_(fileInfo.name, mimeType);
    destinationName = plan.fileName;
    var existing = targetDir.getFilesByName(plan.fileName);
    if (cleanAnaExistingJpegDuplicates_(existing)) {
      stats.skippedFiles++;
      return { status: 'skipped', fileName: plan.fileName };
    }

    copyAnaJpegFile_(fileInfo.file, targetDir, plan, mimeType);
    stats.copiedFiles++;
    return { status: 'copied', fileName: plan.fileName };
  } catch (e) {
    stats.errorFiles++;
    var errorText = mgmtCode + '/' + destinationName + ' -> ' + subName + ': ' + e.message;
    batchErrors.push(errorText);
    Logger.log('ANAコピーエラー: ' + destinationName + ' -> ' + e.message);
    return { status: 'error', fileName: destinationName };
  }
}

function placeAnaImageInFolder_(fileInfo, targetDir, stats, batchErrors, mgmtCode, subName) {
  return placeAnaImageTarget_(
    fileInfo,
    targetDir,
    stats,
    batchErrors,
    mgmtCode,
    subName
  ).status;
}

/**
 * 画像番号に必要な全配置先の成否を集約する。
 * @param {string[]} requiredTargets - 必須配置先
 * @param {Object} targetOutcomes - 配置先ごとのcopied/skipped/error
 * @return {{complete: boolean, success: boolean, failed: boolean}}
 */
function summarizeAnaImagePlacement_(requiredTargets, targetOutcomes) {
  var complete = true;
  var failed = false;

  for (var i = 0; i < requiredTargets.length; i++) {
    var status = targetOutcomes[requiredTargets[i]];
    if (status !== 'copied' && status !== 'skipped' && status !== 'error') {
      complete = false;
    }
    if (status === 'error') failed = true;
  }

  return {
    complete: complete,
    success: complete && !failed,
    failed: failed,
  };
}

/**
 * 行・画像番号・配置先単位の結果を記録する。再試行結果は同じ配置先を上書きする。
 */
function recordAnaTargetPlacement_(outcomes, rowIndex, imageNum, requiredTargets, target, result) {
  var rowKey = String(rowIndex);
  var imageKey = String(imageNum);
  if (!outcomes[rowKey]) outcomes[rowKey] = {};
  if (!outcomes[rowKey][imageKey]) {
    outcomes[rowKey][imageKey] = {
      requiredTargets: requiredTargets.slice(),
      targetOutcomes: {},
      fileName: '',
    };
  }

  var imageOutcome = outcomes[rowKey][imageKey];
  imageOutcome.targetOutcomes[target] = result.status;
  if (result.fileName) imageOutcome.fileName = result.fileName;
}

/**
 * 配置結果から、画像列と出力バッチ列へ反映する行単位の判断を作る。
 */
function buildAnaPlacementDecisions_(matchResults, batches, outcomes) {
  var batchNamesByRow = {};
  for (var b = 0; b < batches.length; b++) {
    var batchName = 'upload_ana_' + padNumber_(b + 1, 3);
    for (var bi = 0; bi < batches[b].items.length; bi++) {
      batchNamesByRow[String(batches[b].items[bi].rowIndex)] = batchName;
    }
  }

  var decisions = [];
  for (var i = 0; i < matchResults.length; i++) {
    var matchItem = matchResults[i];
    var rowKey = String(matchItem.rowIndex);
    var rowOutcomes = outcomes[rowKey] || {};
    var images = {};
    var allSucceeded = matchItem.files.length > 0;
    var anyFailed = false;

    // 現在の実ファイルに存在しない画像番号も空欄として決定表へ載せる。
    for (var configuredNum in ANA_CONFIG.IMAGE_NUMBER_MAP) {
      images[configuredNum] = { success: false, fileName: '' };
    }

    for (var f = 0; f < matchItem.files.length; f++) {
      var imageNum = String(matchItem.files[f].imageNum);
      var requiredTargets = ANA_CONFIG.IMAGE_SUBFOLDER_MAP[imageNum] || [];
      var imageOutcome = rowOutcomes[imageNum] || {
        targetOutcomes: {},
        fileName: '',
      };
      var summary = summarizeAnaImagePlacement_(requiredTargets, imageOutcome.targetOutcomes);
      var imageSucceeded = summary.success && Boolean(imageOutcome.fileName);

      images[imageNum] = {
        success: imageSucceeded,
        fileName: imageSucceeded ? imageOutcome.fileName : '',
      };
      if (!imageSucceeded) allSucceeded = false;
      if (summary.failed) anyFailed = true;
    }

    decisions.push({
      rowIndex: matchItem.rowIndex,
      batchValue: allSucceeded ? batchNamesByRow[rowKey] : (anyFailed ? 'エラー' : ''),
      images: images,
    });
  }

  return decisions;
}

/**
 * 配置判断を画像列・出力バッチ列へ列単位で書き戻す。
 * @param {boolean} resetBatchMarkings - trueなら未対象行を「未マッチ」に初期化する
 */
function writeAnaPlacementDecisions_(sheet, data, headers, decisions, resetBatchMarkings) {
  var currentHeaders = headers;
  if (typeof sheet.getLastColumn === 'function' && sheet.getLastColumn() > 0) {
    currentHeaders = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  }
  var colMap = createColumnMap_(currentHeaders);
  var imageColumns = {};
  for (var configuredNum in ANA_CONFIG.IMAGE_NUMBER_MAP) {
    var configuredColumns = ANA_CONFIG.IMAGE_NUMBER_MAP[configuredNum];
    for (var configuredCol = 0; configuredCol < configuredColumns.length; configuredCol++) {
      if (colMap[configuredColumns[configuredCol]] !== undefined) {
        imageColumns[configuredColumns[configuredCol]] = configuredNum;
      }
    }
  }

  var batchIndex = currentHeaders.indexOf('出力バッチ');
  var batchColumn = batchIndex >= 0 ? batchIndex + 1 : currentHeaders.length + 1;

  if (resetBatchMarkings) {
    for (var resetColumnName in imageColumns) {
      var resetValues = Array.from({ length: data.length - 1 }, function() { return ['']; });
      sheet.getRange(2, colMap[resetColumnName] + 1, resetValues.length, 1).setValues(resetValues);
    }
    var resetBatchValues = data.map(function(_, rowIndex) {
      return [rowIndex === 0 ? '出力バッチ' : '未マッチ'];
    });
    for (var rd = 0; rd < decisions.length; rd++) {
      resetBatchValues[decisions[rd].rowIndex] = [decisions[rd].batchValue];
    }
    sheet.getRange(1, batchColumn, resetBatchValues.length, 1).setValues(resetBatchValues);
  } else {
    var sortedDecisions = decisions.slice().sort(function(a, b) { return a.rowIndex - b.rowIndex; });
    var groups = [];
    for (var d = 0; d < sortedDecisions.length; d++) {
      var lastGroup = groups.length > 0 ? groups[groups.length - 1] : null;
      if (!lastGroup || sortedDecisions[d].rowIndex !== lastGroup[lastGroup.length - 1].rowIndex + 1) {
        lastGroup = [];
        groups.push(lastGroup);
      }
      lastGroup.push(sortedDecisions[d]);
    }

    for (var g = 0; g < groups.length; g++) {
      var group = groups[g];
      var sheetStartRow = group[0].rowIndex + 1;
      for (var columnName in imageColumns) {
        var imageNum = imageColumns[columnName];
        var imageValues = group.map(function(decision) {
          return [decision.images[imageNum] ? decision.images[imageNum].fileName : ''];
        });
        sheet.getRange(sheetStartRow, colMap[columnName] + 1, group.length, 1).setValues(imageValues);
      }
      sheet.getRange(sheetStartRow, batchColumn, group.length, 1).setValues(
        group.map(function(decision) { return [decision.batchValue]; })
      );
    }
  }

  sheet.getRange(1, batchColumn)
    .setBackground('#424242')
    .setFontColor('#FFFFFF')
    .setFontWeight('bold');
  sheet.autoResizeColumn(batchColumn);
}

function getAnaCompletionStatus_(errorFiles) {
  return errorFiles > 0 ? '⚠️ 完了（エラーあり）' : '✅ 完了';
}

function resolveAnaRunProgress_(props, isResume) {
  if (!isResume) return { startBatchIdx: 0, savedProgress: null };
  var savedStr = props.getProperty(PROP_KEYS.ANA_PROGRESS);
  var savedProgress = savedStr ? JSON.parse(savedStr) : null;
  return {
    startBatchIdx: savedProgress ? (savedProgress.batchIndex || 0) : 0,
    savedProgress: savedProgress,
  };
}

function shouldInitializeAnaDashboard_(isDryRun, savedProgress) {
  return isDryRun || !savedProgress;
}

function buildAnaSourceIndex_(fileMap) {
  var sourceIndex = {};
  for (var key in fileMap) {
    var fileInfo = fileMap[key];
    var parsed = parseAnaImageFilename_(fileInfo.name);
    if (!parsed || !ANA_CONFIG.IMAGE_NUMBER_MAP[parsed.number]) continue;
    var mgmtCodeLower = parsed.key.toLowerCase();
    if (!sourceIndex[mgmtCodeLower]) sourceIndex[mgmtCodeLower] = {};
    sourceIndex[mgmtCodeLower][parsed.number] = fileInfo;
  }
  return sourceIndex;
}

function hasPendingAnaWork_(props) {
  var pendingKeys = [
    PROP_KEYS.ANA_QUEUE_CONFIG,
    PROP_KEYS.ANA_PROGRESS,
    PROP_KEYS.ANA_CONFIG,
  ];
  for (var i = 0; i < pendingKeys.length; i++) {
    if (props.getProperty(pendingKeys[i])) return true;
  }

  var triggers = ScriptApp.getProjectTriggers();
  for (var t = 0; t < triggers.length; t++) {
    var handler = triggers[t].getHandlerFunction();
    if (handler === 'runQueuedAnaDistribute' || handler === 'resumeAnaDistribute') return true;
  }
  return false;
}

function runWithAnaPublicGuard_(operation) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(3000)) {
    throw new Error('他のANA処理が実行中です。完了後に再実行してください。');
  }

  try {
    var props = PropertiesService.getScriptProperties();
    if (hasPendingAnaWork_(props)) {
      throw new Error('ANA画像配置が予約または再開待ちです。完了後に再実行してください。');
    }
    return operation();
  } finally {
    lock.releaseLock();
  }
}

// =========================================================================
//  画像ファイル名転記 (Drive -> ana_csv)
// =========================================================================

/**
 * Drive画像マップをANA画像列へ一括転記する。
 * @return {Object} 転記統計
 */
function syncAnaImageFilenamesToSheet_(anaSheet, fileMap) {
  var lastRow = anaSheet.getLastRow();
  var rowCount = Math.max(lastRow - 1, 0);
  var headers = anaSheet.getRange(1, 1, 1, anaSheet.getLastColumn()).getValues()[0];
  var colMap = createColumnMap_(headers);
  var colBiko = colMap['備考(内部用)'];
  if (colBiko === undefined) throw new Error('ana_csvシートに「備考(内部用)」列が見つかりません。');
  validateAnaDistributionHeaders_(headers);

  var imageMap = {};
  var totalFiles = 0;
  var convertedCount = 0;
  var conversionErrors = [];

  for (var nameLower in fileMap) {
    var fileInfo = fileMap[nameLower];
    totalFiles++;
    var parsed = parseAnaImageFilename_(fileInfo.name);
    if (!parsed || !ANA_CONFIG.IMAGE_NUMBER_MAP[parsed.number]) continue;

    var keyLower = parsed.key.toLowerCase();
    if (!imageMap[keyLower]) imageMap[keyLower] = {};
    try {
      var mimeType = fileInfo.file.getMimeType();
      var copyPlan = getAnaJpegCopyPlan_(fileInfo.name, mimeType);
      var validation = validateAnaJpegCopyPlan_(fileInfo.file, copyPlan, mimeType);
      if (copyPlan.convert) convertedCount++;
      imageMap[keyLower][parsed.number] = {
        fileName: validation.success ? copyPlan.fileName : '',
      };
      if (!validation.success) conversionErrors.push(fileInfo.name + ': ' + validation.error);
    } catch (e) {
      imageMap[keyLower][parsed.number] = { fileName: '' };
      conversionErrors.push(fileInfo.name + ': ' + e.message);
    }
  }

  var imageColumns = {};
  for (var configuredNum in ANA_CONFIG.IMAGE_NUMBER_MAP) {
    var configuredColumns = ANA_CONFIG.IMAGE_NUMBER_MAP[configuredNum];
    for (var cc = 0; cc < configuredColumns.length; cc++) {
      var configuredName = configuredColumns[cc];
      if (colMap[configuredName] !== undefined) {
        imageColumns[configuredName] = {
          column: colMap[configuredName] + 1,
          values: Array.from({ length: rowCount }, function() { return ['']; }),
          backgrounds: Array.from({ length: rowCount }, function() { return [null]; }),
        };
      }
    }
  }

  var bikoData = rowCount > 0
    ? anaSheet.getRange(2, colBiko + 1, rowCount, 1).getValues()
    : [];
  var updated = 0;
  var unmatched = 0;
  var noMainImage = 0;
  var totalImages = 0;
  var COLOR_HIGHLIGHT = '#FFFF00';

  for (var row = 0; row < bikoData.length; row++) {
    var biko = String(bikoData[row][0] || '').trim();
    if (!biko) continue;
    var images = imageMap[biko.toLowerCase()];
    if (!images) {
      unmatched++;
      if (imageColumns['S画像ファイル']) {
        imageColumns['S画像ファイル'].backgrounds[row] = [COLOR_HIGHLIGHT];
      }
      continue;
    }

    updated++;
    if (!images['1'] || !images['1'].fileName) {
      noMainImage++;
      if (imageColumns['S画像ファイル']) {
        imageColumns['S画像ファイル'].backgrounds[row] = [COLOR_HIGHLIGHT];
      }
    }

    for (var imageNum in images) {
      var targetColumns = ANA_CONFIG.IMAGE_NUMBER_MAP[imageNum] || [];
      for (var tc = 0; tc < targetColumns.length; tc++) {
        var targetColumn = imageColumns[targetColumns[tc]];
        if (!targetColumn) continue;
        targetColumn.values[row] = [images[imageNum].fileName];
        if (images[imageNum].fileName) {
          totalImages++;
        } else {
          targetColumn.backgrounds[row] = [COLOR_HIGHLIGHT];
        }
      }
    }
  }

  for (var columnName in imageColumns) {
    var output = imageColumns[columnName];
    if (rowCount > 0) {
      var range = anaSheet.getRange(2, output.column, rowCount, 1);
      range.setValues(output.values);
      range.setBackground(null);
      range.setBackgrounds(output.backgrounds);
    }
  }

  return {
    updated: updated,
    unmatched: unmatched,
    noMainImage: noMainImage,
    totalImages: totalImages,
    totalFiles: totalFiles,
    convertedCount: convertedCount,
    conversionErrors: conversionErrors,
  };
}

/**
 * 統合フォルダ内の画像ファイル名をana_csvシートの対応画像列に自動マッピング・転記する
 */
function syncAnaImageFilenames() {
  var ui = SpreadsheetApp.getUi();
  var confirm = ui.alert(
    '画像ファイル名転記（ANA）',
    '統合フォルダ内の画像ファイル名を集約し、\n' +
    'ana_csvシートの画像列へマッピング転記します。\n\n' +
    'マッチング: ファイル名の「{管理コード}_」 ⇔ ANA「備考(内部用)」\n' +
    '_1 → S画像+Ｌ画像, _2 → 1画像, ... _8 → D10画像\n\n' +
    '実行しますか？',
    ui.ButtonSet.YES_NO
  );
  if (confirm !== ui.Button.YES) return;

  var completion;
  try {
    completion = runWithAnaPublicGuard_(function() {
      return _syncAnaImageFilenamesLocked_();
    });
  } catch (e) {
    ui.alert('エラー', e.message, ui.ButtonSet.OK);
    return;
  }
  ui.alert(completion.title, completion.message, ui.ButtonSet.OK);
}

function _syncAnaImageFilenamesLocked_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  // 集約先（統合先）フォルダURL取得
  var destFolderUrl = getSettingValue_(SETTING_KEYS.DEST_FOLDER_URL);
  if (!destFolderUrl) {
    throw new Error('settingシートに「' + SETTING_KEYS.DEST_FOLDER_URL + '」が設定されていません。');
  }

  var folderId = extractFolderIdFromUrl_(destFolderUrl);
  var folder;
  try {
    folder = DriveApp.getFolderById(folderId);
  } catch (e) {
    throw new Error('集約先（統合先）フォルダにアクセスできません。\n' + e.message);
  }

  var anaSheet = ss.getSheetByName(SHEET_NAMES.ANA_CSV);
  if (!anaSheet) {
    throw new Error('「' + SHEET_NAMES.ANA_CSV + '」シートが見つかりません。初期設定を実行してください。');
  }

  var lastRow = anaSheet.getLastRow();
  if (lastRow <= 1) {
    throw new Error('ana_csvシートにデータがありません。');
  }

  // 1. 統合フォルダ内のファイルマップ構築・一括転記
  var fileMap = buildFileMapFromFolder_(folder);
  var syncResult = syncAnaImageFilenamesToSheet_(anaSheet, fileMap);

  SpreadsheetApp.flush();

  // 結果表示
  var syncHeading = syncResult.conversionErrors.length > 0
    ? 'ANA画像ファイル名転記完了（変換エラーあり）'
    : 'ANA画像ファイル名転記完了！';
  var message = [
    syncHeading + '\n',
    '✅ 更新返礼品: ' + syncResult.updated + ' 件',
    '✅ 転記画像数: ' + syncResult.totalImages + ' 枚',
    '⚠️ 画像なし（黄色セル）: ' + syncResult.unmatched + ' 件',
  ];
  if (syncResult.noMainImage > 0) {
    message.push('⚠️ メイン画像(_1)なし（黄色セル）: ' + syncResult.noMainImage + ' 件');
  }
  message.push(
    '📊 ANAシート対象行: ' + (lastRow - 1) + ' 件',
    '📊 Driveファイル数: ' + syncResult.totalFiles + ' 件'
  );
  if (syncResult.convertedCount > 0) {
    message.push('\n📊 JPEG変換検証対象: ' + syncResult.convertedCount + ' 件');
  }
  if (syncResult.conversionErrors.length > 0) {
    message.push(
      '⚠️ JPEG変換不可（画像列を空欄にしました）: ' + syncResult.conversionErrors.length + ' 件',
      syncResult.conversionErrors.join('\n')
    );
  }

  return {
    title: syncResult.conversionErrors.length > 0 ? '実行結果（エラーあり）' : '実行結果',
    message: message.join('\n'),
  };
}

// =========================================================================
//  画像配置実行 (タイムアウト自動再開対応)
// =========================================================================

/**
 * ANA画像配置（フォルダ切り分け）を予約・実行する
 * @param {string} dialogConfig - ダイアログから渡された設定(JSON文字列)
 */
function startAnaDistribute(dialogConfig) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(3000)) {
    throw new Error('他の処理が実行中です。完了後に再実行してください。');
  }

  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var props = PropertiesService.getScriptProperties();
    if (hasPendingAnaWork_(props)) {
      throw new Error('ANA画像配置が予約または再開待ちです。完了後に再実行するか、進捗リセットを実行してください。');
    }
    props.setProperty(PROP_KEYS.ANA_QUEUE_CONFIG, dialogConfig);
    ScriptApp.newTrigger('runQueuedAnaDistribute').timeBased().after(1000).create();
    ss.toast(
      'ANA画像配置を予約しました。まもなく開始します。進捗はana_dashboardシートで確認してください。',
      '📦 ANA配置',
      10
    );
  } finally {
    lock.releaseLock();
  }
}

/**
 * 予約されたANA画像配置を実行する（トリガーから）
 */
function runQueuedAnaDistribute() {
  deleteTriggersByFunction_('runQueuedAnaDistribute');

  var props = PropertiesService.getScriptProperties();
  var configStr = props.getProperty(PROP_KEYS.ANA_QUEUE_CONFIG);
  props.deleteProperty(PROP_KEYS.ANA_QUEUE_CONFIG);
  if (!configStr) return;

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(3000)) {
    props.setProperty(PROP_KEYS.ANA_QUEUE_CONFIG, configStr);
    ScriptApp.newTrigger('runQueuedAnaDistribute').timeBased().after(EXEC_CONFIG.RESUME_DELAY_MS).create();
    return;
  }

  try {
    var config = JSON.parse(configStr);
    _runAnaDistribute(config, true, false);
  } catch (e) {
    updateAnaDashboardStatus_('❌ 異常終了');
    completeOperation_({ operation: 'ANA画像配置', mode: '本実行', status: '異常終了', errors: 1, detail: e.message },
      '❌ 佐渡市 ANA画像配置 異常終了', 'ANA画像配置が異常終了しました。\n\n' + e.message, true);
    throw e;
  } finally {
    lock.releaseLock();
  }
}

/**
 * ANA配置のドライラン
 */
function startAnaDryRun(dialogConfig) {
  var ui = SpreadsheetApp.getUi();
  var completion;
  try {
    completion = runWithAnaPublicGuard_(function() {
      var config = JSON.parse(dialogConfig);
      config.isDryRun = true;
      return _runAnaDistribute(config, true, false);
    });
  } catch (e) {
    ui.alert('エラー', e.message, ui.ButtonSet.OK);
    return;
  }
  if (completion) ui.alert(completion.title, completion.message, ui.ButtonSet.OK);
}

/**
 * ANA画像配置 内部実装
 * @param {Object} config - 設定
 * @param {boolean} suppressUi - UIを制御するか
 * @param {boolean} isResume - 保存済み進捗からの再開か
 */
function _runAnaDistribute(config, suppressUi, isResume) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ui = suppressUi ? null : SpreadsheetApp.getUi();
  var startTime = Date.now();
  var isDryRun = config.isDryRun || false;

  // 1. 設定情報の取得
  var anaDestFolderUrl = getSettingValue_(SETTING_KEYS.ANA_DEST_FOLDER_URL);
  var destFolderUrl = getSettingValue_(SETTING_KEYS.DEST_FOLDER_URL);
  var targetFolderUrl = anaDestFolderUrl || destFolderUrl;

  if (!targetFolderUrl) {
    var settingError = 'settingシートに「' + SETTING_KEYS.DEST_FOLDER_URL + '」または「' + SETTING_KEYS.ANA_DEST_FOLDER_URL + '」が設定されていません。';
    notifyMessage_(ui, ss, 'エラー', settingError);
    return { title: 'エラー', message: settingError };
  }

  // 2. CSVシートと必須ヘッダーを、Driveアクセスより先に検証する
  var anaSheet = ss.getSheetByName(SHEET_NAMES.ANA_CSV);
  if (!anaSheet) {
    var sheetError = '「' + SHEET_NAMES.ANA_CSV + '」シートが見つかりません。';
    notifyMessage_(ui, ss, 'エラー', sheetError);
    return { title: 'エラー', message: sheetError };
  }

  var anaData = anaSheet.getDataRange().getValues();
  if (anaData.length < 2) {
    var dataError = 'ana_csvシートにデータがありません。';
    notifyMessage_(ui, ss, 'エラー', dataError);
    return { title: 'エラー', message: dataError };
  }

  var headers = anaData[0];
  var colMap;
  try {
    colMap = validateAnaDistributionHeaders_(headers);
  } catch (e) {
    notifyMessage_(ui, ss, 'エラー', e.message);
    return { title: 'エラー', message: e.message };
  }
  var colBiko = colMap['備考(内部用)'];

  var anaDestFolder;
  try {
    anaDestFolder = DriveApp.getFolderById(extractFolderIdFromUrl_(targetFolderUrl));
  } catch (e) {
    var targetFolderError = '出力先フォルダにアクセスできません。\n' + e.message;
    notifyMessage_(ui, ss, 'エラー', targetFolderError);
    return { title: 'エラー', message: targetFolderError };
  }

  var srcFolder;
  try {
    srcFolder = DriveApp.getFolderById(extractFolderIdFromUrl_(destFolderUrl));
  } catch (e) {
    var sourceFolderError = '画像集約フォルダにアクセスできません。\n' + e.message;
    notifyMessage_(ui, ss, 'エラー', sourceFolderError);
    return { title: 'エラー', message: sourceFolderError };
  }

  // バッチ容量設定
  var batchSizeSetting = getSettingValue_(SETTING_KEYS.ANA_BATCH_SIZE_MB);
  var batchSizeMB = Number(batchSizeSetting) || ANA_CONFIG.DEFAULT_BATCH_SIZE_MB;

  // 3. 統合フォルダ内の画像ファイルをスキャン
  var fileMap = buildFileMapFromFolder_(srcFolder);
  var sourceIndex = buildAnaSourceIndex_(fileMap);

  // 4. マッチング
  var matchResults = [];
  var unmatchedCodes = [];
  var totalMatchedFiles = 0;

  for (var row = 1; row < anaData.length; row++) {
    var mgmtCode = String(anaData[row][colBiko]).trim();
    if (!mgmtCode) continue;

    var mgmtCodeLower = mgmtCode.toLowerCase();
    var matchedFiles = [];

    // 管理コード完全一致のインデックスから _1〜_8 を取得
    var indexedImages = sourceIndex[mgmtCodeLower] || {};
    for (var n = 1; n <= 8; n++) {
      var foundFile = indexedImages[String(n)] || null;

      if (foundFile) {
        matchedFiles.push({
          fileInfo: foundFile,
          imageNum: n,
        });
      }
    }

    if (matchedFiles.length > 0) {
      matchResults.push({
        rowIndex: row,
        mgmtCode: mgmtCode,
        files: matchedFiles,
        tsvRowData: anaData[row],
      });
      totalMatchedFiles += matchedFiles.length;
    } else {
      unmatchedCodes.push(mgmtCode);
    }
  }

  // 5. バッチ分割 (ANA用の容量計算: _1 は S/L に二重コピーするため2倍カウント)
  var batches = _splitIntoAnaBatches(matchResults, batchSizeMB);
  var plannedTargetCount = getAnaPlannedTargetCount_(batches);
  var props = isDryRun ? null : PropertiesService.getScriptProperties();
  var runProgress = isDryRun
    ? { startBatchIdx: 0, savedProgress: null }
    : resolveAnaRunProgress_(props, Boolean(isResume));
  var startBatchIdx = runProgress.startBatchIdx;
  var savedProgress = runProgress.savedProgress;
  if (savedProgress) {
    Logger.log('ANA: 前回の続きから再開: バッチ ' + (startBatchIdx + 1));
  }

  // 6. fresh実行だけダッシュボードを初期化する。再開時は既存詳細行を保持する。
  if (shouldInitializeAnaDashboard_(isDryRun, savedProgress)) {
    initAnaDashboard_(
      anaData.length - 1,
      matchResults.length,
      unmatchedCodes.length,
      batches.length,
      plannedTargetCount
    );
  }

  if (isDryRun) {
    _writeAnaDryRunResults(ss, matchResults, unmatchedCodes, batches);
    _writeBackAnaBatchMarkings(anaSheet, anaData, headers, colBiko, batches);
    updateAnaDashboardStatus_('📋 ドライラン完了');

    var dryRunSummary = 'ドライラン完了（ANA）\n\n' +
      '📊 CSVデータ行: ' + (anaData.length - 1) + '\n' +
      '✅ マッチ: ' + matchResults.length + '品 (' + totalMatchedFiles + '枚)\n' +
      '❌ 未マッチ: ' + unmatchedCodes.length + '品\n' +
      '📦 バッチ数: ' + batches.length + '\n\n' +
      buildBatchSummaryText_(batches);

    notifyMessage_(ui, ss, 'ドライラン完了', dryRunSummary);
    return { title: 'ドライラン完了', message: dryRunSummary };
  }

  // 7. 本実行: 画像コピー & サブフォルダ分け
  var stats = {
    startTime: startTime,
    totalBatches: batches.length,
    processedBatches: savedProgress ? (savedProgress.processedBatches || 0) : 0,
    copiedFiles: savedProgress ? (savedProgress.copiedFiles || 0) : 0,
    errorFiles: savedProgress ? (savedProgress.errorFiles || 0) : 0,
    skippedFiles: savedProgress ? (savedProgress.skippedFiles || 0) : 0,
  };
  var placementOutcomes = {};

  // 本実行ではドライランや前回実行の予定値をアップロード可として残さない。
  if (!savedProgress) {
    var initialDecisions = buildAnaPlacementDecisions_(matchResults, batches, placementOutcomes);
    writeAnaPlacementDecisions_(anaSheet, anaData, headers, initialDecisions, true);
  }

  updateAnaDashboardStatus_('処理中');

  // バッチコピー処理ループ
  for (var b = startBatchIdx; b < batches.length; b++) {
    if (pauseAnaBeforeBatchIfNeeded_(
      startTime,
      Date.now(),
      b,
      stats,
      config,
      props,
      ss
    )) {
      return;
    }

    var batch = batches[b];
    var batchNum = b + 1;
    var batchFolderName = 'upload_ana_' + padNumber_(batchNum, 3);

    // バッチフォルダ作成
    var batchFolder = getOrCreateFolder_(anaDestFolder, batchFolderName);
    var imgFolder = getOrCreateFolder_(batchFolder, 'img');
    var goodsFolder = getOrCreateFolder_(imgFolder, 'goods');

    // サブフォルダ群 (S, L, 1, 2, 3, 4, 5, D9, D10) の初期化
    var subFolders = {};
    var subNames = ['S', 'L', '1', '2', '3', '4', '5', 'D9', 'D10'];
    subNames.forEach(function(name) {
      subFolders[name] = getOrCreateFolder_(goodsFolder, name);
    });

    var batchErrors = [];

    // コピーループ
    for (var item = 0; item < batch.items.length; item++) {
      var matchItem = batch.items[item];

      for (var f = 0; f < matchItem.files.length; f++) {
        var fileInfoObj = matchItem.files[f].fileInfo;
        var imgNum = String(matchItem.files[f].imageNum);
        var targetSubfolderNames = ANA_CONFIG.IMAGE_SUBFOLDER_MAP[imgNum];

        if (!targetSubfolderNames) continue;

        for (var targetIndex = 0; targetIndex < targetSubfolderNames.length; targetIndex++) {
          var subName = targetSubfolderNames[targetIndex];

          var targetDir = subFolders[subName];
          var placementResult;
          if (!targetDir) {
            stats.errorFiles++;
            var missingTargetError = matchItem.mgmtCode + '/' + fileInfoObj.name +
              ' -> ' + subName + ': 配置先フォルダが見つかりません';
            batchErrors.push(missingTargetError);
            placementResult = { status: 'error', fileName: fileInfoObj.name };
          } else {
            placementResult = placeAnaImageTarget_(
              fileInfoObj,
              targetDir,
              stats,
              batchErrors,
              matchItem.mgmtCode,
              subName
            );
          }
          recordAnaTargetPlacement_(
            placementOutcomes,
            matchItem.rowIndex,
            imgNum,
            targetSubfolderNames,
            subName,
            placementResult
          );
        }
      }
    }

    var batchDecisions = buildAnaPlacementDecisions_(batch.items, batches, placementOutcomes);
    writeAnaPlacementDecisions_(anaSheet, anaData, headers, batchDecisions, false);

    // ダッシュボード行追加
    addAnaDashboardRow_(
      batchNum,
      batch.items.length,
      batch.totalFiles,
      formatBytes_(batch.totalSize),
      batchErrors.length > 0 ? '⚠️ ' + batchErrors.length + '件エラー' : '✅ 完了',
      batchErrors.join('; ')
    );

    stats.processedBatches++;
    commitAnaCompletedBatchCheckpoint_(props, b + 1, stats);

    if (stats.processedBatches % 3 === 0) {
      _updateAnaStats(stats);
      ss.toast('ANA処理中: バッチ ' + batchNum + '/' + batches.length, '📦', 3);
    }

    if (b + 1 < batches.length && Date.now() - startTime > EXEC_CONFIG.TIME_LIMIT_MS) {
      props.setProperty(PROP_KEYS.ANA_CONFIG, JSON.stringify(config));
      deleteTriggersByFunction_('resumeAnaDistribute');
      ScriptApp.newTrigger('resumeAnaDistribute').timeBased().after(EXEC_CONFIG.RESUME_DELAY_MS).create();
      updateAnaDashboardStatus_('⏸️ 中断(再開待ち)');
      _updateAnaStats(stats);
      ss.toast('時間制限のため中断。1分後に自動再開します。', '⏸️ 中断', 10);
      return;
    }
  }

  // 8. 完了
  props.deleteProperty(PROP_KEYS.ANA_PROGRESS);
  props.deleteProperty(PROP_KEYS.ANA_CONFIG);
  deleteTriggersByFunction_('resumeAnaDistribute');
  _updateAnaStats(stats);
  var completionStatus = getAnaCompletionStatus_(stats.errorFiles);
  updateAnaDashboardStatus_(completionStatus);

  var summaryHeading = stats.errorFiles > 0
    ? 'ANA画像配置完了（部分失敗）'
    : 'ANA画像配置完了';
  var summary = summaryHeading + '\n\n' +
    '📦 バッチ数: ' + batches.length + '\n' +
    '✅ コピー: ' + stats.copiedFiles + '枚\n' +
    '⏭️ スキップ: ' + stats.skippedFiles + '枚\n' +
    '❌ エラー: ' + stats.errorFiles + '枚\n\n' +
    buildBatchSummaryText_(batches);

  var completionTitle = stats.errorFiles > 0 ? '完了（エラーあり）' : '完了';
  recordOperationResult_({ operation: 'ANA画像配置', mode: '本実行', status: stats.errorFiles ? '完了（エラーあり）' : '完了',
    success: stats.copiedFiles, skipped: stats.skippedFiles, errors: stats.errorFiles, detail: summary });
  sendNotificationEmail_('📦 佐渡市 ' + summaryHeading, summary);
  notifyMessage_(ui, ss, completionTitle, summary);
  return { title: completionTitle, message: summary };
}

/**
 * タイムアウト時の再開（トリガーから）
 */
function resumeAnaDistribute() {
  var props = PropertiesService.getScriptProperties();
  var progressStr = props.getProperty(PROP_KEYS.ANA_PROGRESS);
  var configStr = props.getProperty(PROP_KEYS.ANA_CONFIG);

  if (!progressStr) {
    deleteTriggersByFunction_('resumeAnaDistribute');
    return;
  }

  var config = configStr ? JSON.parse(configStr) : {};
  deleteTriggersByFunction_('resumeAnaDistribute');

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(3000)) {
    ScriptApp.newTrigger('resumeAnaDistribute').timeBased().after(EXEC_CONFIG.RESUME_DELAY_MS).create();
    return;
  }

  try {
    _runAnaDistribute(config, true, true);
  } catch (e) {
    updateAnaDashboardStatus_('❌ 異常終了');
    completeOperation_({ operation: 'ANA画像配置', mode: '自動再開', status: '異常終了', errors: 1, detail: e.message },
      '❌ 佐渡市 ANA画像配置 異常終了', 'ANA画像配置の自動再開中に異常終了しました。\n\n' + e.message, true);
    throw e;
  } finally {
    lock.releaseLock();
  }
}

// =========================================================================
//  ANA用バッチ分割ロジック (S/Ｌ画像2倍容量対応)
// =========================================================================

function getAnaPlannedTargetCount_(batches) {
  var total = 0;
  for (var i = 0; i < batches.length; i++) total += batches[i].totalFiles || 0;
  return total;
}

function buildAnaProgressCheckpoint_(nextBatchIndex, stats) {
  return {
    batchIndex: nextBatchIndex,
    processedBatches: stats.processedBatches,
    copiedFiles: stats.copiedFiles,
    errorFiles: stats.errorFiles,
    skippedFiles: stats.skippedFiles,
  };
}

function commitAnaCompletedBatchCheckpoint_(props, nextBatchIndex, stats) {
  SpreadsheetApp.flush();
  props.setProperty(
    PROP_KEYS.ANA_PROGRESS,
    JSON.stringify(buildAnaProgressCheckpoint_(nextBatchIndex, stats))
  );
}

function pauseAnaBeforeBatchIfNeeded_(startTime, now, batchIndex, stats, config, props, ss) {
  if (now - startTime <= EXEC_CONFIG.TIME_LIMIT_MS) return false;

  props.setProperty(
    PROP_KEYS.ANA_PROGRESS,
    JSON.stringify(buildAnaProgressCheckpoint_(batchIndex, stats))
  );
  props.setProperty(PROP_KEYS.ANA_CONFIG, JSON.stringify(config));
  deleteTriggersByFunction_('resumeAnaDistribute');
  ScriptApp.newTrigger('resumeAnaDistribute').timeBased().after(EXEC_CONFIG.RESUME_DELAY_MS).create();
  updateAnaDashboardStatus_('⏸️ 中断(再開待ち)');
  _updateAnaStats(stats);
  ss.toast('時間制限のため中断。1分後に自動再開します。', '⏸️ 中断', 10);
  return true;
}

/**
 * ANA用にバッチを分割する。_1の画像は2重コピーされるためサイズを2倍とする。
 * @param {Array} matchResults 
 * @param {number} batchSizeMB 
 * @return {Array}
 */
function _splitIntoAnaBatches(matchResults, batchSizeMB) {
  var batchSizeBytes = batchSizeMB * 1024 * 1024;
  var batches = [];
  var currentBatch = { items: [], totalSize: 0, totalFiles: 0 };

  for (var i = 0; i < matchResults.length; i++) {
    var item = matchResults[i];
    var itemSize = 0;
    var itemFileCount = 0;

    for (var f = 0; f < item.files.length; f++) {
      var fileObj = item.files[f];
      var copyCount = ANA_CONFIG.IMAGE_SUBFOLDER_MAP[String(fileObj.imageNum)].length;
      itemSize += fileObj.fileInfo.size * copyCount;
      itemFileCount += copyCount;
    }

    if (currentBatch.items.length > 0 &&
        (currentBatch.totalSize + itemSize > batchSizeBytes ||
         currentBatch.totalFiles + itemFileCount > ANA_CONFIG.MAX_TARGETS_PER_BATCH)) {
      batches.push(currentBatch);
      currentBatch = { items: [], totalSize: 0, totalFiles: 0 };
    }

    currentBatch.items.push(item);
    currentBatch.totalSize += itemSize;
    currentBatch.totalFiles += itemFileCount;
  }

  if (currentBatch.items.length > 0) {
    batches.push(currentBatch);
  }

  return batches;
}


function _writeAnaDryRunResults(ss, matchResults, unmatchedCodes, batches) {
  for (var b = 0; b < batches.length; b++) {
    var batch = batches[b];
    var itemCodes = [];
    for (var i = 0; i < Math.min(batch.items.length, 5); i++) {
      itemCodes.push(batch.items[i].mgmtCode);
    }
    var codePreview = itemCodes.join(', ');
    if (batch.items.length > 5) codePreview += ' ... 他' + (batch.items.length - 5) + '品';

    addAnaDashboardRow_(
      b + 1,
      batch.items.length,
      batch.totalFiles,
      formatBytes_(batch.totalSize),
      '📋 ドライラン',
      codePreview
    );
  }

  if (unmatchedCodes.length > 0) {
    var dashSheet = ss.getSheetByName(SHEET_NAMES.ANA_DASHBOARD);
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

function _writeBackAnaBatchMarkings(sheet, data, headers, colBiko, batches) {
  var markingValues = [];
  for (var r = 0; r < data.length; r++) {
    markingValues.push([r === 0 ? '出力バッチ' : '未マッチ']);
  }

  for (var b = 0; b < batches.length; b++) {
    var batchNum = b + 1;
    var batchFolderName = 'upload_ana_' + padNumber_(batchNum, 3);
    var batchItems = batches[b].items;
    for (var i = 0; i < batchItems.length; i++) {
      var item = batchItems[i];
      markingValues[item.rowIndex] = [batchFolderName];
    }
  }

  var currentHeaders = headers;
  if (typeof sheet.getLastColumn === 'function' && sheet.getLastColumn() > 0) {
    currentHeaders = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  }
  var existingIndex = currentHeaders.indexOf('出力バッチ');
  var targetCol = existingIndex >= 0 ? existingIndex + 1 : currentHeaders.length + 1;
  sheet.getRange(1, targetCol, markingValues.length, 1).setValues(markingValues);
  sheet.getRange(1, targetCol)
    .setBackground('#424242')
    .setFontColor('#FFFFFF')
    .setFontWeight('bold');
  sheet.autoResizeColumn(targetCol);
}

// =========================================================================
//  CSVダウンロード (UTF-8)
// =========================================================================

function downloadAnaCsvSelected() {
  var ui = SpreadsheetApp.getUi();
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  var sheet = ss.getSheetByName(SHEET_NAMES.ANA_CSV);
  if (!sheet) {
    ui.alert('「' + SHEET_NAMES.ANA_CSV + '」シートが見つかりません。');
    return;
  }

  if (ss.getActiveSheet().getName() !== SHEET_NAMES.ANA_CSV) {
    ui.alert('「' + SHEET_NAMES.ANA_CSV + '」シートを選択した状態で実行してください。');
    return;
  }

  var data = sheet.getDataRange().getDisplayValues();
  if (data.length <= 1) {
    ui.alert('データがありません。');
    return;
  }
  var selection = ss.getSelection().getActiveRangeList();
  if (!selection) {
    ui.alert('行が選択されていません。');
    return;
  }

  var selectedSet = new Set();
  selection.getRanges().forEach(function(range) {
    for (var r = range.getRow(); r <= range.getLastRow(); r++) {
      if (r > 1) selectedSet.add(r - 1); // 0-based
    }
  });

  if (selectedSet.size === 0) {
    ui.alert('データ行が選択されていません。');
    return;
  }

  var sortedIndices = Array.from(selectedSet).sort(function(a, b) { return a - b; });
  var validationIssues = validateAnaExportRows_(data, getAnaRequiredExportHeaders_(), sortedIndices);
  if (validationIssues.length > 0) {
    var validationMessage = 'CSVを出力できません。\n\n' + validationIssues.slice(0, 20).join('\n');
    recordOperationResult_({ operation: 'ANA CSV', mode: '選択行', status: '検証失敗', errors: validationIssues.length, detail: validationMessage });
    ui.alert('出力前チェックエラー', validationMessage, ui.ButtonSet.OK);
    return;
  }
  data = buildAnaExportData_(data);
  var exportData = [data[0]];
  sortedIndices.forEach(function(idx) {
    if (idx < data.length) {
      exportData.push(data[idx]);
    }
  });

  var confirm = ui.alert(
    'CSVダウンロード（選択行）',
    '選択行をUTF-8 CSVとしてダウンロードします。\n\n' +
    'ファイル名: ana_import_selected.csv\n' +
    '対象行数: ' + (exportData.length - 1) + ' 行\n\n' +
    '実行しますか？',
    ui.ButtonSet.YES_NO
  );
  if (confirm !== ui.Button.YES) return;

  downloadCsvUtf8_(exportData, 'ana_import_selected.csv', 'ANA CSV（選択行）ダウンロード');
  recordOperationResult_({ operation: 'ANA CSV', mode: '選択行', status: '生成完了', success: exportData.length - 1 });
}

function downloadAnaCsvAll() {
  var ui = SpreadsheetApp.getUi();
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  var sheet = ss.getSheetByName(SHEET_NAMES.ANA_CSV);
  if (!sheet) {
    ui.alert('「' + SHEET_NAMES.ANA_CSV + '」シートが見つかりません。');
    return;
  }

  var data = sheet.getDataRange().getDisplayValues();
  if (data.length <= 1) {
    ui.alert('データがありません。');
    return;
  }
  var validationIssues = validateAnaExportRows_(data, getAnaRequiredExportHeaders_());
  if (validationIssues.length > 0) {
    var validationMessage = 'CSVを出力できません。\n\n' + validationIssues.slice(0, 20).join('\n');
    recordOperationResult_({ operation: 'ANA CSV', mode: '全行', status: '検証失敗', errors: validationIssues.length, detail: validationMessage });
    ui.alert('出力前チェックエラー', validationMessage, ui.ButtonSet.OK);
    return;
  }
  data = buildAnaExportData_(data);

  var confirm = ui.alert(
    'CSVダウンロード（全行）',
    '全行をUTF-8 CSVとしてダウンロードします。\n\n' +
    'ファイル名: ana_import_all.csv\n' +
    '対象行数: ' + (data.length - 1) + ' 行\n\n' +
    '実行しますか？',
    ui.ButtonSet.YES_NO
  );
  if (confirm !== ui.Button.YES) return;

  downloadCsvUtf8_(data, 'ana_import_all.csv', 'ANA CSV（全行）ダウンロード');
  recordOperationResult_({ operation: 'ANA CSV', mode: '全行', status: '生成完了', success: data.length - 1 });
}

// =========================================================================
//  ヘルパー
// =========================================================================

function parseAnaImageFilename_(filename) {
  var match = filename.match(/^(.+)_(\d+)\.([^.]+)$/);
  if (!match) return null;
  return {
    key: match[1],
    number: match[2],
    ext: match[3]
  };
}

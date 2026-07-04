/**
 * ==============================================================================
 * メニュー・UI管理 (Menu.js)
 * カスタムメニュー、確認ダイアログ、初期設定
 * ==============================================================================
 */

// =========================================================================
// メニュー
// =========================================================================

/**
 * スプレッドシート起動時にカスタムメニューを追加
 */
function onOpen() {
  var ui = SpreadsheetApp.getUi();
  ui.createMenu('📷 画像集約')
    .addItem('⚙️ 初期設定（差分更新）', 'updateSettingsOnly')
    .addItem('🗑️ 初期設定（新規再生成）', 'recreateSettingsOnly')
    .addSeparator()
    .addSubMenu(ui.createMenu('🔄 番号移行')
      .addItem('① 楽天CSVから対照表を補完', 'autoFillNumberMappingFromRakuten')
      .addItem('② 対照表を検証', 'validateNumberMapping')
      .addItem('③ 楽天ドライラン', 'dryRunRakutenNumberMigration')
      .addItem('④ 楽天変換実行', 'executeRakutenNumberMigration')
      .addItem('⑤ 楽天CSVをダウンロード', 'downloadRakutenMigrationCsv')
      .addItem('⑥ ANAドライラン', 'dryRunAnaNumberMigration')
      .addItem('⑦ ANA備考反映実行', 'executeAnaNumberMigration')
      .addItem('⑧ 番号移行ダッシュボード', 'showNumberMigrationDashboard')
    )
    .addSeparator()
    .addItem('🔍 全行実行', 'showCollectDialog')
    .addItem('🧪 選択行テスト', 'executeTestRow')
    .addItem('📋 ドライラン（テスト）', 'showDryRunDialog')
    .addSeparator()
    .addSubMenu(ui.createMenu('🆕 画像差分抽出')
      .addItem('📋 差分抽出 ドライラン', 'showDifferenceDryRunDialog')
      .addItem('🚀 差分抽出 実行', 'showDifferenceCollectDialog')
    )
    .addSubMenu(ui.createMenu('📦 Choice配置')
      .addItem('📋 ドライラン（確認のみ）', 'showChoiceDistDryRunDialog')
      .addItem('🚀 配置実行', 'showChoiceDistDialog')
      .addItem('📋 バッチTSVコピー', 'promptCopyBatchTsv')
      .addItem('📊 Choiceダッシュボード', 'showChoiceDashboard')
    )
    .addSubMenu(ui.createMenu('📦 ANA配置')
      .addItem('① 画像ファイル名転記', 'syncAnaImageFilenames')
      .addItem('② 販売開始日時刻補完', 'fillAnaSalesStartTime')
      .addItem('📋 ドライラン（画像振り分け）', 'showAnaDistDryRunDialog')
      .addItem('🚀 画像配置実行', 'showAnaDistDialog')
      .addItem('④ CSVダウンロード（選択行）', 'downloadAnaCsvSelected')
      .addItem('⑤ CSVダウンロード（全行）', 'downloadAnaCsvAll')
      .addItem('📊 ANAダッシュボード', 'showAnaDashboard')
    )
    .addSubMenu(ui.createMenu('📦 楽天配置')
      .addItem('① R-Cabinet フォルダ取得', 'fetchAllFolders')
      .addItem('② R-Cabinet 画像取得', 'showGetImagesDialog')
      .addItem('③ 画像パイプライン（一括）', 'runImagePipeline')
      .addItem('④ HTMLテンプレート差込', 'applyTemplateInjection')
      .addItem('⑤ プレビュー（サンプル1件）', 'previewTemplate')
      .addItem('⑥ CSVダウンロード（全行）', 'downloadRakutenCsv')
      .addItem('⑦ CSVダウンロード（選択行）', 'downloadRakutenSelectedCsv')
      .addItem('⑧ Driveから画像一覧取得', 'listDriveImages')
      .addItem('⑨ 選択行をAPIアップロード', 'uploadSelectedToRCabinet')
      .addItem('⑩ FTP失敗画像コピー', 'copyFtpFailedImages')
      .addSeparator()
      .addItem('🧪 楽天画像変換 ドライラン', 'dryRunRakutenImageNormalization')
      .addItem('🚀 楽天画像変換 実行', 'startRakutenImageNormalization')
      .addItem('📊 楽天画像変換 ダッシュボード', 'showRakutenImageNormalizationDashboard')
      .addItem('📊 楽天ダッシュボード', 'showRakutenDashboard')
    )
    .addSeparator()
    .addItem('📊 ダッシュボード表示', 'showDashboard')
    .addItem('🔄 中断から再開', 'resumeCollect')
    .addItem('🗑️ 進捗リセット', 'resetProgress')
    .addItem('❓ 使い方', 'showHelp')
    .addToUi();
}


// =========================================================================
// 初期設定
// =========================================================================

/**
 * settingシートとdashboardシートを自動生成する
 */
/**
 * 設定項目を既存値を保護しながら差分更新する（メニュー「⚙️ 初期設定（差分更新）」から呼び出し）
 */
function updateSettingsOnly() {
  setupInitialSettings_(false);
}

/**
 * 設定項目を完全に初期化して再生成する（メニュー「🗑️ 初期設定（新規再生成）」から呼び出し）
 */
function recreateSettingsOnly() {
  var ui = SpreadsheetApp.getUi();
  var response = ui.alert(
    '⚠️ 警告: 設定シートの新規再生成',
    'settingシートを完全に削除し、デフォルト値で再生成します。\n現在すでに入力されているフォルダURL等の設定値はすべて消去されます。\n\n本当によろしいですか？',
    ui.ButtonSet.YES_NO
  );
  if (response === ui.Button.YES) {
    setupInitialSettings_(true);
  }
}

function removeObsoleteSettingRows_(sheet, obsoleteKeys) {
  var values = sheet.getDataRange().getValues();
  for (var row = values.length - 1; row >= 0; row--) {
    if (obsoleteKeys.indexOf(String(values[row][0]).trim()) !== -1) {
      sheet.deleteRow(row + 1);
    }
  }
}

/**
 * シートが指定列数まで書き込めるよう、不足列だけを追加する
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet - 対象シート
 * @param {number} requiredColumns - 必要な列数
 * @returns {GoogleAppsScript.Spreadsheet.Sheet} 対象シート
 */
function ensureSheetColumnCapacity_(sheet, requiredColumns) {
  if (!Number.isInteger(requiredColumns) || requiredColumns <= 0) {
    throw new Error('requiredColumns must be a positive integer');
  }

  var currentColumns = sheet.getMaxColumns();
  if (currentColumns < requiredColumns) {
    sheet.insertColumnsAfter(currentColumns, requiredColumns - currentColumns);
  }
  return sheet;
}

function initializeSheetHeadersIfBlank_(sheet, headers) {
  var lastRow = sheet.getLastRow();
  if (lastRow > 1) return false;
  if (lastRow === 1) {
    var lastColumn = sheet.getLastColumn();
    if (lastColumn > headers.length) return false;
    var existingHeaders = sheet.getRange(1, 1, 1, lastColumn).getValues()[0];
    for (var i = 0; i < existingHeaders.length; i++) {
      if (String(existingHeaders[i]).trim() !== String(headers[i]).trim()) return false;
    }
  }
  ensureSheetColumnCapacity_(sheet, headers.length);
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(1, 1, 1, headers.length)
    .setBackground('#424242')
    .setFontColor('#FFFFFF')
    .setFontWeight('bold');
  sheet.setFrozenRows(1);
  return true;
}

/**
 * settingシートとその他の必要シートを初期設定する内部実装
 * @param {boolean} isForceRecreate - 強制的に再生成するかどうか
 */
function setupInitialSettings_(isForceRecreate) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ui = SpreadsheetApp.getUi();

  // 設定項目の定義リスト
  var settingRows = [
    [SETTING_KEYS.DEST_FOLDER_URL, '', '統合先のGoogle DriveフォルダURLを貼り付け（集約画像元）'],
    [SETTING_KEYS.DIFF_DEST_FOLDER_URL, '', '統合先にない新規画像だけを保存するGoogle DriveフォルダURL'],
    [SETTING_KEYS.NOTIFICATION_EMAIL, '', '完了時にメール通知を受け取るアドレス（任意）'],
    
    // Choice設定
    [SETTING_KEYS.CHOICE_MGMT_CODE_COL, '管理コード', 'Choice TSVの管理コードが入っているカラム名'],
    [SETTING_KEYS.CHOICE_IMAGE_COLS, 'スライド画像1,スライド画像2,スライド画像3,スライド画像4,スライド画像5,スライド画像6,スライド画像7,スライド画像8,品梱包画像', 'Choice TSVの画像ファイル名が入っているカラム名（カンマ区切り）'],
    [SETTING_KEYS.CHOICE_DEST_FOLDER_URL, '', 'Choice用のバッチ出力先フォルダURL（空欄時は統合先フォルダを使用）'],
    [SETTING_KEYS.CHOICE_BATCH_SIZE_MB, String(CHOICE_CONFIG.DEFAULT_BATCH_SIZE_MB), 'Choice画像の1バッチあたりの容量制限（1〜80MB）'],
    [SETTING_KEYS.CHOICE_MAIN_IMAGE_COL, 'お礼の品画像', 'Choice TSVのメイン画像（お礼の品画像）が入っているカラム名（空欄時はマッピングしない）'],
    
    // ANA設定
    [SETTING_KEYS.ANA_DEST_FOLDER_URL, '', 'ANA用のバッチ出力先フォルダURL（空欄時は統合先フォルダを使用）'],
    [SETTING_KEYS.ANA_BATCH_SIZE_MB, String(ANA_CONFIG.DEFAULT_BATCH_SIZE_MB), 'ANA画像の1バッチあたりの容量制限 (MB)'],
    
    // 楽天設定
    [SETTING_KEYS.RAKUTEN_DEST_FOLDER_URL, '', '楽天用のバッチ出力先フォルダURL（空欄時は統合先フォルダを使用）'],
    [SETTING_KEYS.RAKUTEN_IMAGE_SOURCE_FOLDER_URL, '', '小文字化・最適化する楽天画像のコピー元フォルダURL'],
    [SETTING_KEYS.RAKUTEN_IMAGE_DEST_FOLDER_URL, '', '小文字化・最適化した楽天画像のコピー先フォルダURL'],
    [SETTING_KEYS.RAKUTEN_SHOP_ID, '', '楽天RMS店舗ID（API連携用）'],
    [SETTING_KEYS.RAKUTEN_API_SERVICE_SECRET, '', '楽天RMS APIサービスシークレット（API連携用）'],
    [SETTING_KEYS.RAKUTEN_API_LICENSE_KEY, '', '楽天RMS APIライセンスキー（API連携用）'],
    [SETTING_KEYS.RAKUTEN_CABINET_FOLDER_ID, '', 'R-CabinetフォルダID（画像格納先フォルダID。例: 5001234。空欄時はルート）'],
  ];

  var sheet = ss.getSheetByName(SHEET_NAMES.SETTING);
  
  if (sheet && isForceRecreate) {
    ss.deleteSheet(sheet);
    sheet = null;
  }

  var isNewSheet = !sheet;
  var addedKeys = [];

  if (isNewSheet) {
    // settingシート新規作成
    sheet = ss.insertSheet(SHEET_NAMES.SETTING);

    // ヘッダー
    sheet.getRange('A1').setValue('⚙️ 佐渡市 画像集約・配置ツール 設定').setFontSize(14).setFontWeight('bold');
    sheet.getRange('A2').setValue('A列のキーは変更しないでください。B列に値を入力してください。')
      .setFontColor('#888888').setFontStyle('italic');

    var startRow = 4;
    // ヘッダー行
    sheet.getRange(startRow, 1, 1, 3).setValues([['設定項目', '値', '説明']]);
    sheet.getRange(startRow, 1, 1, 3)
      .setBackground('#424242')
      .setFontColor('#FFFFFF')
      .setFontWeight('bold');

    // データ行
    sheet.getRange(startRow + 1, 1, settingRows.length, 3).setValues(settingRows);

    // B列にバリデーション強調
    sheet.getRange(startRow + 1, 2, settingRows.length, 1)
      .setBackground('#FFF9C4');

    // 列幅
    sheet.setColumnWidth(1, 250);
    sheet.setColumnWidth(2, 500);
    sheet.setColumnWidth(3, 300);

    // 罫線
    sheet.getRange(startRow, 1, settingRows.length + 1, 3)
      .setBorder(true, true, true, true, true, true);

    sheet.setFrozenRows(startRow);
    addedKeys = settingRows.map(function(row) { return row[0]; });
  } else {
    // 既存シートがある場合：差分キーのみを追加
    removeObsoleteSettingRows_(sheet, ['楽天画像バッチサイズ(MB)']);
    var existingData = sheet.getDataRange().getValues();
    var existingKeys = {};
    for (var i = 0; i < existingData.length; i++) {
      var k = String(existingData[i][0]).trim();
      if (k) existingKeys[k] = true;
    }

    var diffRows = [];
    for (var j = 0; j < settingRows.length; j++) {
      var key = settingRows[j][0];
      if (!existingKeys[key]) {
        diffRows.push(settingRows[j]);
        addedKeys.push(key);
      }
    }

    if (diffRows.length > 0) {
      var startRow = sheet.getLastRow() + 1;
      // 差分行を追加
      sheet.getRange(startRow, 1, diffRows.length, 3).setValues(diffRows);
      
      // 追加された項目のB列をハイライト
      sheet.getRange(startRow, 2, diffRows.length, 1).setBackground('#FFF9C4');
      
      // 全体に罫線を引き直す
      sheet.getDataRange().setBorder(true, true, true, true, true, true);
    }
  }

  // dashboardシートも初期化（存在しない場合のみ）
  var dashSheet = ss.getSheetByName(SHEET_NAMES.DASHBOARD);
  if (!dashSheet) {
    dashSheet = ss.insertSheet(SHEET_NAMES.DASHBOARD);
    dashSheet.getRange('A1').setValue('📊 ダッシュボード（実行後に自動更新されます）');
  }

  // masterシートの雛形も作成（存在しない場合のみ）
  var masterSheet = ss.getSheetByName(SHEET_NAMES.MASTER);
  if (!masterSheet) {
    masterSheet = ss.insertSheet(SHEET_NAMES.MASTER);
    masterSheet.getRange('A1:B1').setValues([[MASTER_COLUMNS.MGMT_CODE, MASTER_COLUMNS.FOLDER_LINK]]);
    masterSheet.getRange('A1:B1')
      .setBackground('#424242')
      .setFontColor('#FFFFFF')
      .setFontWeight('bold');
    masterSheet.setColumnWidth(1, 200);
    masterSheet.setColumnWidth(2, 500);
    masterSheet.setFrozenRows(1);
  }

  // choice_tsvシートの雛形も作成（存在しない場合のみ）
  var choiceTsvSheet = ss.getSheetByName(SHEET_NAMES.CHOICE_TSV);
  if (!choiceTsvSheet) {
    choiceTsvSheet = ss.insertSheet(SHEET_NAMES.CHOICE_TSV);
    choiceTsvSheet.getRange('A1').setValue('⬇️ チョイスからエクスポートしたTSVをここに貼り付けてください')
      .setFontSize(12).setFontWeight('bold').setFontColor('#1a73e8');
    choiceTsvSheet.getRange('A2').setValue('※ ヘッダー行を含むTSV全体を、A1セルを選択した状態で貼り付けてください。このメッセージは上書きされます。')
      .setFontColor('#888888').setFontStyle('italic');
  }

  // --- ANAシート初期化 ---
  var anaCsvSheet = ss.getSheetByName(SHEET_NAMES.ANA_CSV);
  if (!anaCsvSheet) {
    anaCsvSheet = ss.insertSheet(SHEET_NAMES.ANA_CSV);
  }
  // DistributorANA.jsからヘッダー定義を取得（未作成の場合は空ヘッダー）
  var anaHeaders = (typeof getAnaCsvHeaders === 'function') ? getAnaCsvHeaders() : ['返礼品識別コード', '備考(内部用)', 'S画像ファイル', 'Ｌ画像ファイル'];
  if (initializeSheetHeadersIfBlank_(anaCsvSheet, anaHeaders)) {
    // 全列を書式テキストに設定
    anaCsvSheet.getRange(1, 1, anaCsvSheet.getMaxRows(), anaHeaders.length).setNumberFormat('@');
  }

  // --- 楽天シート初期化 ---
  var rakutenCsvSheet = ss.getSheetByName(SHEET_NAMES.RAKUTEN_CSV);
  if (!rakutenCsvSheet) {
    rakutenCsvSheet = ss.insertSheet(SHEET_NAMES.RAKUTEN_CSV);
  }
  // DistributorRakuten.jsからヘッダーを取得（未作成の場合は簡易ヘッダー）
  var rakutenHeaders = (typeof getRakutenCsvHeaders === 'function') ? getRakutenCsvHeaders() : ['商品管理番号(商品URL)', '商品番号', '商品名', 'PC用商品説明文', 'スマートフォン用商品説明文', 'PC用販売説明文', 'SKU管理番号', 'システム連携用SKU番号'];
  if (initializeSheetHeadersIfBlank_(rakutenCsvSheet, rakutenHeaders)) {
    rakutenCsvSheet.getRange(1, 1, rakutenCsvSheet.getMaxRows(), rakutenHeaders.length).setNumberFormat('@');
  }

  // 楽天テンプレートシート
  var rakutenTemplateSheet = ss.getSheetByName(SHEET_NAMES.RAKUTEN_TEMPLATE);
  if (!rakutenTemplateSheet) {
    rakutenTemplateSheet = ss.insertSheet(SHEET_NAMES.RAKUTEN_TEMPLATE);
    var templateData = [
      ['キー', '', '佐渡市説明テンプレート'],
      ['TEMPLATE_PC_DESC', '', 'ここにPC用商品説明文のテンプレートを入力'],
      ['TEMPLATE_SP_DESC', '', 'ここにスマートフォン用商品説明文のテンプレートを入力'],
      ['TEMPLATE_PC_SALES', '', 'ここにPC用販売説明文のテンプレートを入力']
    ];
    rakutenTemplateSheet.getRange(1, 1, templateData.length, 3).setValues(templateData);
    rakutenTemplateSheet.getRange(1, 1, 1, 3).setFontWeight('bold').setBackground('#424242').setFontColor('#FFFFFF');
    rakutenTemplateSheet.setColumnWidth(1, 180);
    rakutenTemplateSheet.setColumnWidth(3, 500);
  }

  // 楽天API連携用の補助シート群
  var rSheets = [
    { name: SHEET_NAMES.RAKUTEN_IMAGE_FOLDERS, headers: [['FolderId', 'FolderName', 'FolderPath', 'FolderNode', 'FileCount', 'FileSize', 'TimeStamp']] },
    { name: SHEET_NAMES.RAKUTEN_IMAGE_LIST, headers: [['FileName', 'FileUrl', 'FileId', 'FileSize(KB)', 'Dimensions', 'AccessDate', 'TimeStamp', 'FolderName', 'FolderId', 'フォルダパス']] },
    { name: SHEET_NAMES.EXECUTION_HISTORY, headers: [['実行日時', '実行者', '処理名', 'モード', '結果', '成功', 'スキップ', 'エラー', '詳細']] },
    { name: SHEET_NAMES.NUMBER_MAPPING, headers: [[
      '商品管理番号（商品URL）', '旧商品番号', '新商品番号',
      '旧システム連携用SKU番号', '新システム連携用SKU番号',
      'SKU区分', '備考', '検証結果'
    ]] },
    { name: SHEET_NAMES.NUMBER_MIGRATION_DASHBOARD, headers: [[
      '処理', '実行日時', 'モード', '対象件数', '変更予定', '変換済み',
      'エラー', '行', '商品管理番号（商品URL）', 'SKU管理番号',
      '列', '変更前', '変更後', '結果・理由'
    ]] },
    { name: SHEET_NAMES.RAKUTEN_IMAGE_GRID, headers: [getRakutenImageSlotHeaders_('URL')] },
    { name: SHEET_NAMES.RAKUTEN_IMAGE_PATHS, headers: [getRakutenImageSlotHeaders_('Path')] },
    { name: SHEET_NAMES.RAKUTEN_IMAGE_MAPPING, headers: [['R-Cabinet商品番号', '管理コード', '備考']] },
    { name: SHEET_NAMES.RAKUTEN_DRIVE_FILES, headers: [['ファイル名', 'ファイルID', 'サイズ(KB)', 'MIMEタイプ', 'Drive URL', 'ステータス']] },
    { name: SHEET_NAMES.RAKUTEN_UPLOAD_LOG, headers: [['実行日時', 'ファイル名', 'フォルダID', '結果', '詳細']] },
    { name: SHEET_NAMES.RAKUTEN_FAILED_FILES, headers: [['ファイル名', 'ステータス', 'コピー先URL', '備考']] }
  ];
  rSheets.forEach(function(item) {
    var s = ss.getSheetByName(item.name);
    if (!s) {
      s = ss.insertSheet(item.name);
    }
    initializeSheetHeadersIfBlank_(s, item.headers[0]);
  });
  var numberMappingSheet = ss.getSheetByName(SHEET_NAMES.NUMBER_MAPPING);
  if (numberMappingSheet) {
    ensureSheetColumnCapacity_(numberMappingSheet, 10);
    var choiceGuideRange = numberMappingSheet.getRange(1, 10, 3, 1);
    var choiceGuideValues = choiceGuideRange.getValues();
    if (!choiceGuideValues[0][0]) {
      choiceGuideRange.setValues([
        ['Choice XLOOKUP例'],
        ["'=XLOOKUP(旧管理コード,number_mapping!D:D,number_mapping!E:E,\"未対応\")"],
        ['Choiceの管理コードを旧番号で検索し、新システム連携用SKU番号へ置換してください。']
      ]);
    }
  }
  ensureRakutenLogSheet_(ss);

  // settingシートをアクティブに
  sheet.activate();

  if (isForceRecreate) {
    ui.alert('✅ 再生成完了', 'settingシートを完全に初期化して再生成しました。各ポータル用のシートも初期化されています。', ui.ButtonSet.OK);
  } else if (isNewSheet) {
    ui.alert(
      '✅ 初期設定完了',
      'settingシートを作成しました。\n\n' +
      '以下を入力してください：\n' +
      '1. 統合先フォルダURL（画像を集約するGoogle Driveフォルダ）\n' +
      '2. 通知先メールアドレス（任意）\n\n' +
      '【画像集約】\n' +
      'masterシートにデータ（管理番号、フォルダリンク）を貼り付け\n\n' +
      '【Choice配置】\n' +
      'choice_tsvシートにチョイスのTSVを貼り付け',
      ui.ButtonSet.OK
    );
  } else if (addedKeys.length > 0) {
    ui.alert(
      '🔄 設定項目を更新しました',
      '以下の新しい設定項目が追加されました（黄色ハイライト）:\n\n' +
      addedKeys.map(function(k) { return '• ' + k; }).join('\n'),
      ui.ButtonSet.OK
    );
  } else {
    ui.alert(
      'ℹ️ 設定は最新です',
      '追加する設定項目はありませんでした。',
      ui.ButtonSet.OK
    );
  }
}


// =========================================================================
// 実行ダイアログ
// =========================================================================

/**
 * 全行実行の確認ダイアログを表示する
 */
function showCollectDialog() {
  var ui = SpreadsheetApp.getUi();

  // 設定チェック
  var validation = _validatePreRequisites(ui);
  if (!validation) return;

  var html = HtmlService.createHtmlOutput(_buildCollectDialogHtml(validation.dataRowCount, false))
    .setWidth(500)
    .setHeight(380);
  ui.showModalDialog(html, '📷 画像集約 — 全行実行');
}

/**
 * ドライラン確認ダイアログを表示する
 */
function showDryRunDialog() {
  var ui = SpreadsheetApp.getUi();

  var validation = _validatePreRequisites(ui);
  if (!validation) return;

  var html = HtmlService.createHtmlOutput(_buildCollectDialogHtml(validation.dataRowCount, true))
    .setWidth(500)
    .setHeight(380);
  ui.showModalDialog(html, '📋 ドライラン — テスト実行');
}

function showDifferenceCollectDialog() {
  showDifferenceDialog_(false);
}

function showDifferenceDryRunDialog() {
  showDifferenceDialog_(true);
}

function showDifferenceDialog_(isDryRun) {
  var ui = SpreadsheetApp.getUi();
  var validation = validateDifferencePreRequisites_(ui);
  if (!validation) return;
  var html = HtmlService.createHtmlOutput(buildGenericDialogHtml_({
    isDryRun: isDryRun,
    funcName: isDryRun ? 'startDifferenceDryRun' : 'startDifferenceCollect',
    btnLabel: isDryRun ? 'ドライラン開始' : '差分抽出を開始',
    modeLabel: isDryRun ? '📋 差分抽出ドライラン' : '🚀 画像差分抽出',
    modeDesc: '統合先と差分保存先のどちらにもない画像だけを判定します。',
    themeColor: '#0F766E',
    dataSectionTitle: '対象',
    dataRows: [{ label: 'masterデータ行', value: String(validation.dataRowCount) + '行' }],
    processSectionTitle: '処理内容',
    processRows: ['同名判定は大文字・小文字を区別しない', 'コピー元フォルダの直下画像だけを対象とする'],
    noteText: isDryRun ? 'Driveへの書き込みは行いません。' : '終了前に画面を閉じても自動継続します。'
  })).setWidth(520).setHeight(420);
  ui.showModalDialog(html, isDryRun ? '📋 差分抽出 ドライラン' : '🚀 差分抽出 実行');
}

function validateDifferencePreRequisites_(ui) {
  var validation = _validatePreRequisites(ui);
  if (!validation) return null;
  if (!getSettingValue_(SETTING_KEYS.DIFF_DEST_FOLDER_URL)) {
    ui.alert('エラー: settingシートに「' + SETTING_KEYS.DIFF_DEST_FOLDER_URL + '」が設定されていません。');
    return null;
  }
  return validation;
}

/**
 * 実行前の前提条件チェック
 * @param {Object} ui - SpreadsheetApp.getUi()
 * @returns {?Object} { dataRowCount } or null (エラー時)
 */
function _validatePreRequisites(ui) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  // 統合先フォルダ
  var destFolderUrl = getSettingValue_(SETTING_KEYS.DEST_FOLDER_URL);
  if (!destFolderUrl) {
    ui.alert('エラー: settingシートに「' + SETTING_KEYS.DEST_FOLDER_URL + '」が設定されていません。\n先に「初期設定」を実行してください。');
    return null;
  }

  // masterシート
  var sheet = ss.getSheetByName(SHEET_NAMES.MASTER);
  if (!sheet) {
    ui.alert('エラー: 「' + SHEET_NAMES.MASTER + '」シートが見つかりません。');
    return null;
  }

  var dataRowCount = Math.max(0, sheet.getLastRow() - 1);
  if (dataRowCount === 0) {
    ui.alert('エラー: masterシートにデータがありません。');
    return null;
  }

  // カラムチェック
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var colMap = createColumnMap_(headers);
  if (colMap[MASTER_COLUMNS.MGMT_CODE] === undefined) {
    ui.alert('エラー: 「' + MASTER_COLUMNS.MGMT_CODE + '」カラムが見つかりません。');
    return null;
  }
  if (colMap[MASTER_COLUMNS.FOLDER_LINK] === undefined) {
    ui.alert('エラー: 「' + MASTER_COLUMNS.FOLDER_LINK + '」カラムが見つかりません。');
    return null;
  }

  return { dataRowCount: dataRowCount };
}

/**
 * 実行ダイアログのHTMLを構築する
 * @param {number} dataRowCount - データ行数
 * @param {boolean} isDryRun - ドライランかどうか
 * @returns {string} HTML文字列
 */
/**
 * 汎用ダイアログHTMLビルダー
 * @param {Object} config - 設定オブジェクト
 * @param {boolean} config.isDryRun - ドライランかどうか
 * @param {string} config.funcName - 実行時に呼び出すGAS関数名
 * @param {string} config.btnLabel - 実行ボタンのラベル
 * @param {string} config.modeLabel - モードのラベル
 * @param {string} config.modeDesc - モードの説明文
 * @param {string} config.themeColor - 主要なテーマ色
 * @param {string} [config.bgColor='#FFFFFF'] - 背景色
 * @param {string} [config.textColor='#333333'] - テキスト色
 * @param {string} [config.titleColor] - タイトルの色
 * @param {string} [config.labelColor='#666666'] - ラベル色
 * @param {string} [config.noteBg='#f8f9fa'] - 注意書き背景色
 * @param {string} [config.noteColor='#888888'] - 注意書きテキスト色
 * @param {string} [config.btnPrimaryBg] - メインボタン背景色
 * @param {string} [config.btnSecondaryBg='#f1f3f4'] - キャンセルボタン背景色
 * @param {string} [config.btnSecondaryColor='#333333'] - キャンセルボタンテキスト色
 * @param {string} config.dataSectionTitle - データセクションのタイトル
 * @param {Array<{label: string, value: string, isCheck?: boolean}>} config.dataRows - データ情報行
 * @param {string} config.processSectionTitle - 処理内容セクションのタイトル
 * @param {string[]} config.processRows - 処理内容リスト
 * @param {string} config.noteText - 注意書きテキスト
 * @returns {string} HTML文字列
 */
function buildGenericDialogHtml_(config) {
  var isDryRun = config.isDryRun;
  var themeColor = config.themeColor;
  var titleColor = config.titleColor || themeColor;
  var bgColor = config.bgColor || '#FFFFFF';
  var textColor = config.textColor || '#333333';
  var labelColor = config.labelColor || '#666666';
  var noteBg = config.noteBg || '#f8f9fa';
  var noteColor = config.noteColor || '#888888';
  var btnPrimaryBg = config.btnPrimaryBg || themeColor;
  var btnSecondaryBg = config.btnSecondaryBg || '#f1f3f4';
  var btnSecondaryColor = config.btnSecondaryColor || '#333333';
  
  var html = '<style>'
    + 'body { font-family: "Segoe UI", "Hiragino Sans", sans-serif; padding: 16px; color: ' + textColor + '; background-color: ' + bgColor + '; margin: 0; }'
    + '.section { margin-bottom: 16px; }'
    + '.section-title { font-weight: bold; font-size: 14px; margin-bottom: 8px; color: ' + titleColor + '; }'
    + '.info-row { margin: 4px 0; font-size: 13px; }'
    + '.label { color: ' + labelColor + '; }'
    + '.btn { padding: 10px 20px; border: none; border-radius: 4px; cursor: pointer; font-size: 14px; margin-right: 8px; transition: all 0.2s ease; }'
    + '.btn-primary { background: ' + btnPrimaryBg + '; color: white; }'
    + '.btn-secondary { background: ' + btnSecondaryBg + '; color: ' + btnSecondaryColor + '; }'
    + '.btn:hover { opacity: 0.9; }'
    + '.btn:disabled { opacity: 0.6; cursor: not-allowed; }'
    + '.footer { margin-top: 20px; text-align: right; }'
    + '.note { font-size: 12px; color: ' + noteColor + '; margin-top: 8px; padding: 8px; background: ' + noteBg + '; border-radius: 4px; }'
    + '.check { color: #059669; }'
    + '</style>'
    + '<div class="container">'
    + '  <div class="section">'
    + '    <div class="section-title">' + config.modeLabel + '</div>'
    + '    <div class="info-row">' + config.modeDesc + '</div>'
    + '  </div>';

  if (config.dataRows && config.dataRows.length > 0) {
    html += '  <div class="section">'
      + '    <div class="section-title">' + config.dataSectionTitle + '</div>';
    for (var i = 0; i < config.dataRows.length; i++) {
      var row = config.dataRows[i];
      if (row.isCheck) {
        html += '    <div class="info-row"><span class="label">' + row.label + ':</span> <span class="check">' + row.value + '</span></div>';
      } else {
        html += '    <div class="info-row"><span class="label">' + row.label + ':</span> <strong>' + row.value + '</strong></div>';
      }
    }
    html += '  </div>';
  }

  if (config.processRows && config.processRows.length > 0) {
    html += '  <div class="section">'
      + '    <div class="section-title">' + config.processSectionTitle + '</div>';
    for (var j = 0; j < config.processRows.length; j++) {
      html += '    <div class="info-row">' + config.processRows[j] + '</div>';
    }
    html += '  </div>';
  }

  if (config.noteText) {
    html += '  <div class="note">' + config.noteText + '</div>';
  }

  html += '  <div class="footer">'
    + '    <button class="btn btn-secondary" onclick="google.script.host.close()">キャンセル</button>'
    + '    <button class="btn btn-primary" id="runBtn" onclick="runAction()">' + config.btnLabel + '</button>'
    + '  </div>'
    + '</div>'
    + '<script>'
    + 'var submitted = false;'
    + 'function runAction() {'
    + '  if (submitted) return;'
    + '  submitted = true;'
    + '  var btn = document.getElementById("runBtn");'
    + '  var controls = document.querySelectorAll("button");'
    + '  for (var i = 0; i < controls.length; i++) controls[i].disabled = true;'
    + '  btn.textContent = "⏳ 処理中...";'
    + '  var configData = JSON.stringify({ isDryRun: ' + isDryRun + ' });'
    + '  google.script.run'
    + '    .withSuccessHandler(function() { google.script.host.close(); })'
    + '    .withFailureHandler(function(error) {'
    + '      submitted = false;'
    + '      for (var i = 0; i < controls.length; i++) controls[i].disabled = false;'
    + '      btn.textContent = "' + config.btnLabel + '";'
    + '      alert("開始に失敗しました: " + (error && error.message ? error.message : error));'
    + '    })'
    + '    .' + config.funcName + '(configData);'
    + '}'
    + '</script>';

  return html;
}

/**
 * 実行ダイアログのHTMLを構築する
 * @param {number} dataRowCount - データ行数
 * @param {boolean} isDryRun - ドライランかどうか
 * @returns {string} HTML文字列
 */
function _buildCollectDialogHtml(dataRowCount, isDryRun) {
  var themeColor = isDryRun ? '#6B7280' : '#059669';
  return buildGenericDialogHtml_({
    isDryRun: isDryRun,
    funcName: isDryRun ? 'startDryRun' : 'startCollect',
    btnLabel: isDryRun ? '📋 ドライラン実行' : '🚀 実行',
    modeLabel: isDryRun ? '📋 ドライラン' : '🚀 全行実行',
    modeDesc: isDryRun
      ? '実際のコピーは行わず、何件コピーされるかをカウントします。'
      : 'masterシートの全行を対象に、フォルダ内の画像を統合先にコピーします。',
    themeColor: themeColor,
    dataSectionTitle: '📊 対象データ',
    dataRows: [
      { label: 'データ行数', value: dataRowCount + '行' },
      { label: '対象シート', value: SHEET_NAMES.MASTER }
    ],
    processSectionTitle: '⚙️ 処理内容',
    processRows: [
      '• 各行のフォルダリンク先にアクセス',
      '• フォルダ内の画像ファイルを統合先にコピー',
      '• 同名ファイルが存在する場合はスキップ',
      '• 元フォルダの画像はそのまま保持'
    ],
    noteText: '⏱️ 大量データの場合、27分で自動中断 → 1分後に再開されます。'
  });
}



// =========================================================================
// その他のメニュー機能
// =========================================================================

/**
 * ダッシュボードシートにジャンプする
 */
function showDashboard() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAMES.DASHBOARD);
  if (!sheet) {
    SpreadsheetApp.getUi().alert('ダッシュボードはまだ作成されていません。\n画像集約を実行すると自動的に作成されます。');
    return;
  }
  sheet.activate();
}

/**
 * Choice配置ダッシュボードにジャンプする
 */
function showChoiceDashboard() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAMES.CHOICE_DASHBOARD);
  if (!sheet) {
    SpreadsheetApp.getUi().alert('Choice配置ダッシュボードはまだ作成されていません。\nChoice配置を実行すると自動的に作成されます。');
    return;
  }
  sheet.activate();
}

/**
 * リセット対象の進捗プロパティキーを返す
 */
function getProgressPropertyKeys_() {
  return [
    PROP_KEYS.PROGRESS,
    PROP_KEYS.CONFIG,
    PROP_KEYS.QUEUE_CONFIG,
    PROP_KEYS.DIFF_PROGRESS,
    PROP_KEYS.DIFF_CONFIG,
    PROP_KEYS.DIFF_QUEUE_CONFIG,
    PROP_KEYS.DIST_PROGRESS,
    PROP_KEYS.DIST_CONFIG,
    PROP_KEYS.DIST_QUEUE_CONFIG,
    PROP_KEYS.ANA_PROGRESS,
    PROP_KEYS.ANA_CONFIG,
    PROP_KEYS.ANA_QUEUE_CONFIG,
    PROP_KEYS.RAKUTEN_IMAGE_NORMALIZE_PROGRESS,
    PROP_KEYS.RAKUTEN_IMAGE_NORMALIZE_CONFIG,
    PROP_KEYS.RAKUTEN_IMAGE_NORMALIZE_QUEUE_CONFIG,
    PROP_KEYS.RAKUTEN_TEMPLATE_PROGRESS,
  ];
}

/**
 * リセット対象の進捗トリガー関数名を返す
 */
function getProgressTriggerNames_() {
  return [
    'runQueuedCollect',
    'resumeCollect',
    'runQueuedDifferenceCollect',
    'resumeDifferenceCollect',
    'runQueuedDistribute',
    'resumeDistribute',
    'runQueuedAnaDistribute',
    'resumeAnaDistribute',
    'runQueuedRakutenImageNormalization',
    'resumeRakutenImageNormalization',
    'resumeRakutenTemplateInjection',
  ];
}

/**
 * 進捗をリセットする
 */
function resetProgress() {
  var ui = SpreadsheetApp.getUi();
  var response = ui.alert(
    '確認',
    '進捗データと自動再開トリガーをすべて削除しますか？\n次回実行時は1行目から開始されます。',
    ui.ButtonSet.YES_NO
  );
  if (response !== ui.Button.YES) return;

  var props = PropertiesService.getScriptProperties();
  getProgressPropertyKeys_().forEach(function(key) {
    props.deleteProperty(key);
  });
  getProgressTriggerNames_().forEach(function(funcName) {
    deleteTriggersByFunction_(funcName);
  });

  updateDashboardStatus_('🔄 リセット済み');

  ui.alert('✅ 進捗をリセットしました。');
}

/**
 * 使い方ヘルプを表示する
 */
function showHelp() {
  var ui = SpreadsheetApp.getUi();
  ui.alert(
    '📷 佐渡市 画像集約・Choice配置ツール 使い方',
    '【=== 画像集約 ===】\n' +
    '1. 「⚙️ 初期設定」でsettingシートを作成\n' +
    '2. settingシートに統合先フォルダURLを入力\n' +
    '3. masterシートに管理番号とフォルダリンクを貼り付け\n' +
    '4. 「🔍 全行実行」で画像を統合フォルダにコピー\n\n' +
    '【=== Choice配置 ===】\n' +
    '1. choice_tsvシートにチョイスのTSVを貼り付け\n' +
    '2. 「📦 Choice配置 > 📋 ドライラン」でマッチング確認\n' +
    '3. 「📦 Choice配置 > 🚀 配置実行」でsetting指定容量にバッチ分割\n' +
    '4. 統合フォルダ内の batch_001〜 フォルダを確認\n' +
    '5. choice_tsv_batch_N シートのTSVをコピーして\n' +
    '   メモ帳に貼り付け → チョイスにアップロード\n\n' +
    '【タイムアウト対策】\n' +
    '27分経過で自動中断 → 1分後に自動再開されます。',
    ui.ButtonSet.OK
  );
}


// =========================================================================
// Choice配置ダイアログ
// =========================================================================

/**
 * Choice配置ドライランのダイアログを表示する
 */
function showChoiceDistDryRunDialog() {
  var ui = SpreadsheetApp.getUi();
  var validation = _validateChoicePreRequisites(ui);
  if (!validation) return;

  var html = HtmlService.createHtmlOutput(
    _buildChoiceDistDialogHtml(validation, true)
  ).setWidth(520).setHeight(450);
  ui.showModalDialog(html, '📋 Choice配置 ドライラン');
}

/**
 * Choice配置実行のダイアログを表示する
 */
function showChoiceDistDialog() {
  var ui = SpreadsheetApp.getUi();
  var validation = _validateChoicePreRequisites(ui);
  if (!validation) return;

  var html = HtmlService.createHtmlOutput(
    _buildChoiceDistDialogHtml(validation, false)
  ).setWidth(520).setHeight(450);
  ui.showModalDialog(html, '🚀 Choice配置 実行');
}

/**
 * Choice配置の前提条件チェック
 * @param {Object} ui - SpreadsheetApp.getUi()
 * @returns {?Object} { tsvRowCount, imageColCount, mgmtCodeFound } or null
 */
function _validateChoicePreRequisites(ui) {
  var validation;
  try {
    validation = validateChoicePreRequisitesReadOnly_();
  } catch (e) {
    ui.alert('エラー: ' + e.message);
    return null;
  }

  return {
    tsvRowCount: validation.tsvData.length - 1,
    imageColCount: validation.targetImageCols.length,
    batchSizeMB: validation.batchSizeMB,
    mgmtCodeFound: true,
  };
}

/**
 * Choice配置ダイアログのHTMLを構築する
 * @param {Object} validation - バリデーション結果
 * @param {boolean} isDryRun - ドライランかどうか
 * @returns {string} HTML文字列
 */
function _buildChoiceDistDialogHtml(validation, isDryRun) {
  var themeColor = isDryRun ? '#6B7280' : '#1a73e8';
  var batchSizeLabel = validation.batchSizeMB + 'MB';
  return buildGenericDialogHtml_({
    isDryRun: isDryRun,
    funcName: isDryRun ? 'startChoiceDryRun' : 'startChoiceDistribute',
    btnLabel: isDryRun ? '📋 ドライラン実行' : '🚀 配置実行',
    modeLabel: isDryRun ? '📋 ドライラン' : '🚀 配置実行',
    modeDesc: isDryRun
      ? 'コピーは行わず、マッチング結果とバッチ分割計画のみ表示します。'
      : '統合フォルダ内の画像をTSVの管理コードとマッチングし、\n' + batchSizeLabel + 'ごとにバッチフォルダに分割コピーします。',
    themeColor: themeColor,
    dataSectionTitle: '📊 TSVデータ',
    dataRows: [
      { label: 'データ行数', value: validation.tsvRowCount + '行' },
      { label: '管理コード', value: '✅ 検出済み', isCheck: true },
      { label: '画像カラム', value: validation.imageColCount + '列' }
    ],
    processSectionTitle: '⚙️ 処理内容',
    processRows: [
      '• 統合フォルダ内の画像ファイルをスキャン',
      '• ファイル名（管理コード_N.jpg）でTSVと照合',
      '• マッチした画像を' + batchSizeLabel + '単位でバッチ分割',
      '• バッチごとにサブフォルダ作成 & TSVシート生成'
    ],
    noteText: '📦 Choice上限80MB以内で、settingの' + batchSizeLabel + '設定により自動分割されます。'
  });
}

/**
 * ユーザーにバッチ番号を入力させ、ヘッダーを除いたTSVデータを取得してコピー用ダイアログを表示する
 */
function promptCopyBatchTsv() {
  var ui = SpreadsheetApp.getUi();
  var response = ui.prompt(
    '📋 バッチTSVコピー',
    'コピーしたいバッチ番号を入力してください（半角数字のみ）\n例: 1',
    ui.ButtonSet.OK_CANCEL
  );

  if (response.getSelectedButton() !== ui.Button.OK) return;

  var batchNumText = response.getResponseText().trim();
  if (!batchNumText || isNaN(batchNumText)) {
    ui.alert('エラー', '有効な数値を入力してください。', ui.ButtonSet.OK);
    return;
  }

  var batchNum = parseInt(batchNumText, 10);
  
  try {
    var tsvText = getBatchTsvText(batchNum);
    if (!tsvText) {
      ui.alert('エラー', 'バッチ ' + batchNum + ' のシート（またはデータ）が見つかりません。', ui.ButtonSet.OK);
      return;
    }
    
    showTsvCopyDialog_(tsvText, batchNum);
  } catch (e) {
    ui.alert('エラー', 'TSVデータの取得に失敗しました:\n' + e.message, ui.ButtonSet.OK);
  }
}

/**
 * コピー用のHTMLモーダルダイアログを表示する
 * @param {string} tsvText - TSVテキスト（ヘッダーなし）
 * @param {number} batchNum - バッチ番号
 */
function showTsvCopyDialog_(tsvText, batchNum) {
  var htmlTemplate = 
    '<style>' +
    'body { font-family: "Segoe UI", "Hiragino Sans", sans-serif; padding: 20px; color: #E5E7EB; background-color: #111827; margin: 0; }' +
    '.container { display: flex; flex-direction: column; height: 100%; }' +
    '.title { font-size: 16px; font-weight: bold; margin-bottom: 12px; color: #10B981; display: flex; align-items: center; gap: 8px; }' +
    '.desc { font-size: 12px; color: #9CA3AF; margin-bottom: 12px; }' +
    'textarea { flex-grow: 1; min-height: 220px; width: 100%; padding: 12px; font-family: Courier, monospace; font-size: 11px; color: #10B981; background-color: #1F2937; border: 1px solid #374151; border-radius: 8px; box-sizing: border-box; resize: none; outline: none; }' +
    'textarea:focus { border-color: #10B981; box-shadow: 0 0 0 2px rgba(16, 185, 129, 0.2); }' +
    '.footer { display: flex; justify-content: flex-end; gap: 12px; margin-top: 16px; }' +
    '.btn { padding: 10px 20px; border: none; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer; transition: all 0.2s ease; }' +
    '.btn-primary { background: linear-gradient(135deg, #10B981, #059669); color: white; box-shadow: 0 4px 6px rgba(16, 185, 129, 0.2); }' +
    '.btn-primary:hover { background: linear-gradient(135deg, #059669, #047857); transform: translateY(-1px); }' +
    '.btn-secondary { background: #374151; color: #D1D5DB; }' +
    '.btn-secondary:hover { background: #4B5563; }' +
    '.toast { position: fixed; bottom: 80px; left: 50%; transform: translateX(-50%) translateY(20px); opacity: 0; background: #059669; color: white; padding: 8px 16px; border-radius: 20px; font-size: 12px; font-weight: bold; transition: all 0.3s ease; pointer-events: none; }' +
    '.toast.show { opacity: 1; transform: translateX(-50%) translateY(0); }' +
    '</style>' +
    '<div class="container">' +
    '  <div class="title">📋 バッチ ' + batchNum + ' TSVコピー（ヘッダー除外）</div>' +
    '  <div class="desc">以下のテキストエリアをコピーしてメモ帳などに貼り付けてください。下のボタンからワンクリックでコピーできます。</div>' +
    '  <textarea id="tsvArea" readonly>' + tsvText.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</textarea>' +
    '  <div class="footer">' +
    '    <button class="btn btn-secondary" onclick="google.script.host.close()">閉じる</button>' +
    '    <button class="btn btn-primary" id="copyBtn" onclick="copyTsv()">📋 コピーする</button>' +
    '  </div>' +
    '</div>' +
    '<div id="toast" class="toast">✅ クリップボードにコピーしました！</div>' +
    '<script>' +
    'function copyTsv() {' +
    '  var textArea = document.getElementById("tsvArea");' +
    '  textArea.select();' +
    '  try {' +
    '    var successful = document.execCommand("copy");' +
    '    if (successful) {' +
    '      showToast();' +
    '      setTimeout(function() { google.script.host.close(); }, 1200);' +
    '    } else {' +
    '      alert("コピーに失敗しました。手動で選択してコピーしてください。");' +
    '    }' +
    '  } catch (err) {' +
    '    alert("お使いのブラウザは自動コピーをサポートしていません。手動でコピーしてください。");' +
    '  }' +
    '}' +
    'function showToast() {' +
    '  var toast = document.getElementById("toast");' +
    '  toast.className = "toast show";' +
    '}' +
    '</script>';

  var htmlOutput = HtmlService.createHtmlOutput(htmlTemplate)
    .setWidth(550)
    .setHeight(420);
  
  SpreadsheetApp.getUi().showModalDialog(htmlOutput, '📋 TSVデータコピー — バッチ ' + batchNum);
}

// =========================================================================
//  ANA配置ダイアログ
// =========================================================================

/**
 * ANA配置ドライランのダイアログを表示
 */
function showAnaDistDryRunDialog() {
  var ui = SpreadsheetApp.getUi();
  var validation = _validateAnaPreRequisites(ui);
  if (!validation) return;

  var html = HtmlService.createHtmlOutput(
    _buildAnaDistDialogHtml(validation, true)
  ).setWidth(520).setHeight(450);
  ui.showModalDialog(html, '📋 ANA配置 ドライラン');
}

/**
 * ANA配置実行のダイアログを表示
 */
function showAnaDistDialog() {
  var ui = SpreadsheetApp.getUi();
  var validation = _validateAnaPreRequisites(ui);
  if (!validation) return;

  var html = HtmlService.createHtmlOutput(
    _buildAnaDistDialogHtml(validation, false)
  ).setWidth(520).setHeight(450);
  ui.showModalDialog(html, '🚀 ANA配置 実行');
}

/**
 * ANA配置の前提条件チェック
 * @param {Object} ui 
 * @returns {?Object}
 */
function _validateAnaPreRequisites(ui) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  // 統合先フォルダURL
  var destFolderUrl = getSettingValue_(SETTING_KEYS.DEST_FOLDER_URL);
  if (!destFolderUrl) {
    ui.alert('エラー: settingシートに「' + SETTING_KEYS.DEST_FOLDER_URL + '」が設定されていません。');
    return null;
  }

  // ana_csvシート
  var sheet = ss.getSheetByName(SHEET_NAMES.ANA_CSV);
  if (!sheet) {
    ui.alert('エラー: 「' + SHEET_NAMES.ANA_CSV + '」シートが見つかりません。初期セットアップを先に実行してください。');
    return null;
  }

  var lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    ui.alert('エラー: ana_csvシートにデータ行がありません。');
    return null;
  }

  // 備考(内部用)の列を特定
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var colMap = createColumnMap_(headers);
  var colBiko = colMap['備考(内部用)'];

  if (colBiko === undefined) {
    ui.alert('エラー: ana_csvシートに「備考(内部用)」列が見つかりません。');
    return null;
  }

  return {
    tsvRowCount: lastRow - 1,
    colBiko: colBiko
  };
}

/**
 * ANA配置用ダイアログHTML
 */
function _buildAnaDistDialogHtml(validation, isDryRun) {
  var themeColor = isDryRun ? '#6B7280' : '#37474F';
  return buildGenericDialogHtml_({
    isDryRun: isDryRun,
    funcName: isDryRun ? 'startAnaDryRun' : 'startAnaDistribute',
    btnLabel: isDryRun ? '📋 ドライラン実行' : '🚀 配置実行',
    modeLabel: isDryRun ? '📋 ドライラン (ANA)' : '🚀 配置実行 (ANA)',
    modeDesc: isDryRun
      ? 'コピーは行わず、マッチング結果とバッチ分割計画のみ表示します。'
      : '統合フォルダ内の画像をANAシートの管理コードと照合し、\n50MB（または指定サイズ）ごとにバッチフォルダに分割コピーします。',
    themeColor: themeColor,
    bgColor: '#263238',
    textColor: '#E0F2F1',
    titleColor: '#80CBC4',
    labelColor: '#B2DFDB',
    noteBg: '#37474F',
    noteColor: '#B2DFDB',
    btnPrimaryBg: 'linear-gradient(135deg, #00897B, #004D40)',
    btnSecondaryBg: '#37474F',
    btnSecondaryColor: '#ECEFF1',
    dataSectionTitle: '📊 CSVデータ',
    dataRows: [
      { label: 'データ行数', value: validation.tsvRowCount + '行' },
      { label: '備考(内部用)', value: '✅ 検出済み', isCheck: true }
    ],
    processSectionTitle: '⚙️ 処理内容',
    processRows: [
      '• 統合フォルダ内の画像ファイルをスキャン',
      '• ファイル名（管理コード_N.jpg）でCSVと照合',
      '• 画像を指定バッチサイズ（例: 50MB）に分割',
      '• バッチごとにサブフォルダ（img/goods/...）に分割コピー'
    ],
    noteText: '📦 S/L/1/2/3/4/5/D9/D10 のANA指定フォルダ構成へ自動的にリネームしてコピーされます。'
  });
}

/**
 * ANA配置ダッシュボードにジャンプ
 */
function showAnaDashboard() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAMES.ANA_DASHBOARD);
  if (!sheet) {
    SpreadsheetApp.getUi().alert('ANA画像配置ダッシュボードはまだ作成されていません。\n画像配置を実行すると自動的に作成されます。');
    return;
  }
  sheet.activate();
}

/**
 * 楽天ダッシュボードにジャンプ
 */
function showRakutenDashboard() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAMES.RAKUTEN_DASHBOARD);
  if (!sheet) {
    SpreadsheetApp.getUi().alert('楽天ダッシュボードはまだ作成されていません。\n初期セットアップを実行してください。');
    return;
  }
  sheet.activate();
}

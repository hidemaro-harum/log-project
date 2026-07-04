/**
 * ==============================================================================
 * 設定定数 (Config.js)
 * 佐渡市 画像集約・Choice/楽天/ANA配置ツール共通の設定値を一元管理
 * ==============================================================================
 */

/** シート名定数 */
var SHEET_NAMES = {
  SETTING: 'setting',
  MASTER: 'master',
  DASHBOARD: 'dashboard',
  CHOICE_TSV: 'choice_tsv',
  CHOICE_DASHBOARD: 'choice_dashboard',
  ANA_CSV: 'ana_csv',
  ANA_DASHBOARD: 'ana_dashboard',
  RAKUTEN_CSV: 'rakuten_csv',
  RAKUTEN_DASHBOARD: 'rakuten_dashboard',
  RAKUTEN_TEMPLATE: 'rakuten_template',
  RAKUTEN_IMAGE_LIST: 'rakuten_image_list',
  RAKUTEN_IMAGE_PATHS: 'rakuten_image_paths',
  RAKUTEN_IMAGE_FOLDERS: 'rakuten_image_folders',
  RAKUTEN_IMAGE_GRID: 'rakuten_image_grid',
  RAKUTEN_IMAGE_MAPPING: 'rakuten_image_mapping',
  RAKUTEN_DRIVE_FILES: 'rakuten_drive_files',
  RAKUTEN_UPLOAD_LOG: 'rakuten_upload_log',
  RAKUTEN_FAILED_FILES: 'rakuten_failed_files',
  RAKUTEN_IMAGE_CONVERT_DASHBOARD: 'rakuten_image_convert_dashboard',
  EXECUTION_HISTORY: 'execution_history',
  NUMBER_MAPPING: 'number_mapping',
  NUMBER_MIGRATION_DASHBOARD: 'number_migration_dashboard',
};

/** settingシートのキー定義 */
var SETTING_KEYS = {
  DEST_FOLDER_URL: '統合先フォルダURL',
  DIFF_DEST_FOLDER_URL: '差分画像保存先フォルダURL',
  NOTIFICATION_EMAIL: '通知先メールアドレス',
  
  // Choice設定
  CHOICE_MGMT_CODE_COL: 'Choice管理コードカラム名',
  CHOICE_IMAGE_COLS: 'Choice画像カラム名リスト',
  CHOICE_DEST_FOLDER_URL: 'Choice出力先フォルダURL',
  CHOICE_BATCH_SIZE_MB: 'Choiceバッチサイズ(MB)',
  CHOICE_MAIN_IMAGE_COL: 'Choiceお礼の品画像カラム名',
  
  // ANA設定
  ANA_DEST_FOLDER_URL: 'ANA出力先フォルダURL',
  ANA_BATCH_SIZE_MB: 'ANA画像バッチサイズ(MB)',
  
  // 楽天設定
  RAKUTEN_DEST_FOLDER_URL: '楽天出力先フォルダURL',
  RAKUTEN_IMAGE_SOURCE_FOLDER_URL: '楽天画像変換元フォルダURL',
  RAKUTEN_IMAGE_DEST_FOLDER_URL: '楽天画像変換先フォルダURL',
  RAKUTEN_SHOP_ID: '楽天店舗ID',
  RAKUTEN_API_SERVICE_SECRET: '楽天RMSサービスシークレット',
  RAKUTEN_API_LICENSE_KEY: '楽天RMSライセンスキー',
  RAKUTEN_CABINET_FOLDER_ID: '楽天CabinetフォルダID',
};

/** masterシートのカラム定義 */
var MASTER_COLUMNS = {
  MGMT_CODE: '管理番号',
  FOLDER_LINK: 'フォルダリンク',
};

/** Choice TSVのカラム定義 */
var CHOICE_COLUMNS = {
  MGMT_CODE: '管理コード',
  IMAGE_COLS: [
    'スライド画像1', 'スライド画像2', 'スライド画像3', 'スライド画像4',
    'スライド画像5', 'スライド画像6', 'スライド画像7', 'スライド画像8',
    '品梱包画像',
  ],
};

/** Choice設定定数 */
var CHOICE_CONFIG = {
  DEFAULT_BATCH_SIZE_MB: 70,
  MAX_BATCH_SIZE_MB: 80,
};

/** ANA設定定数 */
var ANA_CONFIG = {
  DEFAULT_BATCH_SIZE_MB: 50,
  MAX_TARGETS_PER_BATCH: 100,
  IMAGE_SUBFOLDER_MAP: {
    '1': ['S', 'L'],  // _1はSとLに両方コピー
    '2': ['1'],
    '3': ['2'],
    '4': ['3'],
    '5': ['4'],
    '6': ['5'],
    '7': ['D9'],
    '8': ['D10'],
  },
  IMAGE_NUMBER_MAP: {
    '1': ['S画像ファイル', 'Ｌ画像ファイル'],
    '2': ['１画像ファイル'],
    '3': ['２画像ファイル'],
    '4': ['３画像ファイル'],
    '5': ['４画像ファイル'],
    '6': ['５画像ファイル'],
    '7': ['D9画像ファイル'],
    '8': ['D10画像ファイル'],
  }
};

/** 楽天設定定数 */
var RAKUTEN_CONFIG = {
  IMAGE_SLOT_COUNT: 20,
  SHEETS_CELL_MAX_CHARACTERS: 50000,
  COL_RAKUTEN: {
    PRODUCT_MGMT_NUM: 1,    // 商品管理番号（商品URL）
    PRODUCT_NUM:      2,    // 商品番号（商品レベル行のみ）
    PRODUCT_NAME:     3,    // 商品名（商品レベル行のみに存在）
    CATCH_COPY:       9,    // キャッチコピー（商品レベル行のみ）
    PC_DESC:          10,   // PC用商品説明文
    SP_DESC:          11,   // スマートフォン用商品説明文
    PC_SALES_DESC:    12,   // PC用販売説明文
    SKU_MGMT_NUM:     94,   // SKU管理番号
    SYSTEM_SKU_NUM:   95,   // システム連携用SKU番号
    NORMAL_PRICE:     98,   // 通常購入販売価格（SKUレベル行）
    STOCK:            99,   // 在庫数（SKUレベル行）
  },
  COL_CHOICE: {
    PRODUCT_NAME:    3,     // （必須）お礼の品名
    PROVIDER_NAME:   5,     // サイト表示事業者名
    DONATION_AMOUNT: 6,     // （条件付き必須）必要寄付金額
    DESCRIPTION:     8,     // 説明
    CATCH_COPY:      9,     // キャッチコピー
    CAPACITY:        10,    // 容量
    SHIPPING_DATE:   13,    // 発送期日
    EXPIRATION:      45,    // 消費期限
    NORMAL_TEMP:     47,    // （必須）常温配送
    COLD_TEMP:       48,    // （必須）冷蔵配送
    FROZEN_TEMP:     49,    // （必須）冷凍配送
    MANAGEMENT_CODE: 103,   // 管理コード
    LINKAGE_CODE:    104,   // 連携コード
  },
  TEMPLATE_KEYS: {
    PC_DESC:    'TEMPLATE_PC_DESC',
    SP_DESC:    'TEMPLATE_SP_DESC',
    PC_SALES:   'TEMPLATE_PC_SALES',
  },
  TEMPLATE_KEY_COL: 1,
  TEMPLATE_VALUE_COL: 2,
};

/** 楽天HTMLテンプレート差込の再開設定 */
var RAKUTEN_TEMPLATE_CONFIG_ = {
  BATCH_PRODUCTS: 200,
  TIME_LIMIT_MS: 25 * 60 * 1000,
  RESUME_DELAY_MS: 60 * 1000,
};

/** バッチ分割設定 */
var BATCH_CONFIG = {
  BATCH_FOLDER_PREFIX: 'batch_',           // サブフォルダ接頭辞
};

/** 実行設定 */
var EXEC_CONFIG = {
  TIME_LIMIT_MS: 27 * 60 * 1000,       // 27分（30分制限の安全マージン）
  RESUME_DELAY_MS: 60 * 1000,           // 1分後に再開
  DASHBOARD_BATCH_UPDATE: 10,           // N行ごとにダッシュボード更新
};

/** PropertiesServiceキー */
var PROP_KEYS = {
  PROGRESS: 'IMG_COLLECT_PROGRESS',
  CONFIG: 'IMG_COLLECT_CONFIG',
  QUEUE_CONFIG: 'IMG_COLLECT_QUEUE_CONFIG',

  DIFF_PROGRESS: 'IMG_DIFF_PROGRESS',
  DIFF_CONFIG: 'IMG_DIFF_CONFIG',
  DIFF_QUEUE_CONFIG: 'IMG_DIFF_QUEUE_CONFIG',
  
  // Choice用
  DIST_PROGRESS: 'CHOICE_DIST_PROGRESS',
  DIST_CONFIG: 'CHOICE_DIST_CONFIG',
  DIST_QUEUE_CONFIG: 'CHOICE_DIST_QUEUE_CONFIG',
  
  // ANA用
  ANA_PROGRESS: 'ANA_DIST_PROGRESS',
  ANA_CONFIG: 'ANA_DIST_CONFIG',
  ANA_QUEUE_CONFIG: 'ANA_DIST_QUEUE_CONFIG',

  // 楽天画像変換用
  RAKUTEN_IMAGE_NORMALIZE_PROGRESS: 'RAKUTEN_IMAGE_NORMALIZE_PROGRESS',
  RAKUTEN_IMAGE_NORMALIZE_CONFIG: 'RAKUTEN_IMAGE_NORMALIZE_CONFIG',
  RAKUTEN_IMAGE_NORMALIZE_QUEUE_CONFIG: 'RAKUTEN_IMAGE_NORMALIZE_QUEUE_CONFIG',
  
  // 楽天用
  RAKUTEN_PROGRESS: 'RAKUTEN_DIST_PROGRESS',
  RAKUTEN_CONFIG: 'RAKUTEN_DIST_CONFIG',
  RAKUTEN_QUEUE_CONFIG: 'RAKUTEN_DIST_QUEUE_CONFIG',
  RAKUTEN_LAST_TEMPLATE_ERRORS: 'RAKUTEN_LAST_TEMPLATE_ERRORS',
  RAKUTEN_LAST_SKU_IMAGE_ERRORS: 'RAKUTEN_LAST_SKU_IMAGE_ERRORS',
  RAKUTEN_TEMPLATE_PROGRESS: 'RAKUTEN_TEMPLATE_PROGRESS',
};

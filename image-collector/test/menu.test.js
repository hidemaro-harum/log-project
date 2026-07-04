const test = require('node:test');
const assert = require('node:assert/strict');
const { loadGas } = require('./load-gas');

function createMenuRecorder(name) {
  return {
    name,
    entries: [],
    addItem(label, handler) {
      this.entries.push({ type: 'item', label, handler });
      return this;
    },
    addSubMenu(menu) {
      this.entries.push({ type: 'submenu', menu });
      return this;
    },
    addSeparator() {
      this.entries.push({ type: 'separator' });
      return this;
    },
    addToUi() {
      this.addedToUi = true;
      return this;
    },
  };
}

test('number migration menu exposes callable actions in execution order', () => {
  const menus = [];
  const ui = {
    createMenu(name) {
      const menu = createMenuRecorder(name);
      menus.push(menu);
      return menu;
    },
  };
  const gas = loadGas([
    'src/Config.js',
    'src/NumberMigration.js',
    'src/FtpFailedImageCopy.js',
    'src/Menu.js',
  ], {
    SpreadsheetApp: { getUi: () => ui },
  });

  gas.onOpen();

  const rootMenu = menus.find((menu) => menu.name === '📷 画像集約');
  assert.ok(rootMenu, '画像集約ルートメニューが見つかりません');
  const numberMigrationMenu = menus.find((menu) => menu.name === '🔄 番号移行');
  assert.ok(numberMigrationMenu, '番号移行サブメニューが見つかりません');
  assert.ok(
    rootMenu.entries.some(
      (entry) => entry.type === 'submenu' && entry.menu === numberMigrationMenu
    ),
    '番号移行メニューが画像集約ルートメニューに接続されていません'
  );
  assert.equal(rootMenu.addedToUi, true, '画像集約ルートメニューがUIに追加されていません');
  const items = numberMigrationMenu.entries
    .filter((entry) => entry.type === 'item')
    .map((entry) => [entry.label, entry.handler]);
  assert.deepEqual(items, [
    ['① 楽天CSVから対照表を補完', 'autoFillNumberMappingFromRakuten'],
    ['② 対照表を検証', 'validateNumberMapping'],
    ['③ 楽天ドライラン', 'dryRunRakutenNumberMigration'],
    ['④ 楽天変換実行', 'executeRakutenNumberMigration'],
    ['⑤ 楽天CSVをダウンロード', 'downloadRakutenMigrationCsv'],
    ['⑥ ANAドライラン', 'dryRunAnaNumberMigration'],
    ['⑦ ANA備考反映実行', 'executeAnaNumberMigration'],
    ['⑧ 番号移行ダッシュボード', 'showNumberMigrationDashboard'],
  ]);
  for (const [, handler] of items) {
    assert.equal(typeof gas[handler], 'function', `メニューハンドラ ${handler} が未定義です`);
  }

  const differenceMenu = menus.find((menu) => menu.name === '🆕 画像差分抽出');
  assert.ok(differenceMenu, '画像差分抽出サブメニューが見つかりません');
  assert.deepEqual(
    differenceMenu.entries.filter((entry) => entry.type === 'item').map((entry) => [entry.label, entry.handler]),
    [
      ['📋 差分抽出 ドライラン', 'showDifferenceDryRunDialog'],
      ['🚀 差分抽出 実行', 'showDifferenceCollectDialog'],
    ]
  );

  const rakutenMenu = menus.find((menu) => menu.name === '📦 楽天配置');
  assert.ok(rakutenMenu, '楽天配置サブメニューが見つかりません');
  assert.ok(
    rakutenMenu.entries.some(
      (entry) => entry.type === 'item' &&
        entry.label === '⑩ FTP失敗画像コピー' &&
        entry.handler === 'copyFtpFailedImages'
    ),
    'FTP失敗画像コピーのメニュー項目が見つかりません'
  );
  assert.equal(typeof gas.copyFtpFailedImages, 'function', 'FTP失敗画像コピーのハンドラが未定義です');
});

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadGas } = require('./load-gas');

function plain(value) { return JSON.parse(JSON.stringify(value)); }

test('getFtpFailedImageHeaders_ returns the sheet contract', () => {
  const gas = loadGas(['src/Config.js', 'src/FtpFailedImageCopy.js']);
  assert.deepEqual(plain(gas.getFtpFailedImageHeaders_()), [
    'ファイル名',
    'ステータス',
    'コピー先URL',
    '備考',
  ]);
});

test('buildFtpFailedImageCopyPlan_ matches failed file names case-insensitively', () => {
  const gas = loadGas(['src/Config.js', 'src/FtpFailedImageCopy.js']);
  const plan = plain(gas.buildFtpFailedImageCopyPlan_(
    ['195975-0036_1.jpg', '195979-0006_3.JPG', 'exists.jpg', 'missing.jpg', 'note.txt', '195975-0036_1.jpg', ''],
    [
      { name: '195975-0036_1.jpg', mimeType: 'image/jpeg' },
      { name: '195979-0006_3.jpg', mimeType: 'image/jpeg' },
      { name: 'exists.jpg', mimeType: 'image/jpeg' },
      { name: 'note.txt', mimeType: 'text/plain' },
    ],
    { 'exists.jpg': true }
  ));

  assert.deepEqual(plan.rows, [
    { fileName: '195975-0036_1.jpg', status: 'コピー対象', destinationUrl: '', note: 'コピーできます' },
    { fileName: '195979-0006_3.JPG', status: 'コピー対象', destinationUrl: '', note: 'コピーできます' },
    { fileName: 'exists.jpg', status: 'コピー先に存在', destinationUrl: '', note: '同名ファイルがコピー先にあります' },
    { fileName: 'missing.jpg', status: '未検出', destinationUrl: '', note: 'コピー元フォルダに同名ファイルがありません' },
    { fileName: 'note.txt', status: '画像以外', destinationUrl: '', note: 'MIMEタイプ: text/plain' },
    { fileName: '195975-0036_1.jpg', status: '重複指定', destinationUrl: '', note: '同じファイル名が上の行で指定されています' },
    { fileName: '', status: 'スキップ', destinationUrl: '', note: 'ファイル名が空です' },
  ]);
  assert.deepEqual(plan.copyTasks.map((task) => task.requestedName), [
    '195975-0036_1.jpg',
    '195979-0006_3.JPG',
  ]);
});

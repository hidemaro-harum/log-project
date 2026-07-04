# Rakuten Image Normalization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Driveフォルダ直下の楽天画像を、元画像を保持して小文字名・JPEG・最大辺3840px・2MB未満へ安全にコピーする。

**Architecture:** 純粋な計画生成とDrive副作用を`RakutenImageNormalizer.js`へ分離する。Advanced Drive Serviceで画像メタデータとサムネイルURLを取得し、ドライランと本実行が同じ計画を使用する。実行状態はScript Properties、結果は専用ダッシュボードへ保存する。

**Tech Stack:** Google Apps Script V8、Advanced Drive Service v3、UrlFetchApp、Google Sheets、Node.js `node:test`、clasp

---

### Task 1: 設定・メニュー・シート定義

**Files:**
- Modify: `src/Config.js`
- Modify: `src/Menu.js`
- Modify: `src/appsscript.json`
- Test: `test/setup-columns.test.js`
- Test: `test/reset-progress.test.js`

- [ ] 新設定2件、専用ダッシュボード名、進捗プロパティ3件を期待する失敗テストを書く。
- [ ] `node --test test/setup-columns.test.js test/reset-progress.test.js`で失敗を確認する。
- [ ] `楽天画像変換元フォルダURL`、`楽天画像変換先フォルダURL`、`rakuten_image_convert_dashboard`、キュー・進捗・設定キーを追加する。
- [ ] Advanced Drive Service v3を`appsscript.json`へ追加する。
- [ ] 楽天配置メニューへドライラン、実行、ダッシュボードを追加する。
- [ ] 対象テストを通す。

### Task 2: 変換計画の純粋ロジック

**Files:**
- Create: `src/RakutenImageNormalizer.js`
- Create: `test/rakuten-image-normalizer.test.js`

- [ ] `.JPG`、`.JPEG`、PNG、WebP、GIF、2MB境界、3840px境界、変換元衝突、変換先衝突の失敗テストを書く。
- [ ] `node --test test/rakuten-image-normalizer.test.js`で未定義失敗を確認する。
- [ ] 次の純粋関数を実装する。

```js
normalizeRakutenImageOutputName_(name, mimeType)
needsRakutenImageOptimization_(size, width, height)
buildRakutenImageNormalizationPlan_(sourceFiles, destinationNames)
buildRakutenResizeCandidates_(width, height)
```

- [ ] 衝突ファイルだけを`collision`、非対応形式を`error`、それ以外を`ready`にし、他ファイルを残す。
- [ ] 純粋ロジックのテストを通す。

### Task 3: Drive変換とサイズ制御

**Files:**
- Modify: `src/RakutenImageNormalizer.js`
- Modify: `test/rakuten-image-normalizer.test.js`

- [ ] JPEGの無変換コピー、サムネイル段階縮小、2MB未満採用、変換失敗のテストを書く。
- [ ] 失敗を確認する。
- [ ] `Drive.Files.list`で直下画像メタデータをページング取得する。
- [ ] JPEGかつ最適化不要なら`makeCopy(outputName, destination)`を使う。
- [ ] 変換対象は3840、3200、2560、2048、1600、1280、1024px候補を順に取得し、最初の2MB未満JPEG Blobを採用する。
- [ ] サムネイル取得失敗または全候補2MB以上を明示エラーにする。
- [ ] 対象テストを通す。

### Task 4: ドライラン・本実行・自動再開

**Files:**
- Modify: `src/RakutenImageNormalizer.js`
- Modify: `src/Menu.js`
- Modify: `test/rakuten-image-normalizer.test.js`

- [ ] 同一フォルダ拒否、ドライラン無書込、衝突継続、25分中断、再開位置保存の失敗テストを書く。
- [ ] 失敗を確認する。
- [ ] 読み取り専用の前提検証、ドライラン入口、時間主導キュー、本実行、再開関数を実装する。
- [ ] 画像1件ごとに時間確認し、進捗と統計を保存して約1分後に再開する。
- [ ] 完了・異常終了を履歴とメール通知へ接続する。
- [ ] 対象テストを通す。

### Task 5: 専用ダッシュボード

**Files:**
- Modify: `src/RakutenImageNormalizer.js`
- Modify: `test/rakuten-image-normalizer.test.js`
- Modify: `README.md`

- [ ] サマリー9項目と明細9列の失敗テストを書く。
- [ ] 失敗を確認する。
- [ ] `initDashboardGeneric_`、`updateDashboardStatsGeneric_`、`addDashboardRowGeneric_`を利用した専用関数を実装する。
- [ ] ドライラン、本実行、再開待ち、完了、完了（エラーあり）、異常終了を表示する。
- [ ] READMEへ設定と操作手順を追加し、対象テストを通す。

### Task 6: 全体検証と反映

**Files:**
- Verify: `src/*.js`
- Verify: `test/*.test.js`
- Deploy: `.clasp.json`

- [ ] `for f in src/*.js; do node --check "$f"; done`を実行しexit 0を確認する。
- [ ] `node --test test/*.test.js`を実行しfailure 0を確認する。
- [ ] `.clasp.json`の佐渡市Script IDを確認する。
- [ ] `clasp push`で反映する。
- [ ] ユーザーへ初期設定（差分更新）、ドライラン、本実行、ダッシュボード確認の順を報告する。


# 楽天番号移行CSV 直接再構築 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ④で`number_mapping`対象商品だけを新番号へ変換して`rakuten_csv`へ直接書き戻し、⑤で同シートを確認・ダウンロードできるようにする。

**Architecture:** 商品ブロック抽出を副作用のない投影関数へ分離し、③・④・⑤で同じ対象判定を共有する。④だけがロック取得後にコンパクトバックアップ、既存範囲消去、対象データ書戻し、再検証を行い、ANAの既存列更新経路は維持する。

**Tech Stack:** Google Apps Script V8、Google Sheets、Node.js `node:test`、既存Shift-JISダウンロード処理。

**Note:** Git管理外のためコミットは行わず、最終検証後に`clasp push --force`する。

---

### Task 1: 商品ブロック投影と集計

**Files:**
- Modify: `src/NumberMigration.js`
- Test: `test/number-migration.test.js`

- [ ] 対象・対象外の商品が混在するfixtureで、ヘッダー、対象ブロック全行、元行インデックスを保持し、残存・除外の商品数と行数を返す失敗テストを書く。
- [ ] 商品名なし、選択肢行、マルチSKU、空行、任意列、重複URL、対照表URL欠落を含む失敗テストを書く。
- [ ] `buildRakutenMigrationTargetProjection_(data, mapping)`を実装する。戻り値は`data`、`sourceRowIndices`、`errors`、`retainedProductCount`、`retainedRowCount`、`excludedProductCount`、`excludedRowCount`とする。
- [ ] 既存`buildRakutenMigrationTargetCsv_`を投影関数＋変換済み検証の薄いラッパーへ変更し、既存テストを維持する。
- [ ] `node --test --test-name-pattern='RakutenMigrationTarget' test/number-migration.test.js`でRED→GREENを確認する。

### Task 2: ③の再構築ドライラン計画

**Files:**
- Modify: `src/NumberMigration.js`
- Test: `test/number-migration.test.js`

- [ ] `planRakutenInPlaceMigration_(data, mapping)`の失敗テストを書く。対象ブロックだけに番号変更を適用した`outputData`と、残存・除外集計を返し、入力を変更しないことを検証する。
- [ ] 変更の`row`は元CSV行、`rowIndex`は出力先行として保持し、バックアップと書戻しの双方で利用できるテストを追加する。
- [ ] 投影結果へ`planRakutenNumberMigration_`を適用し、変更を複製データへ反映する実装を追加する。
- [ ] `createNumberMigrationPlan_('楽天', ...)`を新計画へ接続し、ANAは既存`planAnaNumberMigration_`のまま維持する。
- [ ] `buildMigrationDashboardData_`と③完了メッセージへ、残す商品・行、除外商品・行を追加する。
- [ ] 対象外商品がエラーにならず除外件数へ入り、対象商品のSKU不足はエラーのままになることを確認する。

### Task 3: ④の`rakuten_csv`直接再構築

**Files:**
- Modify: `src/NumberMigration.js`
- Test: `test/number-migration.test.js`

- [ ] `rewriteRakutenCsvInPlace_(sheet, originalData, outputData)`の失敗テストを書く。既存データ範囲を空欄化した後、ヘッダー＋対象データを先頭へ書き、末尾の旧データが残らないことを検証する。
- [ ] 書込み失敗時に「楽天CSV再構築」段階を含むエラーになるテストを書く。
- [ ] 楽天④では列更新の`applyMigrationChanges_`を使わず、コンパクトバックアップ後に`outputData`を一括書戻しする。
- [ ] 確認ダイアログへ変更件数、残す商品・行、除外商品・行を表示する。
- [ ] ダイアログ前はロックを保持せず、YES後にScriptLockを取得してCSV・対照表・ドライラン署名を再確認する。
- [ ] ロック競合、確認中のデータ変更、バックアップ失敗、書込み失敗でCSVを変更しないテストを追加する。
- [ ] 書戻し後に再読込し、エラー0、変更0、除外0、出力行数一致を検証してからドライラン署名を削除する。
- [ ] ANA④が従来どおり対象列だけを更新する回帰テストを維持する。

### Task 4: ⑤の直接ダウンロードと旧プレビュー廃止

**Files:**
- Modify: `src/Config.js`
- Modify: `src/NumberMigration.js`
- Modify: `src/Menu.js`
- Modify: `README.md`
- Test: `test/menu.test.js`
- Test: `test/number-migration.test.js`

- [ ] ⑤が`rakuten_csv`だけを読み、現在の`number_mapping`と照合してShift-JISの`normal-item.csv`を出力する失敗テストを書く。
- [ ] 確認中にCSVまたは対照表が変化した場合、再読込比較でダウンロードを止めるテストを書く。
- [ ] `downloadRakutenMigrationCsv()`の参照先を`rakuten_csv`へ変更し、全商品が現在の対照表対象かつ変換済みであることを検証する。
- [ ] `generateRakutenMigrationCsv()`、確認用シート生成・消去ヘルパー、`RAKUTEN_MIGRATION_CSV`定数と専用テストを削除する。
- [ ] 番号移行メニューを⑤楽天CSVダウンロード、⑥ANAドライラン、⑦ANA実行、⑧ダッシュボードへ更新する。
- [ ] READMEを直接再構築フロー、外部コピー前提、コンパクトバックアップ、対象外行の空欄化へ更新する。

### Task 5: 全体レビュー・検証・push

**Files:**
- Review: `src/Config.js`
- Review: `src/NumberMigration.js`
- Review: `src/Menu.js`
- Review: `README.md`
- Review: `test/*.test.js`

- [ ] 仕様レビューで、対象判定、集計、直接再構築、再検証、ダウンロード元、ANA非回帰を確認する。
- [ ] 品質レビューで、ロック、確認中変更、末尾データ消去、セル上限、GAS V8互換性を確認する。
- [ ] 全テストと構文確認を実行する。

```bash
node --test test/*.test.js
for f in src/*.js test/*.js; do node --check "$f" || exit 1; done
```

- [ ] `.clasp.json`のscriptIdとparentIdを確認し、pushする。

```bash
cat .clasp.json
npx --yes @google/clasp push --force
```


# Choice Packing Image Fallback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Choiceの`_9`画像がない商品へ共通画像`Sado,_Niigata.jpg`を設定し、各バッチへ安全にコピーする。

**Architecture:** `Distributor.js`へ管理コード別の画像マッチ計画を作る純粋関数を追加し、既存のDriveスキャン結果から`_9`優先・共通画像フォールバックを判定する。共通画像欠落はバッチ分割前に停止し、既存のコピー重複回避とTSV画像番号マッピングを再利用する。

**Tech Stack:** Google Apps Script V8、Node.js `node:test`、clasp

---

### Task 1: 画像マッチ計画

**Files:**
- Modify: `test/choice-batches.test.js`
- Modify: `src/Distributor.js`

- [x] **Step 1: `_9`優先とフォールバックの失敗テストを書く**

`buildChoiceImageMatch_(mgmtCode, fileMap, imageCount, fallbackName)`について、`code_9.jpg`があれば固有画像を使い、なければ`Sado,_Niigata.jpg`を`imageNum: 9`で返すテストを追加する。

- [x] **Step 2: REDを確認する**

Run: `node --test test/choice-batches.test.js`

Expected: `buildChoiceImageMatch_ is not a function`

- [x] **Step 3: 純粋関数を実装する**

```javascript
function buildChoiceImageMatch_(mgmtCode, fileMap, imageCount, fallbackName) {
  // _1.._9を既存の前方一致規則で検索
  // _9がなければfallbackNameをcase-insensitiveで検索
  // { files, usedFallback, error }を返す
}
```

共通画像だけで未マッチ管理コードをマッチ扱いにしない。`_1`から`_8`のいずれかがある商品だけフォールバック対象にする。

- [x] **Step 4: 共通画像欠落と未マッチ維持のテストを書く**

商品画像はあるが共通画像がない場合は`error`、商品画像が一枚もない場合はフォールバックせず`files: []`になることを検証する。

- [x] **Step 5: 対象テストを通す**

Run: `node --test test/choice-batches.test.js`

Expected: 全テストPASS

### Task 2: Choice実行フローへの接続

**Files:**
- Modify: `src/Distributor.js`
- Modify: `test/choice-batches.test.js`

- [x] **Step 1: TSV生成のフォールバック失敗テストを書く**

`_generateBatchTsvSheet`へ`imageNum: 9`の共通画像を渡し、`品梱包画像`が`Sado,_Niigata.jpg`、`お礼の品画像`が従来の`_1`になることを検証する。

- [x] **Step 2: 行マッチングを純粋関数へ置換する**

各`choice_tsv`行で`buildChoiceImageMatch_`を呼び、`usedFallback`件数とエラーを集計する。エラーが1件でもあれば`notifyMessage_`で理由を表示し、`_splitIntoBatches`より前にreturnする。

- [x] **Step 3: ドライランと完了表示を更新する**

ドライランおよび本実行のサマリーへ`品梱包画像フォールバック: N品`を追加する。共通画像は既存の`batchExistingFiles`判定により各バッチ1ファイルだけコピーする。

- [x] **Step 4: Choice対象テストを通す**

Run: `node --test test/choice-batches.test.js`

Expected: 全テストPASS

### Task 3: ドキュメント・検証・デプロイ

**Files:**
- Modify: `README.md`

- [x] **Step 1: READMEへフォールバック条件を追記する**

`_9`優先、`Sado,_Niigata.jpg`の配置場所、欠落時停止、各バッチへのコピーをChoice配置手順へ記載する。

- [x] **Step 2: 全検証を実行する**

Run: `node --test test/*.test.js`

Expected: failure 0

Run: `for f in src/*.js test/*.js; do node --check "$f" || exit 1; done`

Expected: exit 0

- [x] **Step 3: Sadoのデプロイ先を確認する**

Run: `clasp status`

Expected: `src/Distributor.js`を含む追跡ファイル一覧

Run: `cat .clasp.json`

Expected: Script ID `12xVenQQgR8xGbDQh-tw-iGYI9NrVuHYQgrm299U1g9kCuFiVUDvh-WO8`

- [x] **Step 4: GASへpushする**

Run: `clasp push`

Expected: push成功

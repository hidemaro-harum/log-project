# 飲食店候補検索の変更（2026-10-04）

## 動作

- 写真の位置情報から探す候補を飲食店に限定した。Google Nearby Searchには `includedPrimaryTypes` を指定し、応答でも主分類を検証する。ホテル・物販店に飲食店の副分類が付いている場合や、主分類が不明な結果は表示しない。
- レストラン、料理別レストラン、カフェ、バー、ベーカリーなどを対象にする。写真検索は従来どおり既定150m、距離順、最大8候補。
- 店名を2文字以上入力し、入力が600ms止まると現在地を取得して検索する。現在地から3km以内の飲食店を関連度順に最大8件表示する。Googleの検索結果はサーバーでも分類・座標・距離を検証する。
- Google Text Searchは分類指定が1種類に限られるため、単一の検索結果を取得して飲食店の主分類と距離で絞り込む。最大20件の応答から候補を採用し、余分な並列検索やページ送りはしない。
- 候補を選ぶと店名・住所・ジャンルと、その店舗のGoogle Place ID・座標を反映する。ユーザーの現在地は店舗の座標として保存しない。
- 位置情報を許可しない場合、取得できない場合、検索エラーの場合も手入力で保存できる。「現在地で再検索」から再試行できる。現在地は60秒キャッシュし、取得の待機は共有する。拒否やタイムアウト後は、文字入力のたびに再取得を要求しない。
- 編集画面の初期値・写真候補からの自動入力では店名検索を始めない。日本語の変換中は検索とEnterによる誤送信を抑止する。
- 店名・住所の手修正、写真の選び直し、候補選択、画面離脱では古い検索を無効にする。選択後に店名・住所を変更した場合は古い位置情報を保存しない。既存の位置情報と新しい候補の位置情報は項目ごとに混在させず、一式で扱う。

## 変更箇所

- `src/lib/place-suggestions.ts`: 飲食店判定と写真・店名検索のGoogleリクエスト、応答変換。
- `src/app/api/places/search/route.ts`: 認証付きの店名検索API。入力検証、回数制御、既存の外部通信タイムアウト処理を適用。
- `src/components/bitelog/restaurant-name-search.tsx`: 現在地取得、入力待ち、日本語変換、検索キャンセル、再試行。
- `src/components/bitelog/place-suggestion-panel.tsx`: 写真検索と店名検索で共有する候補表示。
- `src/lib/restaurant-place-selection.ts`: 店名・住所と位置情報の整合性を保つ保存用データ生成。
- `src/app/page.tsx`: 入力・写真検索・候補選択・保存への統合。

## 検証

- `npm test`: 84件成功。飲食店主分類、ホテル等の除外、距離制限、店名検索の認証・入力検証、選択後の位置情報整合性を含む。
- `npm run lint`、`npm run typecheck`、`git diff --check`: 成功。
- `npm run build`: 成功。新しい `/api/places/search` を含む9ページの生成・型検査・最適化完了。
- 開発・本番モードのローカルサーバーでログイン画面の描画・入力欄・ブラウザエラーがないことを確認。写真検索・店名検索のAPIは未認証時401。
- GPS付きJPEGによる写真検索、候補選択での自動入力、写真検索中の手入力による取消、GPSなしの案内をブラウザで確認。390pxで横方向のはみ出し・ページ例外なし。
- 保存後の画面判定がNext.jsの履歴更新に影響され、保存済みでもフォームに残る問題をブラウザ検証で発見。現在画面のReact状態を参照するよう修正。
- 手入力での2文字未満の無通信、600ms待機、日本語変換中・確定Enterでの誤送信抑止、遅い旧検索応答の破棄を確認。
- 候補の店名・住所・ジャンル反映、候補選択後の保存と一覧復帰を確認。保存された座標は現在地ではなく候補店舗の座標であることを確認。
- 選択後に店名または住所を変えて保存すると、古いPlace ID・座標・取得元が消去され、住所に応じた都道府県へ更新されることを確認。
- 現在地の拒否・タイムアウト、入力を変えた際の再要求抑止、明示的な再検索による復旧を確認。
- 候補表示は1440px・390px・320pxで横方向のはみ出しなし。
- ブラウザでの検索・保存は架空データとモック通信を使う。本番データ変更やGoogleへの実検索は実行していない。

## 参照仕様

- [Google Nearby Search](https://developers.google.com/maps/documentation/places/web-service/nearby-search)
- [Google Text Search](https://developers.google.com/maps/documentation/places/web-service/text-search)
- [Google Place Types](https://developers.google.com/maps/documentation/places/web-service/place-types)
- [ブラウザの現在地取得](https://developer.mozilla.org/en-US/docs/Web/API/Geolocation/getCurrentPosition)

画面・ブラウザ検証記録:

- [店名検索の候補（390px）](../output/playwright/place-search-candidates-390.png)
- [写真検索の候補](../output/playwright/after-photo-dining-candidates.png)
- [写真フロー検証記録](../output/playwright/photo-place-verification-report.md)
- [店名検索の検証記録](../output/playwright/place-search-verification-report.md)

ローカルプレビュー: `http://127.0.0.1:3100`。

## 本番デプロイ

2026-10-04、ユーザーのデプロイ依頼を受けてVercelの既存 `log-project` へ作業ツリーを本番公開した。

- 公開URL: https://log-project-psi.vercel.app
- Deployment: `dpl_H8ppGgLeXY5hEGE8kpYMB18Y4L96`
- 状態: `READY`、対象: `production`。本番aliasの更新をAPIで確認。
- Vercel側でもインストール・ビルド・型検査・ページ生成が成功。
- 本番にGoogle Places・Supabaseの必要な環境変数が設定済みであることを確認。
- Supabaseのrestaurants/photos/visitsについて、アプリが使う列をlimit=0の読取で確認。すべて200応答。レコード取得・書込・マイグレーション適用は実施していない。
- 公開ページ200、未認証の写真検索・店名検索APIはいずれも401を確認。
- 公開ログイン画面の画像・入力ラベルを確認。1440px・390px・320pxで横方向のはみ出しなし、ブラウザ例外・console error/warningは0件。スクリーンショット: `output/playwright/deployed-login-2026-10-04.png`。
- 新デプロイを対象とする公開直後のerror/fatalログは該当なし。
- デプロイログ: `output/production-deploy-2026-10-04.log`
- 直前の本番デプロイ（Vercelのrollback候補）: `dpl_DmFGDAb6U1ykTB1uBpoTrBKfNJEo`

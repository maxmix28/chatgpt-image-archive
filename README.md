# ChatGPT Image Archive

ChatGPTで生成した画像を、プロンプト、参考画像、タグ、メモ、ステータスと一緒に保存・検索・再利用するためのローカルPWAです。  
1つのプロンプトを1つのグループとして扱い、1グループに複数の生成画像と複数の参考画像を登録できます。

## 主な機能

- プロンプトグループ作成、編集、削除
- 生成画像の複数登録、詳細表示、情報編集、削除
- 参考画像の複数登録、表示、削除
- グループ一覧と全画像一覧
- キーワード検索、タグ絞り込み、カテゴリ絞り込み、お気に入り絞り込み、ステータス絞り込み
- 登録日、更新日、作成日、評価、画像数、お気に入り優先の並び替え
- グループ単位と画像単位のお気に入り
- 画像単位のステータス、評価、タグ、メモ
- 画像登録時のサムネイル生成、サイズ取得、SHA-256ハッシュによる完全一致重複チェック
- ZIPエクスポート、追加インポート、全置換インポート
- PWA対応、Service Workerによる静的ファイルキャッシュ
- PCブラウザとAndroid Chrome向けのレスポンシブUI

## 技術スタック

- HTML / CSS / JavaScript
- IndexedDB
- Web Crypto API
- Canvas API
- Service Worker / Web App Manifest
- ZIPは無圧縮形式をアプリ内で生成・解析

当初の推奨はReact + TypeScript + Vite + Dexie + JSZipでしたが、この作業環境では `npm` が利用できなかったため、依存追加なしで動く静的PWAとして実装しています。外部サーバー通信や画像生成API連携は行いません。

## セットアップ方法

このフォルダ一式を任意の場所に置いてください。依存パッケージのインストールは不要です。

```powershell
cd chatgpt-image-archive
```

## 起動方法

ローカルサーバーで配信してください。Node.jsが使える環境では同梱の簡易サーバーを利用できます。

```powershell
node server.mjs
```

表示されたURLをChromeまたはEdgeで開きます。

```text
http://localhost:4173
```

Node.jsが使えない場合は、任意の静的ファイルサーバーでこのフォルダを配信してください。PWAとService Workerの確認には、`file://` ではなくローカルサーバー経由の表示が必要です。

## ビルド方法

ビルド工程はありません。簡易チェックは以下です。

```powershell
node scripts/check-app.mjs
```

`package.json` には互換用に以下のスクリプトを用意しています。

```powershell
npm run build
npm run start
```

ただし、この環境では `npm` がPATHに存在しない場合があります。その場合は `node` で直接実行してください。

## 使い方

1. `新規登録` を開きます。
2. プロンプト本文を入力します。
3. 生成画像を1枚以上選択します。
4. 必要に応じて参考画像、タグ、カテゴリ、メモ、作成日を入力します。
5. `保存` を押すと、IndexedDBにローカル保存されます。
6. `グループ一覧` でプロンプト単位に確認できます。
7. `画像一覧` で生成画像を横断検索できます。
8. 詳細画面からプロンプトコピー、画像保存、編集、削除ができます。
9. `設定` からZIPエクスポート、追加インポート、全置換インポートを実行できます。

## 実装した機能

- MVP必須の登録、一覧、詳細、編集、削除
- 複数生成画像、複数参考画像
- タグ、カテゴリ、メモ、お気に入り、ステータス、評価
- キーワード検索と主要フィルタ
- サムネイル表示
- 画像ハッシュ重複警告
- IndexedDB保存
- ZIPバックアップと復元
- PWA manifest と Service Worker
- Android幅でも使える下部ナビゲーション

## 未実装または制限事項

- ChatGPTからの自動取得はありません。
- OpenAI APIや画像生成APIは使いません。
- クラウド同期、ログイン、複数ユーザー対応はありません。
- OCR、AIタグ付け、類似画像検索、画像編集、ゴミ箱機能はありません。
- Android共有メニューからの直接取り込みは未対応です。
- ZIPインポートは、このアプリが出力する無圧縮ZIPを対象にしています。
- GIFのサムネイルは静止画として扱います。

## データ保存方式

データはブラウザ内のIndexedDBに保存します。

データベース名:

```text
chatgptImageArchiveDb
```

ストア:

- `promptGroups`
- `generatedImages`
- `referenceImages`
- `settings`

元画像BlobとサムネイルBlobもIndexedDBに保存します。ブラウザの閲覧データ削除、プロファイル削除、端末故障などで失われる可能性があるため、定期的にZIPエクスポートしてください。

## エクスポート／インポート仕様

エクスポートファイル名:

```text
chatgpt-image-archive-backup-YYYYMMDD-HHmmss.zip
```

ZIP内構成:

```text
metadata.json
images/
  generated/
    {imageId}.{ext}
  references/
    {referenceImageId}.{ext}
thumbnails/
  generated/
    {imageId}.webp
  references/
    {referenceImageId}.webp
```

`metadata.json` にはグループ、画像メタデータ、参考画像メタデータ、設定を保存します。Blob本体はJSONに入れず、ZIP内のファイルパスとして参照します。

インポート方式:

- 追加インポート: 既存データを残して追加します。ID衝突時は新しいIDに変換します。
- 全置換インポート: 現在のグループ、生成画像、参考画像を削除してZIPの内容に置き換えます。

バリデーション:

- `metadata.json` の存在
- `version` が `1`
- JSONとして読み込めること
- 参照される元画像とサムネイルがZIP内に存在すること
- 同一ハッシュ画像がある場合は警告

## 手動テスト観点

- 生成画像1枚で登録
- 生成画像4枚で登録
- 参考画像あり／なしで登録
- 長文プロンプトで登録
- PC幅とスマホ幅で一覧表示
- グループ詳細と画像詳細表示
- プロンプト本文、タグ、ステータス、お気に入り検索
- ZIPエクスポート後、全データ削除、ZIPインポート、復元確認

## 同梱ドキュメント

要件定義書と開発指示書は `docs/` に同梱しています。

- `docs/chatgpt_image_archive_requirements.md`
- `docs/chatgpt_image_archive_codex_instructions.md`

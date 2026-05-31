# Codex用 開発指示書：ChatGPT Image Archive

## 1. この開発で作るもの

ChatGPTで生成した画像を、生成時に使ったプロンプト・参考画像・タグ・メモ・ステータスと一緒に保存、検索、再利用できる **PWA対応のローカル画像アーカイブアプリ** を作成してください。

画像生成APIとの連携は行いません。  
ChatGPTで作成した画像をユーザーが手動で登録し、プロンプト単位でグルーピングして管理するアプリです。

---

## 2. アプリ名

仮称：

```text
ChatGPT Image Archive
```

リポジトリ名やプロジェクト名は以下のようにしてください。

```text
chatgpt-image-archive
```

---

## 3. 重要な開発方針

### 3-1. 最重要方針

以下を必ず守ってください。

- 画像生成機能は実装しない
- OpenAI API、ChatGPT API、外部画像生成APIは使用しない
- 外部サーバーへ画像やプロンプトを送信しない
- データは基本的に端末内に保存する
- PCとAndroid Chromeで使えるPWAとして実装する
- 1つのプロンプトに複数画像を紐付ける「プロンプトグループ」構造を中心に設計する
- ZIPエクスポート／インポートに対応する
- 将来拡張しやすい構成にする

### 3-2. 想定利用環境

- Windows 11
- Chrome / Edge
- Android Chrome
- ローカル実行
- PWAとしてホーム画面に追加可能

---

## 4. 推奨技術スタック

特別な理由がなければ、以下の構成で実装してください。

```text
React
TypeScript
Vite
IndexedDB
Dexie.js
JSZip
PWA
CSS Modules または 通常のCSS
```

### 4-1. ライブラリ候補

```text
react
react-dom
typescript
vite
dexie
jszip
uuid
```

PWA対応には以下のどちらかを使用してください。

```text
vite-plugin-pwa
```

または、手動で `manifest.webmanifest` と Service Worker を構成してください。

### 4-2. UIライブラリについて

MVPでは、UIライブラリは必須ではありません。  
過度に複雑にせず、スマホで使いやすいシンプルなUIにしてください。

---

## 5. アプリの基本概念

### 5-1. PromptGroup

1つのプロンプトを1つのグループとして扱います。

例：

```text
グループ：白ボード付きポートレート
  - プロンプト本文
  - ネガティブプロンプト
  - 参考画像
  - 生成画像1
  - 生成画像2
  - 生成画像3
  - 生成画像4
```

### 5-2. GeneratedImage

ChatGPTで生成した画像です。  
必ずどれか1つの PromptGroup に所属します。

### 5-3. ReferenceImage

ChatGPTに添付した参考画像です。  
PromptGroup に複数枚紐付けられます。

### 5-4. Tag

PromptGroup と GeneratedImage の両方に付けられる文字列タグです。

---

## 6. MVPで実装する機能

### 6-1. 必須機能

以下は初期版で必ず実装してください。

- プロンプトグループ作成
- 生成画像の複数登録
- 参考画像の複数登録
- グループ一覧表示
- グループ詳細表示
- 画像詳細表示
- グループ編集
- 画像情報編集
- 参考画像削除
- グループ削除
- 画像削除
- タグ管理
- お気に入り
- 画像ステータス管理
- キーワード検索
- タグ絞り込み
- カテゴリ絞り込み
- お気に入り絞り込み
- ステータス絞り込み
- 並び替え
- サムネイル表示
- 画像ハッシュによる完全一致の重複チェック
- ZIPエクスポート
- ZIPインポート
- PWA対応
- Android向けレスポンシブ対応

### 6-2. 初期版では実装しない機能

以下は今回のMVPでは実装しないでください。

- ChatGPTからの自動取得
- OpenAI API連携
- 画像生成
- 画像編集
- クラウド同期
- Google Drive / OneDrive / Dropbox連携
- ログイン機能
- 複数ユーザー対応
- OCR
- AIタグ付け
- 類似画像検索
- パスコードロック
- ゴミ箱機能
- Android共有メニューからの直接登録

ただし、将来追加しやすいようにデータ構造とファイル構成は整理してください。

---

## 7. データモデル

IndexedDBに保存してください。  
Dexie.jsを使用する場合は、以下のようなストア構成にしてください。

### 7-1. PromptGroup

```ts
export type PromptGroup = {
  id: string;
  title: string;
  prompt: string;
  negativePrompt?: string;
  memo?: string;
  category?: string;
  tags: string[];
  favorite: boolean;
  createdAt: string;
  registeredAt: string;
  updatedAt: string;
  representativeImageId?: string;
};
```

### 7-2. GeneratedImage

```ts
export type ImageStatus =
  | "adopted"
  | "pending"
  | "failed"
  | "reference"
  | "regenerate";

export type GeneratedImage = {
  id: string;
  groupId: string;
  title?: string;
  memo?: string;
  tags: string[];
  status: ImageStatus;
  favorite: boolean;
  rating?: number;
  width: number;
  height: number;
  fileType: string;
  hash: string;
  blob: Blob;
  thumbnailBlob: Blob;
  registeredAt: string;
  updatedAt: string;
};
```

### 7-3. ReferenceImage

```ts
export type ReferenceImageType =
  | "person"
  | "clothing"
  | "composition"
  | "background"
  | "other";

export type ReferenceImage = {
  id: string;
  groupId: string;
  type: ReferenceImageType;
  memo?: string;
  width: number;
  height: number;
  fileType: string;
  hash: string;
  blob: Blob;
  thumbnailBlob: Blob;
  registeredAt: string;
};
```

### 7-4. AppSettings

```ts
export type AppSettings = {
  id: "settings";
  theme: "light" | "dark";
  thumbnailSize: "small" | "medium" | "large";
  listMode: "groups" | "images";
  lastBackupAt?: string;
  appVersion: string;
};
```

---

## 8. IndexedDB設計

Dexie.jsを使う場合は、以下のようなDBを作成してください。

```ts
import Dexie, { Table } from "dexie";

export class AppDatabase extends Dexie {
  promptGroups!: Table<PromptGroup, string>;
  generatedImages!: Table<GeneratedImage, string>;
  referenceImages!: Table<ReferenceImage, string>;
  settings!: Table<AppSettings, string>;

  constructor() {
    super("chatgptImageArchiveDb");

    this.version(1).stores({
      promptGroups: "id, title, category, favorite, createdAt, registeredAt, updatedAt",
      generatedImages: "id, groupId, status, favorite, hash, registeredAt, updatedAt",
      referenceImages: "id, groupId, type, hash, registeredAt",
      settings: "id"
    });
  }
}
```

---

## 9. 画面構成

### 9-1. 必須画面

以下の画面を実装してください。

1. ホーム／グループ一覧画面
2. 画像一覧画面
3. グループ詳細画面
4. 画像詳細画面
5. 新規登録画面
6. 編集画面
7. 設定画面

React Routerを使ってもよいですが、MVPではシンプルな状態管理による画面切替でも構いません。  
ただし、保守性を考えると React Router の使用を推奨します。

---

## 10. 画面別仕様

### 10-1. ホーム／グループ一覧画面

#### 目的

保存済みの PromptGroup を一覧表示する。

#### 表示内容

- 代表サムネイル
- グループタイトル
- 画像数
- 参考画像数
- タグ
- カテゴリ
- お気に入り
- 作成日
- 更新日

#### 操作

- 新規登録画面へ移動
- グループ詳細画面へ移動
- お気に入り切替
- 検索
- タグ絞り込み
- カテゴリ絞り込み
- お気に入り絞り込み
- 並び替え

---

### 10-2. 画像一覧画面

#### 目的

全グループ横断で GeneratedImage を一覧表示する。

#### 表示内容

- サムネイル
- 画像タイトル
- 所属グループ名
- ステータス
- お気に入り
- 評価

#### 操作

- 画像詳細画面へ移動
- ステータス絞り込み
- お気に入り絞り込み
- タグ絞り込み
- 並び替え

---

### 10-3. グループ詳細画面

#### 表示内容

- グループタイトル
- プロンプト全文
- ネガティブプロンプト
- メモ
- カテゴリ
- タグ
- 参考画像一覧
- 生成画像一覧
- お気に入り

#### 操作

- プロンプトをクリップボードにコピー
- ネガティブプロンプトをコピー
- グループ編集
- グループ削除
- 画像追加
- 参考画像追加
- 画像詳細へ移動
- 参考画像の削除
- お気に入り切替

---

### 10-4. 画像詳細画面

#### 表示内容

- 生成画像の大きな表示
- 所属グループ名
- グループのプロンプト
- 画像タイトル
- メモ
- タグ
- ステータス
- お気に入り
- 評価
- 画像サイズ
- ファイル形式

#### 操作

- プロンプトをコピー
- 画像をダウンロード
- 画像情報編集
- ステータス変更
- お気に入り切替
- 評価変更
- 画像削除

---

### 10-5. 新規登録画面

#### 入力項目

- グループタイトル
- プロンプト本文
- ネガティブプロンプト
- グループメモ
- カテゴリ
- タグ
- 作成日
- 生成画像ファイル
- 参考画像ファイル

#### 要件

- 生成画像は1枚以上必須
- プロンプト本文は必須
- タイトル未入力時はプロンプト冒頭または登録日時から自動生成
- 複数画像を一括登録できる
- 参考画像は0枚以上登録できる
- 画像登録時にサムネイルを生成する
- 画像登録時に画像サイズ、形式、ハッシュを取得する
- 既存画像と同一ハッシュの場合は警告を表示する

---

### 10-6. 編集画面

#### グループ編集

- タイトル
- プロンプト
- ネガティブプロンプト
- メモ
- カテゴリ
- タグ
- お気に入り

#### 画像編集

- 画像タイトル
- メモ
- タグ
- ステータス
- お気に入り
- 評価

---

### 10-7. 設定画面

#### 表示・操作

- アプリ名
- アプリバージョン
- データ使用量の概算
- テーマ切替
- サムネイルサイズ切替
- ZIPエクスポート
- ZIPインポート
- 最終バックアップ日時
- 全データ削除

全データ削除には確認ダイアログを必ず表示してください。

---

## 11. 画像処理仕様

### 11-1. サムネイル生成

画像登録時にサムネイルを生成してください。

推奨サイズ：

```text
最大幅 512px
最大高さ 512px
形式 WebP
品質 0.8
```

WebP変換が失敗する環境ではJPEGまたはPNGで代替してください。

### 11-2. ハッシュ計算

画像登録時にBlobからSHA-256ハッシュを計算してください。

```text
crypto.subtle.digest("SHA-256", arrayBuffer)
```

完全一致の重複チェックに使用してください。

### 11-3. 画像サイズ取得

`Image` オブジェクトまたは `createImageBitmap` を利用して幅・高さを取得してください。

---

## 12. 検索・絞り込み仕様

### 12-1. キーワード検索対象

- グループタイトル
- プロンプト本文
- ネガティブプロンプト
- グループメモ
- カテゴリ
- タグ
- 画像タイトル
- 画像メモ
- 画像タグ

### 12-2. 絞り込み

- タグ
- カテゴリ
- お気に入り
- ステータス
- 参考画像あり／なし
- 生成画像あり／なし

### 12-3. 並び替え

- 登録日降順
- 登録日昇順
- 更新日降順
- 作成日降順
- 評価順
- 画像数順
- お気に入り優先

---

## 13. ZIPエクスポート仕様

### 13-1. エクスポートファイル名

```text
chatgpt-image-archive-backup-YYYYMMDD-HHmmss.zip
```

### 13-2. ZIP内構成

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

### 13-3. metadata.json

以下のような形式にしてください。

```json
{
  "version": 1,
  "exportedAt": "2026-05-31T12:00:00+09:00",
  "appName": "ChatGPT Image Archive",
  "promptGroups": [],
  "generatedImages": [],
  "referenceImages": [],
  "settings": {}
}
```

Blob自体はJSONに入れず、ファイルパスのみを保持してください。

### 13-4. エクスポート対象

- PromptGroup
- GeneratedImage のメタデータ
- ReferenceImage のメタデータ
- Settings
- 元画像ファイル
- サムネイル画像ファイル

---

## 14. ZIPインポート仕様

### 14-1. インポート方式

以下の2種類に対応してください。

```text
追加インポート
全置換インポート
```

### 14-2. バリデーション

インポート時に以下を確認してください。

- metadata.json が存在する
- version がサポート範囲内
- metadata.json がJSONとして読み込める
- 参照されている画像ファイルがZIP内に存在する
- 必須項目が存在する

### 14-3. 重複処理

追加インポート時に既存IDと衝突する場合は、新しいIDを振り直してください。  
画像ハッシュが同一の場合は、重複として警告またはスキップ候補を表示してください。

MVPでは、以下の簡易仕様で構いません。

- ID衝突時は新しいIDに変換する
- 同一ハッシュが存在する場合は警告を表示する
- ユーザーが続行した場合は登録する

---

## 15. PWA要件

### 15-1. manifest

以下を設定してください。

```json
{
  "name": "ChatGPT Image Archive",
  "short_name": "Image Archive",
  "display": "standalone",
  "start_url": ".",
  "theme_color": "#111827",
  "background_color": "#ffffff"
}
```

### 15-2. Service Worker

- アプリ本体の静的ファイルをキャッシュする
- オフラインでもアプリ画面を開ける
- IndexedDBの保存データはブラウザ側で保持する

---

## 16. UI/UX要件

### 16-1. 全体

- シンプルで軽いUIにする
- スマホでも見やすい余白を確保する
- 画像管理アプリとしてサムネイルの視認性を重視する
- 長文プロンプトを読みやすく表示する
- コピー操作を分かりやすくする

### 16-2. スマホ対応

- 幅360px程度でも破綻しない
- 下部または上部に主要ナビゲーションを配置する
- ボタンはタップしやすいサイズにする
- 画像グリッドはスマホで2列または3列にする
- 入力フォームは縦並びにする

### 16-3. PC対応

- 画像グリッドは画面幅に応じて列数を増やす
- 検索・フィルタを使いやすく表示する
- 詳細画面では画像とプロンプトを左右または上下に見やすく配置する

---

## 17. ファイル構成案

以下のような構成を推奨します。

```text
chatgpt-image-archive/
  package.json
  index.html
  vite.config.ts
  tsconfig.json
  src/
    main.tsx
    App.tsx
    db/
      database.ts
      types.ts
    components/
      Layout.tsx
      ImageGrid.tsx
      TagInput.tsx
      SearchBar.tsx
      FileDropZone.tsx
      ConfirmDialog.tsx
    pages/
      GroupListPage.tsx
      ImageListPage.tsx
      GroupDetailPage.tsx
      ImageDetailPage.tsx
      NewGroupPage.tsx
      SettingsPage.tsx
    services/
      imageService.ts
      hashService.ts
      exportService.ts
      importService.ts
      searchService.ts
      storageService.ts
    styles/
      global.css
  public/
    manifest.webmanifest
    icons/
```

---

## 18. 実装順序

以下の順番で実装してください。

### Phase 1：プロジェクト作成

1. Vite + React + TypeScript プロジェクトを作成
2. 必要ライブラリを追加
3. 基本レイアウトを作成
4. ルーティングまたは画面切替を実装
5. PWAの最低限設定を追加

### Phase 2：データ層

1. 型定義を作成
2. Dexie.jsでIndexedDBを設定
3. CRUD関数を作成
4. 設定データを保存できるようにする

### Phase 3：画像登録

1. ファイル選択による生成画像登録
2. 複数画像登録
3. 参考画像登録
4. サムネイル生成
5. ハッシュ計算
6. 画像サイズ取得
7. 重複警告

### Phase 4：一覧・詳細

1. グループ一覧
2. グループ詳細
3. 画像一覧
4. 画像詳細
5. プロンプトコピー
6. 画像ダウンロード

### Phase 5：編集・削除

1. グループ編集
2. 画像編集
3. 参考画像削除
4. グループ削除
5. 画像削除
6. 確認ダイアログ

### Phase 6：検索・絞り込み

1. キーワード検索
2. タグ絞り込み
3. カテゴリ絞り込み
4. ステータス絞り込み
5. お気に入り絞り込み
6. 並び替え

### Phase 7：バックアップ

1. ZIPエクスポート
2. metadata.json出力
3. 画像ファイル出力
4. ZIPインポート
5. 追加インポート
6. 全置換インポート
7. バリデーション

### Phase 8：仕上げ

1. Android表示確認
2. PC表示確認
3. PWAインストール確認
4. エラー処理改善
5. README作成
6. 簡易テストデータ作成

---

## 19. エラー処理要件

以下の場合は、ユーザーに分かりやすいエラーメッセージを表示してください。

- 画像ファイルが読み込めない
- 画像形式が対応外
- IndexedDB保存に失敗した
- ZIPエクスポートに失敗した
- ZIPインポートに失敗した
- metadata.json が不正
- 必須項目が未入力
- 画像が1枚も選択されていない
- プロンプトが未入力

---

## 20. 対応画像形式

MVPでは以下に対応してください。

```text
PNG
JPEG
WebP
GIF
```

ただし、サムネイル生成は静止画として扱って構いません。  
GIFアニメーションの完全対応は不要です。

---

## 21. 入力バリデーション

### 21-1. 新規登録

- プロンプト本文は必須
- 生成画像は1枚以上必須
- タイトル未入力時は自動生成
- タグは空文字を保存しない
- 重複タグは1つにまとめる

### 21-2. 編集

- 空タイトルは許可してもよい
- プロンプトを空にする場合は確認を出す
- 評価は1〜5の範囲にする

---

## 22. 受け入れ条件

以下を満たしたらMVP完了とします。

### 22-1. 基本登録

- 新規グループを作成できる
- プロンプトを保存できる
- 複数の生成画像を保存できる
- 複数の参考画像を保存できる
- 登録後に一覧に表示される

### 22-2. 表示

- グループ一覧で代表サムネイルが表示される
- グループ詳細でプロンプト全文が確認できる
- グループ詳細で生成画像と参考画像が確認できる
- 画像詳細で画像を大きく表示できる

### 22-3. 編集

- グループ情報を編集できる
- 画像情報を編集できる
- タグ、お気に入り、ステータスを変更できる

### 22-4. 検索

- キーワードでグループを検索できる
- タグで絞り込める
- お気に入りで絞り込める
- ステータスで絞り込める

### 22-5. バックアップ

- ZIPで全データをエクスポートできる
- エクスポートZIP内にmetadata.jsonと画像が含まれる
- ZIPからインポートできる
- インポート後に画像とプロンプトが復元される

### 22-6. PWA

- Android Chromeで表示できる
- スマホ幅でUIが破綻しない
- ホーム画面に追加できる
- オフラインでもアプリ画面を開ける

---

## 23. READMEに記載すること

README.mdには以下を必ず記載してください。

- アプリ概要
- 主な機能
- 技術スタック
- セットアップ方法
- 起動方法
- ビルド方法
- データ保存先がIndexedDBであること
- バックアップの重要性
- ZIPエクスポート／インポートの使い方
- 画像生成APIは使わないこと
- 今後の拡張候補

---

## 24. テスト観点

自動テストを必須にはしませんが、以下の手動テストを行える状態にしてください。

### 24-1. 登録テスト

- 1枚の画像で登録
- 4枚の画像で登録
- 参考画像ありで登録
- 参考画像なしで登録
- 長文プロンプトで登録

### 24-2. 表示テスト

- PC幅で一覧表示
- スマホ幅で一覧表示
- グループ詳細表示
- 画像詳細表示

### 24-3. 検索テスト

- プロンプト本文のキーワード検索
- タグ検索
- ステータス検索
- お気に入り検索

### 24-4. バックアップテスト

- エクスポート
- 全データ削除
- インポート
- 復元確認

---

## 25. 実装上の注意

### 25-1. Blob URLの扱い

画像表示時には `URL.createObjectURL(blob)` を利用してよいですが、不要になったら `URL.revokeObjectURL()` してください。

### 25-2. 大量画像への配慮

大量画像を登録した場合でも一覧表示が極端に重くならないよう、必ずサムネイルを使って表示してください。

### 25-3. 破壊的操作

以下の操作には確認ダイアログを表示してください。

- グループ削除
- 画像削除
- 参考画像削除
- 全データ削除
- 全置換インポート

### 25-4. 日本語UI

画面表示、ボタン、エラーメッセージは日本語にしてください。

---

## 26. 開発完了時に出してほしい成果物

以下を用意してください。

- 動作するアプリ一式
- README.md
- 必要に応じて AGENTS.md
- package.json
- セットアップ手順
- 手動テスト手順
- ビルド手順

---

## 27. Codexへの作業指示

この指示書を読んだら、まず以下を行ってください。

1. 実装計画を短く提示する
2. ファイル構成案を提示する
3. その後、実装を開始する
4. 実装後に動作確認方法を提示する
5. 可能であれば `npm run build` が通る状態にする

不明点がある場合でも、MVPの範囲で合理的に判断して実装を進めてください。  
ユーザー確認が必要な場合は、作業を止めるのではなく、仮定を明示したうえで進めてください。

---

## 28. 今回の要件定義との対応

この開発指示書は、以下の要件を満たすことを目的としています。

- ChatGPTで生成した画像を保存する
- プロンプトと一緒に保存する
- 添付画像を元に作成した場合は、その添付画像も保存する
- Androidでも使える
- プロンプト単位でグルーピングする
- ローカル保存する
- ZIPでバックアップ／復元する


# 🏐 Volleyball Stats

バレーボールの試合スタッツ記録・分析ツール

## 技術スタック

- **Google Apps Script** - 入力UI・自動化
- **Python** - データ分析
  - `google-genai` - Gemini API（動画AI分析）
  - `gspread` - Google Sheets操作
  - `notion-client` - Notion API
  - `japanize-matplotlib` - 日本語対応グラフ
- **Google Sheets** - データストレージ
- **Notion API** - レポート自動更新
- **Google Colab** - 分析環境

## 動画AI分析（開発中）

現在は試合中に撮影し、試合後に動画を見て手入力しています。Gemini APIを使用して動画からプレーを自動分析し、入力負担を軽減する機能を開発中です。

### 現在のワークフロー

1. 試合中は撮影のみ
2. 試合後に動画を見て手入力

### 目指すワークフロー

1. 試合中は撮影のみ（記録不要）
2. 試合後に動画をアップロード
3. AIが各ラリーを分析してプレー内容を提案
4. 人間が確認・修正して記録

### AIが判定する項目

- **レセプション評価**（A/B/C/D）
- **決定プレー**（サーブ/スパイク/フェイント/ブロック等）
- **攻撃タイプ**（クイック/セミ/並行/オープン等）
- **ブロッカー数**（0/1/2/3）
- **ゾーン**（9つのエリア）
- **得点チーム/決定チーム**

## 構成

- `gas/` - Google Apps Script（入力UI）
- `sheets/` - スプレッドシートのテンプレート
- `analysis/` - Python分析ノートブック
- `docs/` - ドキュメント

## セットアップ

1. Google Sheetsで「バレー スタッツ」を作成
2. シート「生データ」「設定」を作成
3. `gas/`のコードをApps Scriptに貼り付け
4. Webアプリとしてデプロイ

### Notion連携の設定

Notionへレポートを自動更新する場合、以下の設定が必要です：

1. [Notion Integration](https://www.notion.so/my-integrations)でIntegrationを作成し、APIトークンを取得
2. レポートを書き込みたいNotionページで、作成したIntegrationを接続
3. Apps Scriptのスクリプトプロパティに以下の値を設定：
   - `NOTION_TOKEN`: 取得したAPIトークン（`ntn_...`）
   - `NOTION_PAGE_ID`: ページID（URLの32文字の文字列）

**スクリプトプロパティの設定方法：**
- Apps Scriptエディタで「設定」→「スクリプトのプロパティ」を開く
- 「プロパティを追加」で上記のキーと値を入力

## 分析

Google Colabで`analysis/analyze.ipynb`を開いて実行

## カラム定義

[docs/columns.md](docs/columns.md)を参照

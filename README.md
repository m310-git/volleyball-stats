# 🏐 Volleyball Stats

バレーボールの試合スタッツ記録・分析ツール

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

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

## 分析

Google Colabで`analysis/analyze.ipynb`を開いて実行

## カラム定義

[docs/columns.md](docs/columns.md)を参照

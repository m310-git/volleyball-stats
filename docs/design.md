# バレーボールスタッツ 動画AI半自動化 設計書

## 目次

1. プロジェクト概要
2. 制約条件
3. システムアーキテクチャ
4. ワークフロー詳細
5. データ設計
6. AI分析設計
7. 派生値の自動計算
8. GAS側の設計
9. エラーハンドリング
10. Colabノートブックの構成
11. 運用フロー
12. テスト方針
13. リスクと対策
14. 成功指標
15. 開発スケジュール
16. 将来拡張
17. ファイル構成
18. 実装ルール（Windsurf向け）

---

## 1. プロジェクト概要

### 1.1 目的

現在の「手動ボタン入力によるスタッツ記録」を「動画AIが分析・提案 → 人間が確認・修正して記録」のワークフローに進化させ、記録者の負担を大幅に軽減する。

### 1.2 用語集

| 用語 | 定義 |
|------|------|
| ラリー | サーブ開始から得点確定までの一連のプレー |
| サイドアウト | サーブ権を持たないチームが得点し、サーブ権を獲得すること |
| ブレイク | サーブ権を持つチームが得点すること |
| ローテーション | サイドアウト時に選手が時計回りに移動。1〜6で管理 |
| SO率 | 相手サーブ時に自チームが得点した割合 |
| BRK率 | 自チームサーブ時に自チームが得点した割合 |
| 攻撃効率 | 得点数 / (得点数 + ミス数) |
| A+B率 | レセプション評価がA/Bの割合 |
| 自チーム | スタッツ記録対象のチーム |
| 相手 | 対戦相手チーム |
| 2行記録 | 相手攻撃で失点したラリーを自チーム視点+相手視点の2行で記録するルール |
| rally_key | ラリー一意キー。形式: `{match_id}_set{N}_rally{NNN}` |
| match_id | 試合一意ID。形式: `{date}_{opponent}_game{N}` |
| 派生値 | score_us, score_them, serve_team, rotation, team, result。自動計算される値 |
| 正本 | 「AI提案」シートの業務データ列の現在値。commit時の転記元 |
| 正規化済みAI原案 | Gemini生レスポンスにスキーマ検証・値正規化・"相手"→チーム名変換を適用後のJSON |
| canonical JSON | original_payload / final_payload の保存形式。ラリー単位で精度ログ比較対象項目のみ含む |

### 1.3 現状の課題

| 課題 | 詳細 |
|------|------|
| 記録者の負担が大きい | 試合中にリアルタイムで全20項目を手入力 |
| 記録の正確性 | 速い展開で入力ミスが発生しやすい |
| 記録者が試合を見られない | 入力に集中するため |
| 人員の確保 | 専任記録者が必要 |

### 1.4 目指す姿

| 段階 | ワークフロー |
|------|------------|
| **現状** | 試合中 → 全項目手入力 |
| **Phase 1（本設計）** | 試合中は撮影のみ → 試合後にAI分析 → 人間が確認・修正 |
| **Phase 2（将来）** | リアルタイムAI分析 → 人間は確認のみ |

### 1.5 スコープ

Phase 1のみ。

### 1.6 初版のスコープ

| 優先度 | 項目 | 理由 |
|:------:|------|------|
| **高** | point_team, deciding_team, play_type, receive_grade | スコア計算・基本分析の基盤 |
| **高** | attack_type, blocker_count, zone_from, zone_to | 戦術分析に直結 |
| **高** | 2行記録、approve/commit、派生値再計算、ラリー追加/削除 | データ構造の正確性 |
| **低** | player, receiver | ユニフォームなしで精度低。null許容 |
| **低** | result_detail | 判別困難な場合多。null許容 |
| **低** | 動画タイムスタンプ精密リンク | ベストエフォート |

最初の価値は**「試合中に記録しなくていい」**こと。

### 1.7 データの正規化ルール

#### null / 空文字の扱い

| 環境 | 正規化ルール |
|------|-------------|
| Python | `None` → シート書き込み時に `""` |
| Sheets | `""` = 値なし |
| GAS | `""`, `" "`, `"null"`, `"None"` → 全て `""` |
| JSON | `null` → パース後に正規化 |

#### チーム名の保存値

全て `"自チーム"` or 相手チーム名（例: `"レジン"`）。`"相手"` という文字列は使用しない。対象: point_team, serve_team, team, deciding_team。

#### スコアのタイミング

各ラリー終了直後のスコアを保存。例: 5-5から自チーム得点 → `score_us=6, score_them=5`。

#### 値の比較ルール

human_modified判定・精度ログ比較で適用。

| ルール | 詳細 |
|--------|------|
| null系統一 | `""`, `null`, `"null"`, `"None"`, `" "` → 同一 |
| trim | 前後空白除去 |
| 数値と文字列 | `2` と `"2"` → 同一 |
| 大文字小文字 | 区別する |

---

## 2. 制約条件

### 2.1 コスト：完全無料

| サービス | 無料枠 | 想定使用量 | 費用 |
|---------|--------|-----------|------|
| Gemini API（Flash） | 1日1,500リクエスト | 200回/月 | ¥0 |
| Google Colab | 無料 | 月4回 | ¥0 |
| Google Sheets | 既存 | 変更なし | ¥0 |
| GAS Web App | 既存 | 改修のみ | ¥0 |
| Google Drive | 15GB | 動画一時保存 | ¥0 |

### 2.2 入力動画

| 項目 | 仕様 |
|------|------|
| 機材 | iPhone標準カメラ |
| 単位 | 1セット = 1動画 |
| 長さ | 20〜30分/セット |
| サイズ | 約1.6GB（1080p） |
| 撮影位置 | 自チーム側エンドライン後方、三脚固定 |
| コートチェンジ | なし |

### 2.3 チーム・選手

| 項目 | 仕様 |
|------|------|
| ユニフォーム | なし（私服） |
| 背番号 | なし |
| 選手数 | 約7人 |
| 識別手がかり | 体格・髪型・身長 |
| 選手写真 | 毎試合、当日撮影しDriveに保存 |

### 2.4 技術制約

- サーバーなし（Colab完結）
- 「生データ」20列スキーマ変更なし
- GAS実行制限6分/リクエスト
- InputForm.html単一ファイル
- Gemini動画入力上限1GB（1.6GBは分割必要）

### 2.5 Drive共有の前提
撮影者と分析担当者が異なる場合のGoogle Drive共有設定。
| 項目 | 内容 |
|------|------|
| Googleアカウント | 個人アカウント（無料） |
| 撮影者 | 動画をDriveに保存する人（選手兼任可） |
| 分析担当者 | Colabを実行する人（固定1人） |
| 共有方法 | 撮影者が動画フォルダを分析担当者に共有 → 分析担当者がマイドライブにショートカット追加 |

#### 初回セットアップ（1回だけ）
```text
[1] 撮影者のDriveに「バレー動画」フォルダを作成
[2] 撮影者が「バレー動画」フォルダを分析担当者のGoogleアカウントに共有（編集権限）
[3] 分析担当者がGoogleドライブを開く
[4] 「共有アイテム」に表示された「バレー動画」フォルダを右クリック
[5] 「ドライブにショートカットを追加」→「マイドライブ」を選択
[6] 以降、マイドライブに「バレー動画」のショートカットが表示される
```
#### 毎試合の運用
```text
撮影者: 「バレー動画/20260329_レジン/」に動画・選手写真を保存
         → 分析担当者のマイドライブにも自動的に見える（ショートカット経由）
分析担当者: Colabで drive.mount('/content/drive') を実行
            → /content/drive/MyDrive/バレー動画/20260329_レジン/ でアクセス可能
```
#### 注意事項
| 項目 | 内容 |
|------|------|
| 共有権限 | **編集権限**を推奨（分析担当者がColab経由で一時ファイルを作成する場合があるため） |
| 容量 | 動画の実体は撮影者のDriveにある。分析担当者のDrive容量は消費しない |
| ショートカットの永続性 | 一度追加すれば、撮影者が新しい試合フォルダを作るたびに自動的に見える |
| 共有解除 | 撮影者が共有を解除すると分析担当者からアクセスできなくなる |
| Colabのパス | ショートカット経由でも通常のパス（`/content/drive/MyDrive/バレー動画/...`）でアクセス可能 |


---

## 3. システムアーキテクチャ

### 3.1 全体構成

```text
┌──────────┐     ┌──────────────┐     ┌──────────────────┐
│ iPhone   │     │  Google      │     │ Google Colab     │
│ 1セット   │────▶│  Drive       │────▶│ ・ffmpeg 720p化  │
│ 連続撮影  │     │ (動画+写真)  │     │ ・ffmpeg 3分分割 │
└──────────┘     └──────────────┘     │ ・Gemini API     │
                                      │ ・結果統合       │
                                      └──────┬───────────┘
                                             │
                                      ┌──────▼───────┐
                                      │ Gemini API   │
                                      │ (区間動画     │
                                      │  +選手写真)   │
                                      └──────┬───────┘
                                             │
                                      ┌──────▼───────┐
                                      │Google Sheets │
                                      │「AI提案」シート│
                                      └──────┬───────┘
                                             │
                                      ┌──────▼───────┐
                                      │ GAS Web App  │
                                      │ 確認・修正UI  │
                                      │ (派生値再計算) │
                                      └──────┬───────┘
                                             │
                                      ┌──────▼───────┐
                                      │「生データ」シート│
                                      │  (既存20列)   │
                                      └──────────────┘
```

### 3.2 技術選定

| コンポーネント | 選定 | 理由 |
|--------------|------|------|
| AI | Gemini 2.5 Flash | 動画+画像同時入力、無料枠十分、JSON強制可能 |
| 実行環境 | Google Colab | 無料、ffmpeg利用可能 |
| 動画前処理 | ffmpeg 720p再エンコード+3分分割 | 1GB制約回避、費用0 |
| 動画保存 | Google Drive | iPhone自動同期可能 |
| 中間データ | Sheets「AI提案」シート | タブ追加のみ |
| 確認UI | GAS Web App（既存拡張） | 新規フレームワーク不要 |

### 3.3 動画の処理方式

方式D（時間窓スライド）を標準。

```text
元動画（1080p, 1.6GB）
  ▼ 720p H.264 faststart再エンコード（400〜600MB）
  ▼ 3分区間（20秒オーバーラップ）に分割
  ▼ 各区間をGemini APIに送信
```

| 項目 | 値 |
|------|-----|
| 再エンコード | 720p H.264 faststart |
| 区間長 | 3分 |
| オーバーラップ | 20秒 |
| 区間数/セット | 約8〜10 |

#### タイムスタンプ変換

```text
absolute_sec = segment_start_sec + rally_sec_in_segment
```

#### 重複排除

```text
1. 全区間のラリーを絶対秒で昇順ソート
2. 隣接ラリーの差が5秒未満なら同一ラリー
3. 同一ラリーは後の区間の結果を採用
```

#### ディスク管理

1セットずつ処理し一時ファイルを都度削除。

#### レート制限

各リクエスト間5秒ウェイト。1セット5〜8分。3セット15〜25分。

### 3.4 既存機能への影響

全て「なし」。「生データ」シート構造・「設定」シートは変更しない。

---

## 4. ワークフロー詳細

### 4.1 全体フロー

```text
[Step 1] 事前準備: 選手写真撮影→Drive保存
    ▼
[Step 2] 撮影: 三脚iPhoneで1セット連続撮影
    ▼
[Step 3] AI分析(Colab): 720p化→分割→Gemini→統合→シート書き込み
    ▼
[Step 4] 確認・修正(GAS): 一括承認→個別修正→ラリー追加/削除
    ▼
[Step 5] 確定(GAS): 生データに転記→精度ログ記録
    ▼
[Step 6] 精度改善データ蓄積（自動）
```

### 4.2 Step 1: 事前準備

| 項目 | 内容 |
|------|------|
| タイミング | 試合当日、開始前 |
| 内容 | 各選手の全身写真1枚ずつ（当日の服装） |
| 命名 | `{選手名}.jpg` |
| 保存先 | `バレー動画/{yyyymmdd}_{相手}/players/` |
| 所要時間 | 2〜3分 |

```text
バレー動画/20260329_レジン/
├── players/  (ゆう.jpg, りっきー.jpg, ...)
├── SET1.mp4
├── SET2.mp4
└── SET3.mp4
```

### 4.3 Step 2: 撮影ルール

| 項目 | ルール |
|------|--------|
| 位置 | **自チーム側エンドライン後方**、三脚固定 |
| 単位 | 1セット = 1動画 |
| 画質 | 1080p（Colabで720pに再エンコード） |
| 撮影者 | 選手兼任可（三脚固定で操作不要） |
| 途切れ時 | そのセットは既存UIで手入力 |

### 4.4 Step 3: AI分析

#### ユーザー入力

| 項目 | 例 | 必須 |
|------|-----|:----:|
| Driveフォルダパス | `"バレー動画/20260329_レジン"` | ✅ |
| 試合日 | `"20260329"` | ✅ |
| 相手チーム名 | `"レジン"` | ✅ |
| 試合番号 | `1` | 任意（デフォルト1） |
| 選手リスト | `["ゆう","りっきー",...]` | ✅ |
| 各セット初期サーブ権 | `["レジン","自チーム","レジン"]` | **推奨必須** |
| 各セット初期ローテーション | `[1, 3, 2]` | **推奨必須** |
| セット順手動マッピング | `{"VID_001.mp4": 1, ...}` | 条件付き |

#### セット順決定

1. ファイル名が `SET1`/`SET2`/... → その番号順
2. createdTime昇順
3. ユーザー手動マッピング

**file IDでのソートは禁止。**

#### 処理フロー

```text
1. folder ID確定、動画・写真のfile ID取得
   - Driveフォルダからfolder IDを確定
   - drive.mount() でマイドライブをマウント
   - ショートカット経由で撮影者のフォルダにアクセス
   - パス: /content/drive/MyDrive/バレー動画/{yyyymmdd}_{相手}/
2. セット順決定
3. 選手写真読み込み
4. match_id生成: {date}_{opponent}_game{N}
5. analysis_run_id生成: run_{yyyymmdd}_{HHmmss}
6. 各セット（1セットずつ処理）:
   a. ffmpeg 720p再エンコード
   b. ffmpeg 3分区間分割
   c. 各区間:
      i.   Gemini File APIでアップロード→完了待機
      ii.  システムプロンプト+選手写真7枚+区間動画+ユーザープロンプトでAPI呼び出し
      iii. JSONパース→スキーマ検証→絶対秒変換
      iv.  区間動画をGemini File APIから削除→5秒ウェイト
   d. 全区間統合、重複排除
   e. rally_key/rally_seq採番
   f. 一時ファイル全削除
7. 全セット統合
8. 派生値計算（セクション7）
9. 2行記録展開（セクション7）
10. 再実行時の既存データ削除（COMMITTED以外）
11. 「AI提案」シートに書き込み
    - original_payloadには正規化済みAI原案のcanonical JSONを保存
    - initial_serve_team/initial_rotationも書き込み
```

#### 処理時間

| 工程 | 1セット |
|------|--------|
| 720p再エンコード | 2〜4分 |
| 区間分割 | 30秒〜1分 |
| 区間アップロード+分析 | 4〜7分 |
| **合計** | **7〜12分**（3セットで21〜36分） |

#### Gemini API設定

| パラメータ | 値 |
|-----------|-----|
| model_name | `"gemini-2.5-flash"` |
| max_output_tokens | `8192` |
| response_mime_type | `"application/json"` |
| temperature | `0.2` |

#### JSONスキーマ検証

| 項目 | 不正時 |
|------|--------|
| point_team/deciding_team: "自チーム"/"相手"のみ | 区間エラー |
| play_type: 定義済みenumのみ | null化 |
| receive_grade: A/B/C/D/null | null化 |
| attack_type: 定義済みenum or null | null化 |
| blocker_count: 0/1/2/3/null | null化 |
| zone: 12ゾーン or null | null化 |
| our_defense_type: ブロック/ディグ/null | "ディグ"化 |
| confidence系: 0.0〜1.0 | 0.0化 |
| field_confidences: 各キー0.0〜1.0 | 欠落は0.0補完 |
| rally_start_sec/rally_end_sec: 0以上 | 区間エラー |
| 必須項目欠落 | 区間エラー |

#### point_team/deciding_team変換

Geminiの `"相手"` → 相手チーム名に変換してからシート保存。

#### 再実行ルール

同一match_id+setでstatus!=COMMITTEDの既存データは削除して置換。COMMITTED済みは保護。

### 4.5 Step 4: 確認・修正（GAS Web App）

#### 画面遷移

```text
├── [既存] setupScreen
├── [既存] mainScreen → 「🤖 AI確認」ボタン
└── [新規] reviewScreen
        ├── ← 記録画面に戻る
        ├── セット選択タブ
        ├── 進捗サマリー
        ├── 一括承認ボタン
        ├── ラリーカード一覧（[✅承認][⏭スキップ][🗑削除]、カード間に[＋追加]）
        └── 全確定ボタン
```

#### ラリーカード

```text
【1行記録】
┌─────────────────────────────────────────┐
│ #12  🟡要確認 (68%)           [▶動画]   │
│ 得点: [🔵自チーム ▼]                     │
│ 決定: [🔵自チーム ▼]                     │
│ プレー: [スパイク ▼]  選手: [ゆう ▼]     │
│ キャッチ: [B ▼]  選手: [りっきー ▼]      │
│ テンポ: [並行 ▼]  ブロック: [2枚 ▼]      │
│ ゾーン: [自左前] → [相手右奥]            │
│ スコア: 6-5  S:レジン  R:3  ← 読み取り専用│
│   [✅承認] [⏭スキップ] [🗑削除]          │
└─────────────────────────────────────────┘
         [＋ この後ろにラリー追加]

【2行記録】
┌─────────────────────────────────────────┐
│ #15  🟡要確認 (72%)  [2行]    [▶動画]   │
│ ── 自チーム（守備）──                     │
│ プレー: [ディグ ▼]  選手: [（空欄）▼]     │
│ ── レジン（攻撃）──                      │
│ プレー: [スパイク ▼]  結果: 得点          │
│ テンポ: [並行 ▼]  ブロック: [2枚 ▼]      │
│ ゾーン: [相手左前] → [自右奥]            │
│ キャッチ: [C ▼]  選手: [れんれん ▼]      │
│ スコア: 5-6  S:レジン  R:3  ← 読み取り専用│
│   [✅承認] [⏭スキップ] [🗑削除]          │
└─────────────────────────────────────────┘
         [＋ この後ろにラリー追加]
```

#### ステータス

| 内部コード | 表示 | カード | 動作 |
|:----------:|------|--------|------|
| `HIGH` | 🟢高確信 | 折りたたみ | 一括承認対象 |
| `MEDIUM` | 🟡要確認 | 展開、黄色ハイライト | 個別確認 |
| `LOW` | 🔴低確信 | 展開、赤ハイライト | 個別確認 |
| `ERROR` | ❌エラー | 展開、全空欄 | 手入力 |
| `APPROVED` | ✅承認済 | 折りたたみ、緑背景 | 操作不可 |
| `COMMITTED` | 📝転記済 | 非表示 | - |

#### ステータス判定

| ステータス | 条件 |
|-----------|------|
| `HIGH` | confidence>=0.8 かつ point_team/deciding_team/play_typeのfield confidence全て>=0.8 |
| `MEDIUM` | confidence>=0.5 かつ HIGHでない |
| `LOW` | confidence<0.5 |
| `ERROR` | パース失敗、必須項目欠落 |

#### 確信度ハイライト

| 確信度 | クラス | 表示 |
|--------|--------|------|
| >=0.8 | `.conf-high` | 通常 |
| 0.5〜0.79 | `.conf-med` | 黄色背景 |
| <0.5 | `.conf-low` | 赤背景 |
| null | `.conf-null` | 白背景、赤破線枠 |

#### フォーム要素

| 項目 | 編集 |
|------|:----:|
| point_team（2択ボタン） | ✅ |
| deciding_team（2択ボタン） | ✅ |
| play_type（ボタン群） | ✅ |
| player（ボタン群） | ✅ |
| receive_grade（4択） | ✅ |
| receiver（ボタン群） | ✅ |
| result_detail（ドロップダウン） | ✅ |
| attack_type（ドロップダウン） | ✅ |
| blocker_count（4択） | ✅ |
| zone_from/zone_to（コート図） | ✅ |
| note（テキスト） | ✅ |
| result / team（派生値） | ❌ |
| score / serve_team / rotation（派生値） | ❌ |

#### 動画プレビュー

`https://drive.google.com/file/d/{fileId}/preview#t={絶対秒}`。ベストエフォート。

#### ラリー追加・削除

| 操作 | 処理 |
|------|------|
| 削除 | 確認ダイアログ→削除（2行は2行とも）→rally_seq振り直し→派生値再計算。COMMITTED不可 |
| 追加 | 空カード挿入。point_team+deciding_team必須。ステータスAPPROVED。rally_seq振り直し→派生値再計算 |

#### スキップ

データ変更なし、ステータス変更なし。次の未確認カードへスクロール。commit対象にならない。

#### 構造変更バリデーション

approve時、編集後のpoint_team/deciding_team/play_typeに基づく1行/2行判定がis_two_lineと一致しない場合は保存拒否。メッセージ: 「構造変更は未対応です。削除して再追加してください。」

#### 操作フロー

```text
[1] 「🤖 AI確認」→ reviewScreen
[2] セット選択 → カード一覧+派生値表示
[3] 「🟢一括承認」→ HIGHを全てAPPROVED
[4] MEDIUM/LOW個別確認・修正
    - point_team変更 → セット全体の派生値再計算
    - deciding_teamのみ変更 → 該当ラリーのteam/resultのみ再決定
    - 構造変更バリデーション
    - 「✅承認」→ 列値更新→final_payload保存→approved_at/by記録
[4a] 「🗑削除」→ rally_seq振り直し→派生値再計算
[4b] 「＋追加」→ rally_seq振り直し→派生値再計算
[5] 「全て確定→生データ」→ 未承認警告→派生値最終再計算→転記→COMMITTED→精度ログ
```

#### データの正本ルール

| データ | 正本 | 用途 |
|--------|------|------|
| 業務データ列の現在値 | **正本** | commit転記元、UI表示・編集対象 |
| original_payload | 監査用 | 正規化済みAI原案。精度ログ比較元 |
| final_payload | 監査用 | 承認時canonical JSON。精度ログ比較先 |

- UIでの編集 → シート列値を直接更新
- 承認時 → canonical JSONをfinal_payloadに保存（line_index=1のみ）
- commit → シート列値を転記
- 精度ログ → original_payload vs final_payload

#### final_payload の形式

シート行のダンプではなく、**AI原案と同一スキーマのラリー単位canonical JSON**。

```json
{
  "point_team": "レジン",
  "deciding_team": "レジン",
  "receive_grade": "C",
  "receiver": "れんれん",
  "play_type": "スパイク",
  "player": null,
  "result_detail": null,
  "attack_type": "並行",
  "blocker_count": "2",
  "zone_from": "相手左前",
  "zone_to": "自右奥",
  "our_defense_type": "ディグ",
  "note": ""
}
```

**canonical JSONに含める項目（精度ログ比較対象と同一）：** point_team, deciding_team, receive_grade, receiver, play_type, player, result_detail, attack_type, blocker_count, zone_from, zone_to, our_defense_type, note

**canonical JSONに含めない項目：** 派生値（score_us, score_them, serve_team, rotation, team, result）、メタデータ（rally_key, line_index, status, confidence等）

**2行記録の場合のcanonical JSON再構成ルール：**

| canonical項目 | 取得元 |
|--------------|--------|
| point_team / deciding_team | line_index=1の列値 |
| receive_grade / receiver | line_index=1の列値 |
| play_type | line_index=2のplay_type列（相手の攻撃種別） |
| player | line_index=2のplayer列（相手の攻撃者） |
| attack_type / blocker_count | line_index=2の列値 |
| zone_from | line_index=2のzone_from列 |
| zone_to | line_index=2のzone_to列 |
| our_defense_type | line_index=1のplay_type列から逆算（ディグ→"ディグ"、ブロック→"ブロック"） |
| result_detail | line_index=1のresult_detail列 |
| note | line_index=1のnote列 |

#### human_modified の記録ルール

- **人間が直接編集した項目名のみ**記録
- 派生値の自動更新（team, result, score等）は含めない
- 対象は精度ログ比較対象項目と同一
- 比較は1.7節の正規化ルール適用後

### 4.6 Step 5: 確定処理

1. LockService取得
2. 未承認ラリーがあればエラー
3. 派生値を最終再計算
4. シート列値を「生データ」に転記（2行記録は2行とも。deciding_teamは転記しない）
5. ステータスをCOMMITTEDに
6. 精度ログ記録（line_index=1かつoriginal_payloadが空でない行のみ、canonical JSON比較）
7. ロック解放

---

## 5. データ設計

### 5.1 既存：「生データ」シート（変更なし、20列）

| 列 | カラム名 | 列 | カラム名 |
|----|---------|-----|---------|
| A | date | K | team |
| B | opponent | L | player |
| C | set | M | play_type |
| D | score_us | N | result |
| E | score_them | O | result_detail |
| F | point_team | P | attack_type |
| G | serve_team | Q | blocker_count |
| H | rotation | R | zone_from |
| I | receive_grade | S | zone_to |
| J | receiver | T | note |

#### 2行記録の例

| 行 | team | player | play_type | result | attack_type | blocker_count | zone_from | zone_to |
|----|------|--------|-----------|--------|-------------|---------------|-----------|---------|
| 1行目 | 自チーム | | ディグ | ミス | | | | 自右奥 |
| 2行目 | レジン | | スパイク | 得点 | 並行 | 2 | 相手左前 | 自右奥 |

（date〜rotation, receive_grade, receiverは両行同じ）

### 5.2 新規：「AI提案」シート（43列）

| 列 | カラム名 | 型 | Colab | GAS読 | GAS書 | 説明 |
|----|---------|-----|:-----:|:-----:|:-----:|------|
| A | status | text | ✅ | ✅ | ✅ | HIGH/MEDIUM/LOW/ERROR/APPROVED/COMMITTED |
| B | rally_key | text | ✅ | ✅ | ✅ | ラリー一意キー |
| C | line_index | number | ✅ | ✅ | | 1 or 2 |
| D | rally_seq | number | ✅ | ✅ | ✅ | セット内順序 |
| E | is_two_line | text | ✅ | ✅ | | TRUE/FALSE |
| F | source_file | text | ✅ | ✅ | | 動画ファイル名（表示用） |
| G | drive_file_id | text | ✅ | ✅ | | DriveファイルID（識別用） |
| H | confidence | number | ✅ | ✅ | | AI全体確信度 |
| I | rally_start_sec | number | ✅ | ✅ | | セット内絶対秒（開始） |
| J | rally_end_sec | number | ✅ | ✅ | | セット内絶対秒（終了） |
| K | date | text | ✅ | ✅ | | 日付 |
| L | opponent | text | ✅ | ✅ | | 相手チーム名 |
| M | set | number | ✅ | ✅ | | セット番号 |
| N | score_us | number | ✅ | ✅ | ✅ | 派生値 |
| O | score_them | number | ✅ | ✅ | ✅ | 派生値 |
| P | point_team | text | ✅ | ✅ | ✅ | 得点チーム |
| Q | serve_team | text | ✅ | ✅ | ✅ | 派生値 |
| R | rotation | number | ✅ | ✅ | ✅ | 派生値 |
| S | deciding_team | text | ✅ | ✅ | ✅ | 決定プレー実行チーム |
| T | receive_grade | text | ✅ | ✅ | ✅ | キャッチ評価 |
| U | receiver | text | ✅ | ✅ | ✅ | キャッチ選手 |
| V | team | text | ✅ | ✅ | ✅ | 派生値 |
| W | player | text | ✅ | ✅ | ✅ | 選手名 |
| X | play_type | text | ✅ | ✅ | ✅ | プレー種別 |
| Y | result | text | ✅ | ✅ | ✅ | 派生値 |
| Z | result_detail | text | ✅ | ✅ | ✅ | 結果詳細 |
| AA | attack_type | text | ✅ | ✅ | ✅ | 攻撃テンポ |
| AB | blocker_count | text | ✅ | ✅ | ✅ | ブロック枚数 |
| AC | zone_from | text | ✅ | ✅ | ✅ | 攻撃元ゾーン |
| AD | zone_to | text | ✅ | ✅ | ✅ | 落下先ゾーン |
| AE | note | text | ✅ | ✅ | ✅ | メモ |
| AF | ai_note | text | ✅ | ✅ | | AIの分析メモ |
| AG | field_confidences | text | ✅ | ✅ | | 項目別確信度JSON |
| AH | original_payload | text | ✅ | ✅ | | 正規化済みAI原案canonical JSON（不変。line1のみ） |
| AI | final_payload | text | | ✅ | ✅ | 承認時canonical JSON（line1のみ） |
| AJ | human_modified | text | | | ✅ | 修正項目名（line1のみ。派生値含めない） |
| AK | match_id | text | ✅ | ✅ | | 試合一意ID |
| AL | analysis_run_id | text | ✅ | ✅ | | Colab実行単位ID |
| AM | prompt_version | text | ✅ | ✅ | | プロンプトバージョン |
| AN | approved_at | text | | ✅ | ✅ | 承認日時 ISO 8601 UTC（line1のみ） |
| AO | initial_serve_team | text | ✅ | ✅ | | セット開始時サーブ権。同一セット全行同じ |
| AP | initial_rotation | number | ✅ | ✅ | | セット開始時ローテーション。同一セット全行同じ |
| AQ | approved_by | text | | ✅ | ✅ | 承認者メール（line1のみ。取得不可なら空文字列） |

#### 2行記録時のpayload保持

line_index=1のみ保持。line_index=2は空欄。対象: original_payload, final_payload, human_modified, approved_at, approved_by。

#### 2行記録時の列値

| 項目 | line1（自チーム守備） | line2（相手攻撃） |
|------|---------------------|------------------|
| rally_key / status | 同じ | 同じ |
| rally_start_sec〜score_them | 同じ | 同じ |
| point_team / deciding_team | 相手チーム名 | 相手チーム名 |
| serve_team / rotation | 同じ | 同じ |
| receive_grade / receiver | 同じ | 同じ |
| team | 自チーム | 相手チーム名 |
| player | null（初版AI原則null） | AIの出力値 |
| play_type | ディグ or ブロック | スパイク/フェイント/プッシュ |
| result | ミス | 得点 |
| initial_serve_team / initial_rotation | 同じ | 同じ |

### 5.3 「AI提案」→「生データ」列マッピング

deciding_team（S列）は転記しない。

| AI提案 | 生データ | カラム名 |
|:------:|:-------:|---------|
| K | A | date |
| L | B | opponent |
| M | C | set |
| N | D | score_us |
| O | E | score_them |
| P | F | point_team |
| Q | G | serve_team |
| R | H | rotation |
| T | I | receive_grade |
| U | J | receiver |
| V | K | team |
| W | L | player |
| X | M | play_type |
| Y | N | result |
| Z | O | result_detail |
| AA | P | attack_type |
| AB | Q | blocker_count |
| AC | R | zone_from |
| AD | S | zone_to |
| AE | T | note |

### 5.4 「AI精度ログ」シート（8列）

| 列 | カラム名 | 説明 |
|----|---------|------|
| A | date | 試合日 |
| B | set | セット番号 |
| C | rally_key | ラリー一意キー |
| D | field_name | 項目名 |
| E | ai_value | original_payloadの値 |
| F | human_value | final_payloadの値 |
| G | was_correct | 一致か（TRUE/FALSE） |
| H | ai_confidence | field_confidencesの値 |

#### 比較対象項目

**AIが直接提案した項目のみ。** 派生値は含めない。

| 比較対象（✅） | 対象外（❌） |
|:-------------:|:-----------:|
| point_team | score_us |
| deciding_team | score_them |
| receive_grade | serve_team |
| receiver | rotation |
| play_type | team |
| player | result |
| result_detail | |
| attack_type | |
| blocker_count | |
| zone_from | |
| zone_to | |
| our_defense_type | |

#### 記録対象外

`original_payload` が空のラリー（人手追加ラリー）は精度ログ対象外。

---

## 6. AI分析設計

### 6.1 判定基準

#### 6.1.1 レセプション（receive_grade）

A: セッター定位置に正確 / B: 1〜2歩移動 / C: 大きく崩れた・二段トス / D: 直接失点。自チームサーブ側はnull。

#### 6.1.2 決定プレー（play_type）

サーブ / スパイク / フェイント / プッシュ / ブロック / ディグ / 2段トス / フリーボール / レセプ（D判定時のみ自動設定）。

#### 6.1.3 deciding_teamと2行記録

team/resultは point_team + deciding_team + is_two_line + line_index + play_type から自動計算。

**1行記録:**

| point_team | deciding_team | team | result |
|-----------|---------------|------|--------|
| 自チーム | 自チーム | 自チーム | 得点 |
| 自チーム | 相手名 | 相手名 | ミス |
| 相手名 | 自チーム | 自チーム | ミス |

**2行記録（条件: point_team=相手名, deciding_team=相手名, play_type=スパイク/フェイント/プッシュ）:**

| line | team | result | 固定 |
|:----:|------|--------|:----:|
| 1 | 自チーム | ミス | ✅ |
| 2 | 相手名 | 得点 | ✅ |

1行目play_type=our_defense_type（デフォルト:ディグ）。1行目player=null（初版）。初版では構造変更不可。

#### 6.1.4〜6.1.7

result_detail: アウト/ネット/シャット/タッチネット/ダブルコンタクト/サービスエース/タッチアウト/タッチイン/吸い込み/ポジション/オーバーネット/お見合い/その他。

attack_type: Aクイック/Bクイック/Cクイック/Aセミ/Bセミ/Cセミ/並行/オープン/2段トス/ブロードワイド/ブロードショート。

blocker_count: 0/1/2/3。

ゾーン: 自左前/自中前/自右前/自左奥/自中奥/自右奥/相手左前/相手中前/相手右前/相手左奥/相手中奥/相手右奥。

```text
┌─────────────────────────┐
│      相手コート           │
│ 相手左奥│相手中奥│相手右奥 │
│ 相手左前│相手中前│相手右前 │
├─────────────────────────┤ ← ネット
│ 自左前  │自中前  │自右前   │
│ 自左奥  │自中奥  │自右奥   │
│      自コート            │
└─────────────────────────┘
```

### 6.2 AIに返させるJSON形式

```json
{
  "rallies": [
    {
      "rally_number": 1,
      "rally_start_sec": 12.5,
      "rally_end_sec": 28.3,
      "confidence": 0.85,
      "point_team": "自チーム",
      "deciding_team": "自チーム",
      "receive_grade": "B",
      "receiver": "りっきー",
      "play_type": "スパイク",
      "player": "ゆう",
      "result_detail": null,
      "attack_type": "並行",
      "blocker_count": "2",
      "zone_from": "自左前",
      "zone_to": "相手右奥",
      "our_defense_type": null,
      "note": "レフトから並行、クロスに決定",
      "field_confidences": {
        "point_team": 0.95, "deciding_team": 0.82,
        "receive_grade": 0.70, "receiver": 0.40,
        "play_type": 0.88, "player": 0.55,
        "result_detail": 0.30, "attack_type": 0.60,
        "blocker_count": 0.45, "zone_from": 0.58,
        "zone_to": 0.73, "our_defense_type": 0.66
      }
    }
  ]
}
```

### 6.3 システムプロンプト全文

```text
あなたはバレーボールの試合分析の専門家です。

## タスク
試合動画の一部（約3分間）を視聴し、全ラリーを検出・分析してください。

## チーム識別
- 画面手前側 = 「自チーム」、画面奥側 = 「相手」
- コートチェンジなし。ユニフォーム・背番号なし。コート位置のみで識別

## 選手識別
- ユーザープロンプトの選手写真を参照
- 服装ではなく体格・髪型・身長で識別。不明ならnull

## ラリーの定義
サーブのトスアップから得点確定まで。タイムアウト・休憩・選手交代は除外。

## 分析項目
- point_team（必須）: "自チーム" / "相手"
- deciding_team（必須）: ラリーを終わらせたプレーをしたチーム
- receive_grade: A/B/C/D/null（自チームサーブ側ならnull）
- receiver: 選手名/null
- play_type（必須）: サーブ/スパイク/フェイント/プッシュ/ブロック/ディグ/2段トス/フリーボール
- player: 選手名/null
- result_detail: アウト/ネット/シャット/タッチネット/ダブルコンタクト/サービスエース/タッチアウト/タッチイン/吸い込み/ポジション/オーバーネット/お見合い/その他/null
- attack_type: Aクイック/Bクイック/Cクイック/Aセミ/Bセミ/Cセミ/並行/オープン/2段トス/ブロードワイド/ブロードショート/null
- blocker_count: "0"/"1"/"2"/"3"/null
- zone_from/zone_to: 12ゾーン/null
- our_defense_type: "ブロック"/"ディグ"/null（相手攻撃で失点時のみ。不明なら"ディグ"）

## 確信度
confidence（全体）+ field_confidences（項目別12項目）。
0.8以上:明確 / 0.5〜0.79:おそらく / 0.5未満:推測（null推奨）

## タイムスタンプ
区間動画の先頭からの秒数。重複ラリーもそのまま出力。

## 出力形式
{
  "rallies": [{
    "rally_number": 整数,
    "rally_start_sec": 小数, "rally_end_sec": 小数,
    "confidence": 0.0-1.0,
    "point_team": "自チーム"/"相手",
    "deciding_team": "自チーム"/"相手",
    "receive_grade": .., "receiver": ..,
    "play_type": .., "player": ..,
    "result_detail": .., "attack_type": ..,
    "blocker_count": .., "zone_from": .., "zone_to": ..,
    "our_defense_type": .., "note": "..",
    "field_confidences": { 12項目 }
  }]
}

## 注意事項
- 不鮮明なら確信度を低く。推測よりnull
- タイムアウト・休憩はラリーとして検出しない
- 区間先頭/末尾でラリーが途中でもそのまま出力
```

### 6.4 ユーザープロンプト

```text
## 選手識別
[写真1] この人は「ゆう」です / [写真2] りっきー / ...
体格・髪型・身長で識別。不明ならnull。

## 試合情報
相手: レジン / セット: 1 / サーブ権: レジン / ローテーション: 1

## 区間情報
セット全体の {開始秒}〜{終了秒} の区間。前区間と20秒オーバーラップ。

## 指示
全ラリーを分析し、JSON形式で回答してください。
```

---

## 7. 派生値の自動計算

| 派生値 | 計算元 |
|--------|--------|
| score_us / score_them | point_team + ラリー順序 |
| serve_team | + initial_serve_team |
| rotation | + initial_serve_team + initial_rotation |
| team / result | point_team + deciding_team + is_two_line + line_index + play_type |

### 7.1 計算可否

| 派生値 | 初期値なしでも可 | 必要な初期値 |
|--------|:---------------:|------------|
| score | ✅ | なし |
| serve_team | ❌ | initial_serve_team |
| rotation | ❌ | initial_serve_team + initial_rotation |
| team / result | ✅ | なし |

未計算は空欄。

### 7.2 計算ルール

```text
初期: score_us=0, score_them=0
      serve_team=initial_serve_team（空欄なら計算しない）
      rotation=initial_rotation（空欄なら計算しない）

各ラリー（rally_seq順、line_index=1のみ）:
  point_team=="自チーム" → score_us++
  else → score_them++

  serve_teamが空欄でない場合:
    自チーム得点 かつ serve_team!=自チーム → serve_team=自チーム, rotation++（あれば）
    相手得点 かつ serve_team==自チーム → serve_team=相手チーム名

  2行記録 → line_index=2にも同じ派生値を設定
```

### 7.3 team/result自動決定

1行記録: 6.1.3節の基本ルール。
2行記録: line1=自チーム/ミス、line2=相手名/得点（固定）。

### 7.4 サービスエース

receive_grade=D かつ point_team=相手名 → play_type="レセプ", result_detail="サービスエース", team="自チーム", result="ミス"。2行記録非該当。

### 7.5 整合性チェック

セット終了スコア（25点2点差）、score合計=ラリー数、スコア非負。不一致は警告。

### 7.6 再計算トリガー

| 操作 | 再計算 |
|------|--------|
| point_team修正 | 以降全ラリーのscore/serve_team/rotation + team/result |
| deciding_teamのみ修正 | 該当ラリーのteam/resultのみ |
| ラリー削除/追加 | 以降全ラリー + rally_seq振り直し |
| 一括承認 | 不要 |

---

## 8. GAS側の設計

### 8.1 関数一覧

| 関数 | 役割 | Lock |
|------|------|:----:|
| `getAIProposals(setNumber)` | データ取得 | - |
| `getAIProposalSummary()` | 件数・ステータス集計 | - |
| `approveProposal(rallyKey, modifiedData)` | 承認 | ✅ |
| `bulkApproveHighConfidence(setNumber)` | HIGH一括承認 | ✅ |
| `deleteRally(rallyKey)` | 削除 | ✅ |
| `insertRally(afterRallyKey, rallyData)` | 追加 | ✅ |
| `recalcDerivedValues(setNumber)` | 派生値再計算 | ✅ |
| `commitToRawData(setNumber)` | 生データ転記 | ✅ |
| `getVideoLink(driveFileId, startSec)` | 動画リンク | - |

#### LockServiceルール

公開エントリポイントでのみ取得。内部ヘルパー（`_recalcDerivedValuesInternal`等）では再取得しない。

| 公開関数 | 内部ヘルパー呼び出し |
|---------|-------------------|
| approveProposal | `_recalcDerivedValuesInternal`（point_team変更時のみ） |
| deleteRally | `_recalcDerivedValuesInternal` |
| insertRally | `_recalcDerivedValuesInternal` |
| commitToRawData | `_recalcDerivedValuesInternal` |
| recalcDerivedValues | `_recalcDerivedValuesInternal` |

### 8.2 各関数の処理

#### approveProposal

1. Lock取得
2. rallyKeyで検索
3. 列値を修正で更新
4. **構造変更バリデーション**: 1行/2行判定がis_two_lineと不一致なら保存拒否
5. **deciding_teamのみ変更**: 該当ラリーのteam/resultのみ再決定
6. **point_team変更**: `_recalcDerivedValuesInternal(setNumber)` でセット全体の派生値再計算
7. ステータスAPPROVED（2行は2行とも）
8. original_payload不変
9. canonical JSONを構築しfinal_payloadに保存（line1のみ）
10. human_modifiedに修正項目名記録（line1のみ。派生値含めない）
11. approved_at UTC ISO 8601記録（line1のみ）
12. approved_by記録（line1のみ。取得不可なら空文字列）
13. Lock解放

#### bulkApproveHighConfidence

HIGHの全ラリーをAPPROVED。2行記録ペアもまとめて。final_payloadにcanonical JSON保存。approved_at/by記録。human_modifiedは空文字列のまま。**構造変更バリデーション不要**（列値を変更しないため）。

#### deleteRally

COMMITTED不可。2行は2行とも削除。rally_seq振り直し。`_recalcDerivedValuesInternal`で派生値再計算。

#### insertRally

pointTeam+decidingTeam必須。新rally_key採番。is_two_line=FALSE。original_payload空。ステータスAPPROVED。approved_at/by記録。initial_serve_team/initial_rotationは同一セット既存行から継承。rally_seq振り直し。派生値再計算。match_idは現セッション値。analysis_run_id/prompt_version空。

#### recalcDerivedValues

initial_serve_team/initial_rotationを同セットの行から読み取り。**line_index=1基準でラリー単位処理**。rally_seq順に派生値再計算。line2は同一rally_keyのline1結果を複製（score/serve_team/rotation）。team/resultは行ごとに異なる。整合性チェック実行。

#### commitToRawData

APPROVED以外あればエラー。派生値最終再計算。シート列値を「生データ」に転記（deciding_team転記しない）。2行は2行とも。COMMITTED化。COMMITTED済み再commitはエラー。精度ログ: line1かつoriginal_payload非空の行のみ、canonical JSON比較対象項目で比較。

### 8.3 ステータス

| 内部コード | 表示 |
|:----------:|------|
| HIGH | 🟢高確信 |
| MEDIUM | 🟡要確認 |
| LOW | 🔴低確信 |
| ERROR | ❌エラー |
| APPROVED | ✅承認済 |
| COMMITTED | 📝転記済 |

変換関数を1箇所に定義。ロジックは内部コードで判定。

### 8.4 HTMLモジュール分割

| モジュール | 責務 |
|-----------|------|
| ReviewState | 状態管理 |
| ReviewApi | GAS呼び出しラッパー |
| ReviewRenderer | カード・ヘッダー描画 |
| CardEditor | カード編集操作 |
| DerivedCalc | 派生値再計算（クライアント側プレビュー用） |
| ReviewNav | 画面遷移、セット切替 |
| StatusUtil | ステータスコード↔表示ラベル変換 |

### 8.5 CSSクラス

| クラス | スタイル |
|--------|---------|
| `.conf-high` | 通常表示 |
| `.conf-med` | 背景: #FFF9C4 |
| `.conf-low` | 背景: #FFCDD2 |
| `.conf-null` | 白背景、赤破線枠 |
| `.card-approved` | 背景: #E8F5E9、操作不可 |
| `.two-line-card` | 左ボーダー: 青太線 |
| `.derived-value` | 色: #888、イタリック |

---

## 9. エラーハンドリング

### 9.1 Colab側

| エラー | 対処 |
|--------|------|
| ffmpeg失敗 | 該当セットスキップ |
| アップロード失敗 | 3回リトライ（指数バックオフ） |
| 処理タイムアウト（5分） | 再アップロード |
| 処理FAILED | 該当区間スキップ |
| JSONパースエラー | 該当区間スキップ、スキップ数警告 |
| スキーマ検証エラー | 不正値null化。必須欠落は区間エラー |
| field_confidencesキー欠落 | 0.0補完 |
| ラリー数が想定50%未満 | 警告 |
| HTTP 429 | ウェイト倍増リトライ |
| HTTP 5xx | 再実行促すメッセージ |
| 選手写真読み込み失敗 | 警告、写真なしで続行 |
| セット順判定失敗 | 手動マッピング要求 |

### 9.2 GAS側

| エラー | 対処 |
|--------|------|
| AI提案シートなし | 「先にColab実行してください」 |
| データ0件 | 「分析データがありません」 |
| 動画リンク切れ | 「動画が見つかりません」、確認続行可 |
| rallyKey該当なし | エラーログ、操作スキップ |
| 2行ペア不整合 | エラー表示、手動確認促す |
| Lock取得失敗 | 「他ユーザーが操作中」 |
| commit時未承認あり | 「未承認ラリーがあります」 |
| COMMITTED再commit | 「既に転記済み」 |
| COMMITTED削除 | 「転記済みは削除不可」 |
| 構造変更バリデーション失敗 | 「構造変更は未対応。削除して再追加してください」 |

---

## 10. Colabノートブック構成

| セル | 責務 | ユーザー操作 |
|------|------|------------|
| 1 | 設定・認証、match_id/run_id/prompt_version生成 | 試合情報入力 |
| 2 | folder ID確定、file ID取得、セット順決定 | セット順確認（必要時） |
| 3 | 720p再エンコード、3分分割、1セットずつ都度削除 | なし |
| 4 | 区間アップロード→Gemini API→パース→検証→絶対秒変換→削除→5秒ウェイト | なし（待機） |
| 5 | 統合、重複排除、採番、派生値、2行展開、サービスエース、整合性チェック | なし |
| 6 | 再実行時削除、シート作成、全データ書き込み（正規化済みoriginal_payload含む）、サマリー | なし |
| 7 | DataFrame表示、確信度分布、エラー箇所（オプション） | 任意 |

パッケージ: google-generativeai>=0.8.0, gspread>=6.0.0, google-auth>=2.0.0

---

## 11. 運用フロー

### 試合当日

| 時間 | 作業 | 担当 |
|------|------|------|
| 試合前 | 選手写真撮影→Driveに保存 | **撮影者** |
| 試合前 | 三脚にiPhoneをセット | **撮影者** |
| 試合中 | セットごとに録画 | **撮影者** |
| 試合後 | 動画をDriveに保存 | **撮影者** |
| 試合後 | Colab実行→GAS確認→確定 | **分析担当者** |

### 試合後

1. Colab実行（5分入力+21〜36分待ち）
2. GAS「🤖AI確認」→ HIGH一括承認（1分）
3. MEDIUM/LOW個別確認（10〜20分）
4. ラリー追加/削除（数分）
5. 「全て確定→生データ」（1分）

**合計: 約40〜65分**

### 精度改善サイクル

AI分析 → 人間確認 → 精度ログ蓄積 → prompt_version別精度確認 → プロンプト改善 → 繰り返し

### Drive容量

一時ファイルは1セットごとに自動削除。Gemini区間動画も即削除。元動画は確定後に任意削除。

### セキュリティ

APIキーはColabシークレットまたは.local_secrets.json。ハードコード禁止。
Drive共有範囲について動画フォルダは撮影者と分析担当者の2人のみに共有。「リンクを知っている全員」にはしない

### 再実行ルール

同一match_id+setでCOMMITTED以外は削除置換。COMMITTED保護。

---

## 12. テスト方針

### Colab側

ffmpeg再エンコード/分割、セット順判定、選手写真読み込み、AI分析（短い動画）、スキーマ検証、field_confidences補完、絶対秒変換、重複排除、rally_key採番、スコア計算、派生値（初期値未入力時）、2行記録展開（1行目player=null確認）、サービスエース、original_payload（正規化済み確認）、シート書き込み（43列）、再実行上書き、選手写真なし、ディスク管理。

### GAS側

getAIProposals（1行/2行）、approve（1行/2行/構造変更拒否/deciding_team変更/point_team変更時再計算）、bulkApprove（human_modified空文字列/バリデーション不要）、delete（COMMITTED不可）、insert（initial値継承）、recalc（line1基準）、commit（転記/精度ログ/未承認エラー）、LockService、画面遷移、カード表示、派生値読み取り専用、動画プレビュー、既存機能回帰テスト。

---

## 13. リスクと対策

| リスク | 影響 | 確率 | 対策 |
|--------|:----:|:----:|------|
| AI精度低い | 高 | 中 | 人間全件確認。プロンプト改善 |
| Gemini無料枠変更 | 高 | 低 | 区間長延長でリクエスト削減 |
| 選手識別精度低い | 中 | 高 | null許容、UI重点確認 |
| 重複排除不正確 | 中 | 中 | 5秒閾値を運用調整 |
| ラリー検出漏れ/誤検出 | 高 | 中 | UIで追加/削除可能 |
| original_payload破壊 | 高 | 低 | 設計上不変、禁止事項明示 |

---

## 14. 成功指標

| 指標 | 目標 |
|------|------|
| AI確信度平均 | 70%以上 |
| HIGH割合 | 50%以上 |
| 修正率 | 30%以下 |
| point_team正解率 | 90%以上 |
| deciding_team正解率 | 85%以上 |
| play_type正解率 | 70%以上 |
| receive_grade正解率 | 60%以上 |
| player/receiver正解率 | 40%以上 |
| ラリー検出率 | 90%以上 |
| 総作業時間 | 65分以内 |

---

## 15. 開発スケジュール

| フェーズ | 内容 | 見積もり |
|---------|------|---------|
| A | Colab実装 | 4〜5日 |
| B | 精度検証・プロンプト調整 | 2〜3日 |
| C | GAS関数実装 | 3〜4日 |
| D | GAS確認UI | 4〜5日 |
| E | 結合テスト | 1〜2日 |
| F | 実試合テスト | 1日 |
| G | フィードバック反映 | 1〜2日 |
| **合計** | | **16〜22日** |

A→Bを先行しAI精度を早期検証。

---

## 16. 将来拡張

リアルタイム半自動化 / 自動セット分割 / 選手識別高度化 / 2行記録構造変更UI

---

## 17. ファイル構成

### 追加

| ファイル | 説明 |
|---------|------|
| `analysis/ai_analyze.ipynb` | 動画AI分析ノートブック |

### 変更

| ファイル | 変更 |
|---------|------|
| `gas/コード.gs` | 8.1節の全関数追加 |
| `gas/InputForm.html` | reviewScreen追加、モジュール分割 |
| `analysis/.local_secrets.example.json` | GEMINI_API_KEY追加 |
| `analysis/requirements.txt` | google-generativeai>=0.8.0追加 |

### シート構成

| シート | 列数 | 説明 |
|--------|:----:|------|
| 生データ（既存） | 20 | 変更なし |
| 設定（既存） | 3 | 変更なし |
| AI提案（新規） | 43 | AI分析結果 |
| AI精度ログ（新規） | 8 | 差分ログ |

---

## 18. 実装ルール（Windsurf向け）

### 18.1 実装順序

| # | 内容 | 受け入れ条件 |
|:-:|------|------------|
| 1 | 1区間でGemini応答確認 | JSONパース成功 |
| 2 | ffmpeg+全区間分析 | 全区間JSON取得 |
| 3 | スキーマ検証+絶対秒+重複排除 | 重複なしラリー一覧 |
| 4 | rally_key+派生値+2行展開 | スコア正しい |
| 5 | シート書き込み+再実行上書き | 43列正しい。original_payloadが正規化済み |
| 6 | GAS読み取りレビュー画面 | カード一覧表示 |
| 7 | approve+構造変更バリデーション | ステータス更新、original不変、final更新、構造変更拒否、point_team変更時再計算 |
| 8 | bulkApprove | HIGH全件APPROVED、human_modified空、バリデーション不要 |
| 9 | commit | 生データ転記、精度ログ（比較対象項目のみ、original空は除外） |
| 10 | delete+insert+recalc | rally_seq振り直し、派生値再計算、insert時initial値継承 |
| 11 | 精度ログ | original vs final、比較対象項目のみ、人手追加除外 |

### 18.2 禁止事項

| # | 禁止 | 理由 |
|---|------|------|
| 1 | 生データ20列スキーマ変更 | 既存連携が壊れる |
| 2 | セル逐次書き込み | パフォーマンス。batch必須 |
| 3 | 行番号を主キー | rally_keyで照合 |
| 4 | 絵文字でロジック判定 | 内部コード使用 |
| 5 | original_payloadに書き込み（初回以外） | AI原案破壊 |
| 6 | 派生値を手入力確定 | 再計算で確定 |
| 7 | ファイル名でファイル識別 | drive_file_id使用 |
| 8 | APIキーハードコード | セキュリティ |
| 9 | Lockなしで書き込み系実行 | 競合 |
| 10 | 2行記録の1行目だけ操作 | ペア不整合 |
| 11 | file IDでセット順ソート | 時系列非保証 |
| 12 | line2のpayload/modified/at/byに書き込み | line1のみ保持 |
| 13 | 内部ヘルパーでLock再取得 | ネストロック |
| 14 | approveで構造を暗黙変更 | バリデーションで拒否 |

### 18.3 受け入れ条件

#### approveProposal

- 1行→1行APPROVED、2行→2行ともAPPROVED
- original_payload不変
- 列値を修正で更新
- canonical JSONをfinal_payloadに保存（line1のみ）
- human_modifiedに修正項目名（派生値含めない。line1のみ）
- approved_at UTC ISO 8601（line1のみ）
- approved_byメール or 空文字列（line1のみ）
- 修正なしでもfinal_payload保存
- deciding_teamのみ変更 → team/resultのみ再決定
- point_team変更 → `_recalcDerivedValuesInternal` でセット全体再計算
- 構造変更（is_two_line不一致）→ 保存拒否

#### bulkApproveHighConfidence

- HIGH全件APPROVED（2行ペアもまとめて）
- original_payload不変、final_payloadにcanonical JSON保存（line1のみ）
- approved_at/by記録（line1のみ）
- human_modifiedは空文字列のまま
- 構造変更バリデーション不要

#### deleteRally

- rally_keyの行を削除（2行は2行とも）
- COMMITTED済みは削除不可
- rally_seq振り直し
- `_recalcDerivedValuesInternal` で派生値再計算

#### insertRally

- 指定位置に挿入、新rally_key採番
- is_two_line=FALSE, line_index=1
- original_payload空（人手追加）
- ステータスAPPROVED、approved_at/by記録
- initial_serve_team/initial_rotationは同一セット既存行から継承
- rally_seq振り直し、派生値再計算
- match_idは現セッション値、analysis_run_id/prompt_version空

#### recalcDerivedValues

- initial_serve_team/initial_rotationを同セットの行から読み取り
- **line_index=1基準でラリー単位処理**
- rally_seq順に全派生値再計算
- line2は同一rally_keyのline1結果を複製（score/serve_team/rotation）
- team/resultは行ごとに異なる（line_index依存）
- 整合性チェック実行、問題あればwarnings返却

#### commitToRawData

- APPROVED以外あればエラー
- `_recalcDerivedValuesInternal` で派生値最終再計算
- シート列値を「生データ」に転記（deciding_team転記しない）
- 2行は2行とも転記
- ステータスCOMMITTED化
- COMMITTED済み再commitはエラー
- 精度ログ: line1かつoriginal_payload非空の行のみ、canonical JSON比較対象項目で比較

### 18.4 Colab側受け入れ条件

#### ffmpeg

- 再エンコード: 1080p→720p H.264 faststart。元動画変更しない
- 分割: 3分区間、20秒オーバーラップ。末尾短くてもよい

#### セット順

ファイル名→createdTime→手動マッピング。file IDソート禁止。

#### Gemini API

max_output_tokens=8192, temperature=0.2, response_mime_type="application/json"。5秒ウェイト。3回リトライ。

#### JSONスキーマ検証

- point_team/deciding_team: "自チーム"/"相手"のみ → 他は区間エラー
- play_type/receive_grade/attack_type/blocker_count/zone: enum → 他はnull
- our_defense_type: ブロック/ディグ/null → 他は"ディグ"
- confidence: 0.0〜1.0 → 範囲外は0.0
- field_confidences: 欠落キーは0.0補完
- 必須（point_team/deciding_team/play_type）欠落 → 区間エラー

#### 変換・採番

- タイムスタンプ: 区間内秒→絶対秒変換してシート保存
- 重複排除: 絶対秒差5秒未満→同一ラリー、後の区間採用
- rally_key: `{match_id}_set{N}_rally{NNN}`（3桁ゼロ埋め）
- match_id: `{date}_{opponent}_game{N}`
- analysis_run_id: `run_{yyyymmdd}_{HHmmss}`
- prompt_version: ノートブック内定数
- "相手"→相手チーム名に変換

#### original_payload

- Gemini生レスポンスではなく**正規化済みAI原案のcanonical JSON**を保存
- 正規化済み = スキーマ検証後、null正規化後、"相手"→チーム名変換後、絶対秒変換後
- canonical JSONスキーマ = final_payloadと同一（精度ログ比較対象項目のみ）
- 精度ログ比較はこの正規化済みoriginal_payloadを基準に行う

#### 再実行

同一match_id+setでstatus!=COMMITTEDの行を全削除して置換。COMMITTED保護。

#### ディスク管理

1セットずつ処理、一時ファイル都度削除。Gemini区間動画は分析後即削除。


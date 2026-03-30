# カラム定義書

## 生データシート（20列）

| # | カラム名 | 型 | 説明 | 入力方法 |
|---|---------|-----|------|---------|
| A | date | text | 日付(yyyymmdd) | 初期設定 |
| B | opponent | text | 対戦相手 | 初期設定 |
| C | set | number | セット番号(1-5) | 自動 |
| D | score_us | number | 自チーム得点 | 自動 |
| E | score_them | number | 相手得点 | 自動 |
| F | point_team | text | 得点チーム | 自動 |
| G | serve_team | text | サーブ権 | 自動計算 |
| H | rotation | number | ローテーション(1-6) | 自動計算 |
| I | receive_grade | text | キャッチ評価(A/B/C/D) | ボタン |
| J | receiver | text | キャッチ選手 | ボタン |
| K | team | text | プレーしたチーム | 自動 |
| L | player | text | 選手名 | ボタン |
| M | play_type | text | プレー種別 | ボタン |
| N | result | text | 結果(得点/ミス) | 自動 |
| O | result_detail | text | 結果詳細 | リスト |
| P | attack_type | text | 攻撃テンポ | リスト |
| Q | blocker_count | text | ブロック枚数(0-3) | ボタン |
| R | zone_from | text | 攻撃元ゾーン | コート |
| S | zone_to | text | 落下先ゾーン | コート |
| T | note | text | メモ | テキスト |

## play_type 一覧
- サーブ
- スパイク
- フェイント
- プッシュ
- ブロック
- トス
- ディグ
- フリーボール

## result_detail 一覧（設定シートで管理）
- ネット
- アウト
- シャット
- ダブルコンタクト
- タッチネット
- サービスエース
- その他

## point_team / team の値
- "自チーム" = 自チーム
- 相手チーム名 = 相手

## パターン
| パターン | point_team | team | result | 説明 |
|---------|-----------|------|--------|------|
| 1 | 自チーム | 自チーム | 得点 | 自チームが得点 |
| 2 | 自チーム | 相手名 | ミス | 相手ミスで得点 |
| 4 | 相手名 | 自チーム | ミス | 自チームミスで失点 |
| エース | 相手名 | 自チーム | ミス | サービスエース(D判定) |

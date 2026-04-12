"""
動画AI分析スクリプト（ローカル実行用）
ai_analyze.ipynbのロジックをコマンドラインから実行できるスタンドアロンスクリプトに統合。

使い方:
  python run_analysis.py \
    --date 2026-04-12 \
    --opponent テスト \
    --set 1 \
    --serve-team テスト \
    --rotation 1 \
    --drive-file-id 1iz8llxRGksr-jYpnwcy0FPvKeRAVjwQM
"""

import os
import sys
import json
import math
import time
import subprocess
import argparse
from pathlib import Path
from datetime import datetime

import gdown
import gspread
import google.genai as genai


# ============================================
# シークレット読み込み
# ============================================

def load_local_secrets():
    """ローカルの秘密ファイルを読み込む"""
    candidates = [
        Path('.local_secrets.json'),
        Path('analysis/.local_secrets.json'),
    ]
    for p in candidates:
        if p.exists():
            try:
                data = json.loads(p.read_text(encoding='utf-8'))
                if isinstance(data, dict):
                    print(f'シークレットファイル読み込み: {p}')
                    return data
            except Exception:
                pass
    return {}


LOCAL_SECRETS = load_local_secrets()


def get_secret(key_name):
    """環境変数 → シークレットファイルの順で取得"""
    env_value = str(os.getenv(key_name, '')).strip()
    if env_value:
        return env_value
    return str(LOCAL_SECRETS.get(key_name, '')).strip()


# ============================================
# プロンプト定義（設計書§6.3, §6.4）
# ============================================

SYSTEM_PROMPT = """あなたはバレーボールの試合分析の専門家です。

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
"""


def build_user_prompt(match_info, start_sec, end_sec):
    """ユーザープロンプト構築（設計書§6.4）"""
    opponent = match_info.get("opponent", "相手")
    set_num = match_info.get("set", 1)
    serve_team = match_info.get("serve_team", "自チーム")
    rotation = match_info.get("rotation", 1)

    prompt = f"""## 選手識別
選手写真がある場合は参照してください。体格・髪型・身長で識別。不明ならnull。

## 試合情報
相手: {opponent} / セット: {set_num} / サーブ権: {serve_team} / ローテーション: {rotation}

## 区間情報
セット全体の {start_sec:.1f}秒〜{end_sec:.1f}秒 の区間。前区間と20秒オーバーラップ。

## 指示
全ラリーを分析し、JSON形式で回答してください。"""

    return prompt


# ============================================
# ヘルパー関数
# ============================================

def download_video(file_id, output_path):
    """Google Driveから動画をダウンロード"""
    print(f'Google Driveから動画ダウンロード: {file_id}')
    url = f'https://drive.google.com/uc?id={file_id}'
    gdown.download(url, output_path, quiet=False)
    file_size = Path(output_path).stat().st_size
    print(f'ダウンロード完了: {output_path} ({file_size / 1024 / 1024:.1f} MB)')
    return output_path


def encode_720p(input_path, output_path):
    """720p H.264 faststart再エンコード"""
    print(f'720p再エンコード開始: {input_path}')
    cmd = [
        'ffmpeg', '-i', input_path,
        '-vf', 'scale=-2:720',
        '-c:v', 'libx264',
        '-movflags', '+faststart',
        '-c:a', 'aac',
        '-y',
        output_path
    ]
    subprocess.run(cmd, check=True, capture_output=True)
    size = Path(output_path).stat().st_size
    print(f'再エンコード完了: {output_path} ({size / 1024 / 1024:.1f} MB)')


def get_video_duration(video_path):
    """動画の長さ（秒）を取得"""
    cmd = [
        'ffprobe', '-v', 'error',
        '-show_entries', 'format=duration',
        '-of', 'default=noprint_wrappers=1:nokey=1',
        video_path
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, check=True)
    return float(result.stdout.strip())


def split_segments(video_path, temp_dir, segment_duration=180, overlap_sec=20):
    """3分区間に分割（20秒オーバーラップ）"""
    duration = get_video_duration(video_path)
    print(f'動画長: {duration:.1f}秒')

    if duration > segment_duration:
        num_segments = math.ceil(
            (duration - segment_duration) / (segment_duration - overlap_sec)
        ) + 1
    else:
        num_segments = 1
    print(f'分割区間数: {num_segments}')

    segments = []
    for i in range(num_segments):
        start = i * (segment_duration - overlap_sec)
        end = min(start + segment_duration, duration)
        if start >= duration:
            break
        seg_path = str(Path(temp_dir) / f'segment_{i:02d}.mp4')

        print(f'  区間{i}: {start:.1f}s 〜 {end:.1f}s')
        cmd = [
            'ffmpeg', '-ss', str(start), '-to', str(end),
            '-i', video_path,
            '-c', 'copy', '-y',
            seg_path
        ]
        subprocess.run(cmd, check=True, capture_output=True)

        seg_size = Path(seg_path).stat().st_size
        print(f'    → {seg_path} ({seg_size / 1024 / 1024:.1f} MB)')
        segments.append({
            'index': i,
            'start_sec': start,
            'end_sec': end,
            'path': seg_path,
        })

    return segments


def upload_video_to_gemini(client, video_path, max_wait_sec=60):
    """動画をGemini File APIにアップロードし、ACTIVE状態を待機"""
    print(f'  Geminiアップロード: {Path(video_path).name}')
    video_file = client.files.upload(file=video_path)
    print(f'  アップロード完了: {video_file.name}')
    
    # ACTIVE状態をポーリングで待機
    print(f'  ACTIVE状態待機中...')
    for i in range(max_wait_sec):
        vf = client.files.get(name=video_file.name)
        if vf.state.name == 'ACTIVE':
            print(f'  ACTIVE確認完了 ({i+1}秒)')
            return video_file
        time.sleep(1)
    print(f'  ⚠️ ACTIVE待機タイムアウト ({max_wait_sec}秒)。処理を続行します。')
    return video_file


def delete_gemini_file(client, video_file):
    """Gemini File APIからファイルを削除"""
    try:
        client.files.delete(name=video_file.name)
        print(f'  Geminiファイル削除: {video_file.name}')
    except Exception as e:
        print(f'  Geminiファイル削除失敗: {e}')


def validate_and_normalize_rally(rally):
    """スキーマ検証・正規化（設計書§6）"""
    errors = []
    validated = {}

    # 必須フィールド
    required = ['rally_number', 'rally_start_sec', 'rally_end_sec',
                'confidence', 'point_team', 'deciding_team', 'play_type']
    for f in required:
        if f not in rally:
            errors.append(f'必須フィールド欠落: {f}')
            return None, errors

    validated['rally_number'] = int(rally['rally_number'])
    validated['rally_start_sec'] = float(rally['rally_start_sec'])
    validated['rally_end_sec'] = float(rally['rally_end_sec'])
    validated['confidence'] = float(rally['confidence'])
    validated['point_team'] = rally['point_team']
    validated['deciding_team'] = rally['deciding_team']
    validated['play_type'] = rally['play_type']

    # オプションフィールド
    optional = ['receive_grade', 'receiver', 'player', 'result_detail',
                'attack_type', 'blocker_count', 'zone_from', 'zone_to',
                'our_defense_type', 'note']
    for f in optional:
        value = rally.get(f)
        if value is None or value == 'null':
            validated[f] = ''
        else:
            validated[f] = str(value).strip()

    # field_confidences補完
    fc = rally.get('field_confidences', {})
    cf_fields = ['point_team', 'deciding_team', 'receive_grade', 'receiver',
                 'play_type', 'player', 'result_detail', 'attack_type',
                 'blocker_count', 'zone_from', 'zone_to', 'our_defense_type']
    validated['field_confidences'] = {
        f: float(fc.get(f, 0.0)) for f in cf_fields
    }

    return validated, errors


def remove_duplicates(rallies, threshold_sec=5.0):
    """重複排除（設計書§3.3）"""
    if not rallies:
        return []
    sorted_rallies = sorted(rallies, key=lambda x: x['absolute_start_sec'])
    deduped = []
    for rally in sorted_rallies:
        if not deduped:
            deduped.append(rally)
        else:
            prev = deduped[-1]
            time_diff = rally['absolute_start_sec'] - prev['absolute_end_sec']
            if time_diff < threshold_sec:
                print(f'  重複検出: ラリー{rally["rally_number"]}（差: {time_diff:.1f}s）')
                continue
            deduped.append(rally)
    return deduped


# ============================================
# Gemini API呼び出し
# ============================================

def extract_retry_delay(error_str):
    """エラーメッセージからretryDelayを抽出"""
    import re
    m = re.search(r'\"retryDelay\":\s*\"(\d+)s\"', str(error_str))
    if m:
        return int(m.group(1))
    return None


def call_gemini(client, model_name, video_file, system_prompt, user_prompt, max_retries=5):
    """Gemini API呼び出し（リトライ付き）。レートリミット時は長時間待機。"""
    for attempt in range(max_retries):
        try:
            print(f'  Gemini API呼び出し... (試行 {attempt + 1}/{max_retries})')
            contents = [user_prompt, video_file]
            response = client.models.generate_content(
                model=model_name,
                contents=contents,
                config={
                    "response_mime_type": "application/json",
                    "max_output_tokens": 65536,
                    "temperature": 0.2,
                    "system_instruction": system_prompt,
                }
            )
            print('  API呼び出し完了')
            return response
        except Exception as e:
            err_str = str(e)
            print(f'  APIエラー: {err_str[:100]}...')
            
            # 429エラー：APIの指定した秒数待機
            if '429' in err_str or 'RESOURCE_EXHAUSTED' in err_str:
                retry_delay = extract_retry_delay(err_str)
                if retry_delay:
                    wait = retry_delay + 5  # 余裕を持たせる
                    print(f'  ⏸️ Rate Limit: {wait}秒待機...')
                    time.sleep(wait)
                    continue
            
            if attempt < max_retries - 1:
                wait = min(2 ** attempt, 60)
                print(f'  {wait}秒待機...')
                time.sleep(wait)
            else:
                raise


def analyze_segments(client, model_name, segments, match_info):
    """全区間をGemini APIで分析"""
    all_rallies = []
    skipped = 0

    for seg in segments:
        print(f'\n=== 区間 {seg["index"]} ({seg["start_sec"]:.1f}s 〜 {seg["end_sec"]:.1f}s) ===')

        # アップロード
        try:
            video_file = upload_video_to_gemini(client, seg['path'])
        except Exception as e:
            print(f'  アップロード失敗: {e}')
            skipped += 1
            continue

        # プロンプト構築
        user_prompt = build_user_prompt(match_info, seg['start_sec'], seg['end_sec'])

        # API呼び出し
        try:
            response = call_gemini(client, model_name, video_file, SYSTEM_PROMPT, user_prompt)
        except Exception as e:
            print(f'  API失敗: {e}')
            delete_gemini_file(client, video_file)
            skipped += 1
            continue

        # JSONパース・検証
        try:
            data = json.loads(response.text)
            if 'rallies' not in data:
                print(f'  ralliesキーなし')
                delete_gemini_file(client, video_file)
                skipped += 1
                continue

            rallies = data['rallies']
            print(f'  {len(rallies)}ラリー検出')

            for rally in rallies:
                validated, errors = validate_and_normalize_rally(rally)
                if validated is None:
                    print(f'    ラリー{rally.get("rally_number","?")} エラー: {errors}')
                    continue
                # 絶対秒変換
                validated['absolute_start_sec'] = seg['start_sec'] + validated['rally_start_sec']
                validated['absolute_end_sec'] = seg['start_sec'] + validated['rally_end_sec']
                validated['segment_index'] = seg['index']
                all_rallies.append(validated)

        except json.JSONDecodeError as e:
            print(f'  JSONパースエラー: {e}')
            skipped += 1

        # Geminiファイル削除 → 60秒ウェイト（レートリミット回避）
        delete_gemini_file(client, video_file)
        print(f'  ⏸️ 区間間待機 60秒...')
        time.sleep(60)

    if skipped > 0:
        print(f'\n⚠️ {skipped}区間スキップ')

    return all_rallies


# ============================================
# ラリー後処理（派生値・2行展開・サービスエース）
# ============================================

def process_rallies(deduped_rallies, match_id, analysis_run_id, prompt_version,
                    opponent, set_number, initial_serve_team, initial_rotation):
    """採番・派生値・2行展開・サービスエース・整合性チェック"""

    # "相手"→実際の相手チーム名に置換
    for rally in deduped_rallies:
        if rally['point_team'] == '相手':
            rally['point_team'] = opponent
        if rally['deciding_team'] == '相手':
            rally['deciding_team'] = opponent

    # rally_key採番
    processed = []
    rally_seq = 1
    for rally in deduped_rallies:
        rally['rally_key'] = f'{match_id}_set{set_number}_rally{rally_seq:03d}'
        rally['rally_seq'] = rally_seq
        rally['set'] = set_number
        rally['match_id'] = match_id
        rally['analysis_run_id'] = analysis_run_id
        rally['prompt_version'] = prompt_version
        rally['status'] = (
            'HIGH' if rally['confidence'] >= 0.8
            else 'MEDIUM' if rally['confidence'] >= 0.5
            else 'LOW'
        )
        rally_seq += 1
        processed.append(rally)

    # 派生値計算
    score_us = 0
    score_them = 0
    serve_team = initial_serve_team
    rotation = initial_rotation
    two_line_rows = []

    for rally in processed:
        if rally['point_team'] == '自チーム':
            score_us += 1
        else:
            score_them += 1

        rally['score_us'] = score_us
        rally['score_them'] = score_them

        # サーブ権・ローテーション
        if serve_team:
            if rally['point_team'] == '自チーム' and serve_team != '自チーム':
                serve_team = '自チーム'
                rotation = (rotation % 6) + 1
            elif rally['point_team'] != '自チーム' and serve_team == '自チーム':
                serve_team = opponent

        rally['serve_team'] = serve_team or ''
        rally['rotation'] = rotation if serve_team else ''

        # 2行記録判定
        pt = rally['play_type']
        is_two_line = (
            rally['point_team'] == opponent and
            rally['deciding_team'] == opponent and
            pt in ['スパイク', 'フェイント', 'プッシュ']
        )
        rally['is_two_line'] = 'TRUE' if is_two_line else 'FALSE'

        # サービスエース判定（設計書§7.4）
        if rally['receive_grade'] == 'D' and rally['point_team'] == opponent:
            rally['play_type'] = 'レセプ'
            rally['result_detail'] = 'サービスエース'
            rally['is_two_line'] = 'FALSE'
            is_two_line = False

        # team/result決定
        if is_two_line:
            rally['team'] = '自チーム'
            rally['result'] = 'ミス'
        else:
            dt = rally['deciding_team']
            if dt == '自チーム':
                rally['team'] = '自チーム'
                rally['result'] = '得点' if rally['point_team'] == '自チーム' else 'ミス'
            else:
                rally['team'] = opponent
                rally['result'] = '得点' if rally['point_team'] == opponent else 'ミス'

        rally['line_index'] = 1

        # 2行記録展開
        if is_two_line:
            our_def = rally.get('our_defense_type', '') or 'ディグ'
            rally2 = rally.copy()
            rally2['line_index'] = 2
            rally2['team'] = opponent
            rally2['result'] = '得点'
            rally2['player'] = ''
            rally2['receiver'] = ''
            two_line_rows.append(rally2)
            # line1のplay_typeをour_defense_typeに
            rally['play_type'] = our_def
            rally['player'] = ''

    processed.extend(two_line_rows)

    # 整合性チェック
    total = len([r for r in processed if r['line_index'] == 1])
    score_sum = score_us + score_them
    print(f'\n=== 整合性チェック ===')
    print(f'ラリー数: {total}')
    print(f'最終スコア: 自チーム {score_us} - {score_them} {opponent}')
    if score_sum != total:
        print(f'⚠️ スコア合計({score_sum}) != ラリー数({total})')

    return processed


# ============================================
# Sheets書き込み
# ============================================

AI_HEADERS = [
    'status', 'rally_key', 'line_index', 'rally_seq', 'is_two_line',
    'source_file', 'drive_file_id', 'confidence', 'rally_start_sec', 'rally_end_sec',
    'date', 'opponent', 'set', 'score_us', 'score_them',
    'point_team', 'serve_team', 'rotation', 'deciding_team',
    'receive_grade', 'receiver', 'team', 'player', 'play_type', 'result',
    'result_detail', 'attack_type', 'blocker_count', 'zone_from', 'zone_to',
    'note', 'ai_note', 'field_confidences', 'original_payload', 'final_payload',
    'human_modified', 'match_id', 'analysis_run_id', 'prompt_version',
    'approved_at', 'initial_serve_team', 'initial_rotation', 'approved_by',
]


def build_canonical_json(rally):
    """canonical JSON構築（設計書§5.2）"""
    fields = ['point_team', 'deciding_team', 'receive_grade', 'receiver',
              'play_type', 'player', 'result_detail', 'attack_type',
              'blocker_count', 'zone_from', 'zone_to', 'our_defense_type']
    return json.dumps({f: rally.get(f, '') for f in fields}, sort_keys=True, ensure_ascii=False)


def write_to_sheet(processed, match_id, match_date, opponent, set_number,
                   drive_file_id, initial_serve_team, initial_rotation):
    """AI提案シートに書き込み"""
    # Google Sheets認証
    sa_file = get_secret('GOOGLE_SERVICE_ACCOUNT_FILE')
    if not sa_file:
        raise ValueError('GOOGLE_SERVICE_ACCOUNT_FILE が未設定です')

    # サービスアカウントファイルのパスを解決
    sa_path = Path(sa_file)
    if not sa_path.exists():
        # analysis/から実行している場合
        alt = Path('analysis') / sa_path.name
        if alt.exists():
            sa_path = alt
        else:
            raise FileNotFoundError(f'サービスアカウントファイルが見つかりません: {sa_file}')

    gc = gspread.service_account(filename=str(sa_path))

    sheet_id = get_secret('SHEET_ID')
    if not sheet_id:
        raise ValueError('SHEET_ID が未設定です')

    sh = gc.open_by_key(sheet_id)
    print(f'スプレッドシート: {sh.title}')

    # AI提案シートを取得または作成
    AI_SHEET_NAME = 'AI提案'
    try:
        ai_sheet = sh.worksheet(AI_SHEET_NAME)
        print(f'{AI_SHEET_NAME}シート: 既存')

        # 再実行時削除（同一match_id+setでstatus!=COMMITTEDの行を削除）
        existing = ai_sheet.get_all_values()
        if len(existing) > 1:
            header = existing[0]
            mi_idx = header.index('match_id') if 'match_id' in header else -1
            s_idx = header.index('set') if 'set' in header else -1
            st_idx = header.index('status') if 'status' in header else -1

            if mi_idx >= 0 and s_idx >= 0 and st_idx >= 0:
                to_del = []
                for i, row in enumerate(existing[1:], start=2):
                    if len(row) > max(mi_idx, s_idx, st_idx):
                        if (row[mi_idx] == match_id and
                                str(row[s_idx]) == str(set_number) and
                                row[st_idx] != 'COMMITTED'):
                            to_del.append(i)
                for row_idx in sorted(to_del, reverse=True):
                    ai_sheet.delete_rows(row_idx)
                if to_del:
                    print(f'再実行時削除: {len(to_del)}行')

    except gspread.WorksheetNotFound:
        print(f'{AI_SHEET_NAME}シート: 新規作成')
        ai_sheet = sh.add_worksheet(title=AI_SHEET_NAME, rows=1000, cols=43)

    # ヘッダー確認
    if len(ai_sheet.row_values(1)) == 0:
        ai_sheet.append_row(AI_HEADERS)
        print('ヘッダー行を設定')

    # データ行構築
    rows = []
    for r in processed:
        row = [
            r.get('status', ''),
            r.get('rally_key', ''),
            r.get('line_index', 1),
            r.get('rally_seq', 0),
            r.get('is_two_line', 'FALSE'),
            '',  # source_file
            drive_file_id,
            r.get('confidence', 0),
            r.get('absolute_start_sec', 0),
            r.get('absolute_end_sec', 0),
            match_date,
            opponent,
            r.get('set', set_number),
            r.get('score_us', 0),
            r.get('score_them', 0),
            r.get('point_team', ''),
            r.get('serve_team', ''),
            r.get('rotation', ''),
            r.get('deciding_team', ''),
            r.get('receive_grade', ''),
            r.get('receiver', ''),
            r.get('team', ''),
            r.get('player', ''),
            r.get('play_type', ''),
            r.get('result', ''),
            r.get('result_detail', ''),
            r.get('attack_type', ''),
            r.get('blocker_count', ''),
            r.get('zone_from', ''),
            r.get('zone_to', ''),
            r.get('note', ''),
            '',  # ai_note
            json.dumps(r.get('field_confidences', {}), ensure_ascii=False),
            build_canonical_json(r) if r.get('line_index') == 1 else '',
            '',  # final_payload
            '',  # human_modified
            r.get('match_id', match_id),
            r.get('analysis_run_id', ''),
            r.get('prompt_version', ''),
            '',  # approved_at
            initial_serve_team,
            initial_rotation,
            '',  # approved_by
        ]
        rows.append(row)

    if rows:
        ai_sheet.append_rows(rows)
        print(f'データ書き込み完了: {len(rows)}行')

    # サマリー
    line1 = [r for r in processed if r.get('line_index') == 1]
    high = len([r for r in line1 if r['status'] == 'HIGH'])
    med = len([r for r in line1 if r['status'] == 'MEDIUM'])
    low = len([r for r in line1 if r['status'] == 'LOW'])
    avg_conf = sum(r['confidence'] for r in line1) / len(line1) if line1 else 0

    print(f'\n=== サマリー ===')
    print(f'総ラリー数: {len(line1)}')
    print(f'HIGH: {high} / MEDIUM: {med} / LOW: {low}')
    print(f'確信度平均: {avg_conf:.2f}')


# ============================================
# 一時ファイル削除
# ============================================

def cleanup(temp_files):
    """一時ファイルを削除"""
    print('\n一時ファイル削除...')
    for f in temp_files:
        try:
            Path(f).unlink()
            print(f'  削除: {f}')
        except Exception as e:
            print(f'  削除失敗: {f} - {e}')


# ============================================
# メイン処理
# ============================================

def main():
    parser = argparse.ArgumentParser(description='バレーボール動画AI分析')
    parser.add_argument('--date', required=True, help='試合日（YYYY-MM-DD）')
    parser.add_argument('--opponent', required=True, help='相手チーム名')
    parser.add_argument('--set', type=int, required=True, help='セット番号')
    parser.add_argument('--serve-team', required=True, help='最初のサーブ権（自チーム or 相手チーム名）')
    parser.add_argument('--rotation', type=int, default=1, help='最初のローテーション（1-6）')
    parser.add_argument('--drive-file-id', required=True, help='Google Drive動画ファイルID')
    parser.add_argument('--game', type=int, default=1, help='ゲーム番号（デフォルト1）')
    args = parser.parse_args()

    # 定数
    match_id = f'{args.date}_{args.opponent}_game{args.game}'
    now = datetime.now()
    analysis_run_id = f'run_{now.strftime("%Y%m%d")}_{now.strftime("%H%M%S")}'
    prompt_version = 'v1.0'
    model_name = 'gemini-2.5-flash'

    print('=' * 60)
    print('バレーボール動画AI分析')
    print('=' * 60)
    print(f'match_id: {match_id}')
    print(f'analysis_run_id: {analysis_run_id}')
    print(f'セット: {args.set} / サーブ権: {args.serve_team} / ローテーション: {args.rotation}')
    print(f'Drive File ID: {args.drive_file_id}')
    
    # 無料枠警告
    print('\n⚠️ 重要: Gemini 2.5 Flash 無料枠は 1日20リクエストです')
    print('   動画長に応じて複数区間に分割されるため、1セットで複数回API呼び出しがあります')
    print('   この動画は約7区間に分割される予定です（=7リクエスト消費）')
    print('   429エラーが出た場合は、明日または別のGemini APIキーで再実行してください')

    # Gemini API Key確認
    api_key = get_secret('GEMINI_API_KEY')
    if not api_key:
        print('❌ GEMINI_API_KEY が未設定です')
        sys.exit(1)

    # 作業ディレクトリ
    temp_dir = Path('analysis/temp')
    temp_dir.mkdir(exist_ok=True)

    temp_files = []

    try:
        # Step 1: 動画ダウンロード
        print('\n--- Step 1: 動画ダウンロード ---')
        download_path = str(temp_dir / 'original.mp4')
        download_video(args.drive_file_id, download_path)
        temp_files.append(download_path)

        # Step 2: 720pエンコード
        print('\n--- Step 2: 720p再エンコード ---')
        encoded_path = str(temp_dir / 'video_720p.mp4')
        encode_720p(download_path, encoded_path)
        temp_files.append(encoded_path)

        # Step 3: 区間分割
        print('\n--- Step 3: 3分区間分割 ---')
        segments = split_segments(encoded_path, str(temp_dir))
        for seg in segments:
            temp_files.append(seg['path'])

        # Step 4: Gemini API分析
        print('\n--- Step 4: Gemini API分析 ---')
        client = genai.Client(api_key=api_key)
        match_info = {
            'opponent': args.opponent,
            'set': args.set,
            'serve_team': args.serve_team,
            'rotation': args.rotation,
        }
        all_rallies = analyze_segments(client, model_name, segments, match_info)
        print(f'\n全区間分析完了: {len(all_rallies)}ラリー検出')

        # Step 5: 重複排除
        print('\n--- Step 5: 重複排除 ---')
        deduped = remove_duplicates(all_rallies)
        print(f'重複排除: {len(all_rallies)} → {len(deduped)}ラリー')

        # Step 6: 後処理（派生値・2行展開・サービスエース）
        print('\n--- Step 6: ラリー後処理 ---')
        processed = process_rallies(
            deduped, match_id, analysis_run_id, prompt_version,
            args.opponent, args.set, args.serve_team, args.rotation
        )
        print(f'処理完了: {len(processed)}行（2行展開含む）')

        # Step 7: Sheets書き込み
        print('\n--- Step 7: AI提案シート書き込み ---')
        write_to_sheet(
            processed, match_id, args.date, args.opponent, args.set,
            args.drive_file_id, args.serve_team, args.rotation
        )

        print('\n' + '=' * 60)
        print('✅ 分析完了！GAS Web Appで確認・承認してください。')
        print('=' * 60)

    except Exception as e:
        print(f'\n❌ エラー: {e}')
        # 429エラーの場合は特別メッセージ
        if '429' in str(e) or 'quota' in str(e).lower():
            print('\n💡 Gemini APIの日次無料枠（20リクエスト）を超過した可能性があります。')
            print('   対策: 明日再実行するか、別のGemini APIキーを使用してください。')
            print('   参照: https://ai.google.dev/gemini-api/docs/rate-limits')
        import traceback
        traceback.print_exc()
        sys.exit(1)

    finally:
        # 一時ファイル削除
        cleanup(temp_files)
        # tempディレクトリも削除（空なら）
        try:
            temp_dir.rmdir()
        except OSError:
            pass


if __name__ == '__main__':
    main()

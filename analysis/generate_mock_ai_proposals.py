#!/usr/bin/env python3
"""
AI提案シート用モックデータ生成スクリプト
手動テスト用にAI提案データを生成して「AI提案」シートに書き込みます
"""

import json
import random
from pathlib import Path
import gspread
from google.oauth2.service_account import Credentials

# 設定
SHEET_NAME = 'バレースタッツ'
SHEET_ID = ''  # 空の場合はシート名で検索
AI_PROPOSALS_SHEET_NAME = 'AI提案'

# モックデータ設定
MOCK_DATE = '20260329'
MOCK_OPPONENT = 'レジン'
MOCK_MATCH_ID = f'{MOCK_DATE}_{MOCK_OPPONENT}_game1'
MOCK_ANALYSIS_RUN_ID = 'run_20260329_000000'
MOCK_PROMPT_VERSION = 'v1.0'

# チーム名
TEAM_US = '自チーム'
TEAM_THEM = MOCK_OPPONENT

# 選手リスト
PLAYERS = ['ゆう', 'りっきー', 'れんれん', 'たいち', 'そうた', 'けんた']

# プレータイプ
PLAY_TYPES = ['サーブ', 'スパイク', 'フェイント', 'プッシュ', 'ブロック', 'ディグ']

# キャッチ評価
RECEIVE_GRADES = ['A', 'B', 'C', 'D']

# 攻撃テンポ
ATTACK_TYPES = ['並行', 'クロス', 'バック', 'なし']

# ゾーン（12ゾーン）
ZONES = ['自左奥', '自左前', '自中央', '自右前', '自右奥', '自中央奥',
         '相手左奥', '相手左前', '相手中央', '相手右前', '相手右奥', '相手中央奥']

# ブロック枚数
BLOCKER_COUNTS = ['0', '1', '2', '3']


def load_secrets():
    """シークレット設定を読み込み"""
    # カレントディレクトリからの相対パスを試す
    candidates = [
        Path('.local_secrets.json'),
        Path('../.local_secrets.json'),
        Path('analysis/.local_secrets.json'),
    ]
    
    for p in candidates:
        if p.exists():
            with open(p, 'r', encoding='utf-8') as f:
                print(f'シークレットファイルを読み込み: {p}')
                return json.load(f)
    
    print('警告: シークレットファイルが見つかりません')
    return {}


def get_gspread_client():
    """gspreadクライアントを取得"""
    secrets = load_secrets()
    service_account_file = secrets.get('GOOGLE_SERVICE_ACCOUNT_FILE')
    
    # Google Sheets APIに必要なスコープ
    SCOPES = [
        'https://www.googleapis.com/auth/spreadsheets',
        'https://www.googleapis.com/auth/drive'
    ]
    
    if service_account_file:
        # 指定されたファイルを使用
        p = Path(service_account_file)
        if not p.exists():
            # 実行ディレクトリ差異を吸収
            p = Path(p.name)
        if p.exists():
            creds = Credentials.from_service_account_file(str(p), scopes=SCOPES)
            return gspread.authorize(creds)
    
    # デフォルトのservice_account.jsonを探索
    candidates = [
        Path('service_account.json'),
        Path('analysis/service_account.json'),
        Path('volleyball-stats-492014-ac04691fa39c.json'),
        Path('analysis/volleyball-stats-492014-ac04691fa39c.json'),
    ]
    
    for p in candidates:
        if p.exists():
            creds = Credentials.from_service_account_file(str(p), scopes=SCOPES)
            return gspread.authorize(creds)
    
    raise RuntimeError('service_account.jsonが見つかりません')


def generate_canonical_json(data):
    """canonical JSONを生成（精度ログ比較対象項目のみ）"""
    canonical = {
        'point_team': data.get('point_team', ''),
        'deciding_team': data.get('deciding_team', ''),
        'receive_grade': data.get('receive_grade', ''),
        'receiver': data.get('receiver', ''),
        'play_type': data.get('play_type', ''),
        'player': data.get('player', ''),
        'result_detail': data.get('result_detail', ''),
        'attack_type': data.get('attack_type', ''),
        'blocker_count': data.get('blocker_count', ''),
        'zone_from': data.get('zone_from', ''),
        'zone_to': data.get('zone_to', ''),
        'our_defense_type': data.get('our_defense_type', ''),
        'note': data.get('note', '')
    }
    return json.dumps(canonical, ensure_ascii=False)


def generate_field_confidences():
    """項目別確信度JSONを生成"""
    fields = ['point_team', 'deciding_team', 'receive_grade', 'receiver', 
              'play_type', 'player', 'result_detail', 'attack_type', 
              'blocker_count', 'zone_from', 'zone_to']
    return {f: random.uniform(0.7, 0.95) for f in fields}


def generate_mock_rally(rally_seq, set_number, is_two_line=False):
    """モックラリーデータを生成"""
    confidence = random.uniform(0.6, 0.95)
    
    if confidence >= 0.8:
        status = 'HIGH'
    elif confidence >= 0.5:
        status = 'MEDIUM'
    else:
        status = 'LOW'
    
    point_team = random.choice([TEAM_US, TEAM_THEM])
    deciding_team = random.choice([TEAM_US, TEAM_THEM])
    play_type = random.choice(PLAY_TYPES)
    player = random.choice(PLAYERS) if random.random() > 0.3 else ''
    receive_grade = random.choice(RECEIVE_GRADES) if random.random() > 0.3 else ''
    receiver = random.choice(PLAYERS) if random.random() > 0.5 else ''
    
    # 派生値（初期値は仮）
    score_us = rally_seq
    score_them = rally_seq - 1
    
    # 2行記録かどうか
    if is_two_line:
        is_two_line_val = 'TRUE'
        # 2行記録：相手攻撃時
        point_team = TEAM_THEM
        deciding_team = TEAM_THEM
        play_type = 'スパイク'
    else:
        is_two_line_val = 'FALSE'
    
    # canonical JSON用データ
    canonical_data = {
        'point_team': point_team,
        'deciding_team': deciding_team,
        'receive_grade': receive_grade,
        'receiver': receiver,
        'play_type': play_type,
        'player': player,
        'result_detail': '',
        'attack_type': random.choice(ATTACK_TYPES),
        'blocker_count': random.choice(BLOCKER_COUNTS),
        'zone_from': random.choice(ZONES),
        'zone_to': random.choice(ZONES),
        'our_defense_type': '',
        'note': ''
    }
    
    if is_two_line:
        canonical_data['our_defense_type'] = 'ディグ'
        canonical_data['play_type'] = 'スパイク'
    
    original_payload = generate_canonical_json(canonical_data)
    field_confidences = json.dumps(generate_field_confidences(), ensure_ascii=False)
    
    # rally_key生成
    rally_key = f'{MOCK_MATCH_ID}_set{set_number}_rally{rally_seq:03d}'
    
    # 行データ（43列）
    row = [''] * 43
    
    # A列: status
    row[0] = status
    
    # B列: rally_key
    row[1] = rally_key
    
    # C列: line_index
    row[2] = 1
    
    # D列: rally_seq
    row[3] = rally_seq
    
    # E列: is_two_line
    row[4] = is_two_line_val
    
    # F列: source_file
    row[5] = f'SET{set_number}.mp4'
    
    # G列: drive_file_id
    row[6] = ''
    
    # H列: confidence
    row[7] = confidence
    
    # I列: rally_start_sec
    row[8] = (rally_seq - 1) * 30
    
    # J列: rally_end_sec
    row[9] = rally_seq * 30
    
    # K列: date
    row[10] = MOCK_DATE
    
    # L列: opponent
    row[11] = MOCK_OPPONENT
    
    # M列: set
    row[12] = set_number
    
    # N列: score_us（派生値）
    row[13] = score_us
    
    # O列: score_them（派生値）
    row[14] = score_them
    
    # P列: point_team
    row[15] = point_team
    
    # Q列: serve_team（派生値）
    row[16] = TEAM_US
    
    # R列: rotation（派生値）
    row[17] = 1
    
    # S列: deciding_team
    row[18] = deciding_team
    
    # T列: receive_grade
    row[19] = receive_grade
    
    # U列: receiver
    row[20] = receiver
    
    # V列: team（派生値）
    row[21] = TEAM_US
    
    # W列: player
    row[22] = player
    
    # X列: play_type
    row[23] = play_type
    
    # Y列: result（派生値）
    row[24] = '得点' if point_team == TEAM_US else 'ミス'
    
    # Z列: result_detail
    row[25] = ''
    
    # AA列: attack_type
    row[26] = canonical_data['attack_type']
    
    # AB列: blocker_count
    row[27] = canonical_data['blocker_count']
    
    # AC列: zone_from
    row[28] = canonical_data['zone_from']
    
    # AD列: zone_to
    row[29] = canonical_data['zone_to']
    
    # AE列: note
    row[30] = ''
    
    # AF列: ai_note
    row[31] = 'モックデータ'
    
    # AG列: field_confidences
    row[32] = field_confidences
    
    # AH列: original_payload
    row[33] = original_payload
    
    # AI列: final_payload（承認時のみ）
    row[34] = ''
    
    # AJ列: human_modified
    row[35] = ''
    
    # AK列: match_id
    row[36] = MOCK_MATCH_ID
    
    # AL列: analysis_run_id
    row[37] = MOCK_ANALYSIS_RUN_ID
    
    # AM列: prompt_version
    row[38] = MOCK_PROMPT_VERSION
    
    # AN列: approved_at
    row[39] = ''
    
    # AO列: initial_serve_team
    row[40] = TEAM_US
    
    # AP列: initial_rotation
    row[41] = 1
    
    # AQ列: approved_by
    row[42] = ''
    
    return row, rally_key


def generate_mock_two_line_rally(rally_seq, set_number):
    """2行記録のモックデータを生成（line1とline2）"""
    # line1（自チーム守備）
    row1, rally_key = generate_mock_rally(rally_seq, set_number, is_two_line=True)
    row1[23] = 'ディグ'  # play_type
    row1[24] = 'ミス'   # result
    row1[21] = TEAM_US  # team
    row1[22] = ''       # player（自チーム守備なので空）
    
    # line2（相手攻撃）
    row2 = row1.copy()
    row2[2] = 2  # line_index
    row2[23] = 'スパイク'  # play_type
    row2[24] = '得点'     # result
    row2[21] = TEAM_THEM  # team
    row2[22] = random.choice(PLAYERS)  # player（相手攻撃者）
    row2[26] = random.choice(ATTACK_TYPES)  # attack_type
    row2[27] = random.choice(BLOCKER_COUNTS)  # blocker_count
    row2[28] = random.choice(ZONES)  # zone_from
    row2[29] = random.choice(ZONES)  # zone_to
    
    # line2はpayload関連を空に
    row2[33] = ''  # original_payload
    row2[34] = ''  # final_payload
    row2[35] = ''  # human_modified
    row2[39] = ''  # approved_at
    row2[42] = ''  # approved_by
    
    return row1, row2, rally_key


def main():
    print('AI提案モックデータ生成スクリプト')
    print('=' * 50)
    
    # gspreadクライアント取得
    print('Google Sheetsに接続中...')
    gc = get_gspread_client()
    
    # スプレッドシートを開く
    secrets = load_secrets()
    sheet_id = secrets.get('SHEET_ID', '')
    
    if sheet_id:
        print(f'SHEET_IDを使用: {sheet_id}')
        sh = gc.open_by_key(sheet_id)
    else:
        print(f'シート名で検索: {SHEET_NAME}')
        sh = gc.open(SHEET_NAME)
    
    # AI提案シートを取得または作成
    try:
        ai_sheet = sh.worksheet(AI_PROPOSALS_SHEET_NAME)
        print(f'既存のシートを使用: {AI_PROPOSALS_SHEET_NAME}')
        
        # シートを削除して再作成（確実にクリア）
        sh.del_worksheet(ai_sheet)
        ai_sheet = sh.add_worksheet(title=AI_PROPOSALS_SHEET_NAME, rows=100, cols=43)
        print('既存シートを再作成しました')
    except gspread.WorksheetNotFound:
        print(f'シートを作成: {AI_PROPOSALS_SHEET_NAME}')
        ai_sheet = sh.add_worksheet(title=AI_PROPOSALS_SHEET_NAME, rows=100, cols=43)
    
    # ヘッダー行を設定
    headers = [
        'status', 'rally_key', 'line_index', 'rally_seq', 'is_two_line',
        'source_file', 'drive_file_id', 'confidence', 'rally_start_sec', 'rally_end_sec',
        'date', 'opponent', 'set', 'score_us', 'score_them', 'point_team',
        'serve_team', 'rotation', 'deciding_team', 'receive_grade', 'receiver',
        'team', 'player', 'play_type', 'result', 'result_detail', 'attack_type',
        'blocker_count', 'zone_from', 'zone_to', 'note', 'ai_note', 'field_confidences',
        'original_payload', 'final_payload', 'human_modified', 'match_id',
        'analysis_run_id', 'prompt_version', 'approved_at', 'initial_serve_team',
        'initial_rotation', 'approved_by'
    ]
    ai_sheet.update('A1', [headers])
    
    # モックデータを生成
    print('モックデータを生成中...')
    
    rows = []
    rally_seq = 1
    
    # セット1のデータを生成（10ラリー）
    for i in range(10):
        if i in [3, 7]:  # 2行記録
            row1, row2, _ = generate_mock_two_line_rally(rally_seq, 1)
            rows.append(row1)
            rows.append(row2)
        else:  # 1行記録
            row, _ = generate_mock_rally(rally_seq, 1)
            rows.append(row)
        rally_seq += 1
    
    # データを書き込み
    if rows:
        print(f'{len(rows)}行を書き込み中...')
        ai_sheet.update('A2', rows)
        print(f'{len(rows)}行を書き込みました')
    
    print('=' * 50)
    print('完了！')
    print(f'シート: {AI_PROPOSALS_SHEET_NAME}')
    print(f'総行数: {len(rows) + 1}（ヘッダー含む）')


if __name__ == '__main__':
    main()

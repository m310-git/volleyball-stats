#!/usr/bin/env python3
"""AI提案シートのデータ確認用スクリプト"""

import json
from pathlib import Path
import gspread
from google.oauth2.service_account import Credentials

def load_secrets():
    candidates = [
        Path('.local_secrets.json'),
        Path('../.local_secrets.json'),
        Path('analysis/.local_secrets.json'),
    ]
    for p in candidates:
        if p.exists():
            with open(p, 'r', encoding='utf-8') as f:
                return json.load(f)
    return {}

def get_gspread_client():
    secrets = load_secrets()
    SCOPES = [
        'https://www.googleapis.com/auth/spreadsheets',
        'https://www.googleapis.com/auth/drive'
    ]
    service_account_file = secrets.get('GOOGLE_SERVICE_ACCOUNT_FILE')
    candidates = []
    if service_account_file:
        p = Path(service_account_file)
        if not p.exists():
            p = Path(p.name)
        if p.exists():
            creds = Credentials.from_service_account_file(str(p), scopes=SCOPES)
            return gspread.authorize(creds)
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

def main():
    gc = get_gspread_client()
    secrets = load_secrets()
    sheet_id = secrets.get('SHEET_ID', '')
    if sheet_id:
        sh = gc.open_by_key(sheet_id)
    else:
        sh = gc.open('バレースタッツ')
    
    ai_sheet = sh.worksheet('AI提案')
    data = ai_sheet.get_all_records()
    
    print(f'AI提案シート データ確認')
    print(f'=' * 80)
    print(f'総行数: {len(data)}\n')
    
    if len(data) == 0:
        print('データがありません')
        return
    
    # ヘッダー表示
    headers = list(data[0].keys())
    print('カラム一覧:')
    print(headers)
    print()
    
    # 各行の主要データを表示
    for i, row in enumerate(data[:20], 1):  # 最初の20行のみ
        print(f'行 {i}:')
        print(f'  status: {row.get("status", "")}')
        print(f'  rally_key: {row.get("rally_key", "")}')
        print(f'  line_index: {row.get("line_index", "")}')
        print(f'  rally_seq: {row.get("rally_seq", "")}')
        print(f'  point_team: {row.get("point_team", "")}')
        print(f'  deciding_team: {row.get("deciding_team", "")}')
        print(f'  date: {row.get("date", "")}')
        print(f'  opponent: {row.get("opponent", "")}')
        print(f'  set: {row.get("set", "")}')
        print()

if __name__ == '__main__':
    main()

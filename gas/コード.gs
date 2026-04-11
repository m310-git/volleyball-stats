// === 定数 ===
var SHEET_NAME_DATA = '生データ';
var SHEET_NAME_SETTINGS = '設定';
var SHEET_NAME_AI_PROPOSALS = 'AI提案';
var COLUMN_COUNT = 20;
var AI_COLUMN_COUNT = 43;
var ROTATION_COUNT = 6;
var MAX_MATCHES = 3;
var NOTION_API_VERSION = '2022-06-28';
var PLAY_TYPES = ['サーブ','スパイク','フェイント','プッシュ','ブロック'];

function doGet() {
  return HtmlService.createHtmlOutputFromFile('InputForm')
    .setTitle('🏐 バレー スタッツ')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// === ヘルパー関数 ===
function getDataSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  return ss.getSheetByName(SHEET_NAME_DATA);
}

function getSettingsSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  return ss.getSheetByName(SHEET_NAME_SETTINGS);
}

function getAIProposalsSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  return ss.getSheetByName(SHEET_NAME_AI_PROPOSALS);
}

function getColumnMapping(sheet) {
  var headers = sheet.getRange(1, 1, 1, COLUMN_COUNT).getValues()[0];
  var col = {};
  headers.forEach(function(h, i) { col[h.toString().trim()] = i; });
  return col;
}

function getAIColumnMapping(sheet) {
  var headers = sheet.getRange(1, 1, 1, AI_COLUMN_COUNT).getValues()[0];
  var col = {};
  headers.forEach(function(h, i) { col[h.toString().trim()] = i; });
  return col;
}

function addRecord(data) {
  var sheet = getDataSheet();

  // ヘッダーと完全一致する順番
  // A:date B:opponent C:set D:score_us E:score_them
  // F:point_team G:serve_team H:rotation
  // I:receive_grade J:receiver K:team
  // L:player M:play_type N:result O:result_detail
  // P:attack_type Q:blocker_count
  // R:zone_from S:zone_to T:note

  var row = [
    data.date || '',           // A: date
    data.opponent || '',       // B: opponent
    data.set || 1,             // C: set
    data.scoreUs || 0,         // D: score_us
    data.scoreThem || 0,       // E: score_them
    data.pointTeam || '',      // F: point_team
    data.serveTeam || '',      // G: serve_team
    data.rotation || 1,        // H: rotation
    data.receiveGrade || '',   // I: receive_grade
    data.receiver || '',       // J: receiver
    data.team || '',           // K: team
    data.player || '',         // L: player
    data.playType || '',       // M: play_type
    data.result || '',         // N: result
    data.resultDetail || '',   // O: result_detail
    data.attackType || '',     // P: attack_type
    data.blockerCount || '',   // Q: blocker_count
    data.zoneFrom || '',       // R: zone_from
    data.zoneTo || '',         // S: zone_to
    data.note || '',           // T: note
  ];

  sheet.appendRow(row);
  return { success: true };
}

function undoLast() {
  var sheet = getDataSheet();
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return { success: false };

  var col = getColumnMapping(sheet);
  var row = sheet.getRange(lastRow, 1, 1, COLUMN_COUNT).getValues()[0];
  sheet.deleteRow(lastRow);

  return {
    success: true,
    deleted: {
      set: parseInt(row[col['set']]) || 1,
      scoreUs: parseInt(row[col['score_us']]) || 0,
      scoreThem: parseInt(row[col['score_them']]) || 0,
      pointTeam: (row[col['point_team']] || '').toString(),
      serveTeam: (row[col['serve_team']] || '').toString(),
      rotation: parseInt(row[col['rotation']]) || 1,
    }
  };
}

function getLastState() {
  var sheet = getDataSheet();
  var lastRow = sheet.getLastRow();

  if (lastRow <= 1) {
    return {
      found: false,
      set: 1, scoreUs: 0, scoreThem: 0,
      date: '', opponent: '',
      serveTeam: '', rotation: 1, pointTeam: ''
    };
  }

  var col = getColumnMapping(sheet);
  var row = sheet.getRange(lastRow, 1, 1, COLUMN_COUNT).getValues()[0];

  var g = function(name) {
    var idx = col[name];
    if (idx === undefined) return '';
    var v = row[idx];
    return (v === null || v === undefined) ? '' : v;
  };

  // score_us, score_them が空の場合、同じ日付+相手+セットの
  // 最後の有効な値を探す
  var scoreUs = parseInt(g('score_us'));
  var scoreThem = parseInt(g('score_them'));
  var date = g('date').toString();
  var opponent = g('opponent').toString();
  var set = parseInt(g('set')) || 1;

  if (isNaN(scoreUs) || isNaN(scoreThem)) {
    // 最後の有効なスコアを探す
    var allData = sheet.getRange(2, 1, lastRow - 1, COLUMN_COUNT).getValues();
    for (var i = allData.length - 1; i >= 0; i--) {
      var r = allData[i];
      var su = parseInt(r[col['score_us']]);
      var st = parseInt(r[col['score_them']]);
      if (!isNaN(su) && !isNaN(st)) {
        scoreUs = su;
        scoreThem = st;
        break;
      }
    }
  }

  if (isNaN(scoreUs)) scoreUs = 0;
  if (isNaN(scoreThem)) scoreThem = 0;

  return {
    found: true,
    date: date,
    opponent: opponent,
    set: set,
    scoreUs: scoreUs,
    scoreThem: scoreThem,
    serveTeam: g('serve_team').toString(),
    rotation: parseInt(g('rotation')) || 1,
    pointTeam: g('point_team').toString(),
  };
}

function getOpponentHistory() {
  var sheet = getDataSheet();
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return [];

  var col = getColumnMapping(sheet);
  var oppCol = col['opponent'];
  if (oppCol === undefined) return [];

  var data = sheet.getRange(2, oppCol + 1, lastRow-1, 1).getValues();
  var u = {};
  data.forEach(function(r){ if(r[0]&&r[0].toString().trim()) u[r[0].toString().trim()]=true; });
  return Object.keys(u).sort();
}

function getSettings() {
  var sheet = getSettingsSheet();
  if (!sheet) return { players:[], attackTypes:[], resultDetails:[] };
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return { players:[], attackTypes:[], resultDetails:[] };
  var data = sheet.getRange(2, 1, lastRow-1, 3).getValues();
  var players=[], attackTypes=[], resultDetails=[];
  data.forEach(function(row) {
    if (row[0]&&row[0].toString().trim()) players.push(row[0].toString().trim());
    if (row[1]&&row[1].toString().trim()) attackTypes.push(row[1].toString().trim());
    if (row[2]&&row[2].toString().trim()) resultDetails.push(row[2].toString().trim());
  });
  return { players:players, attackTypes:attackTypes, resultDetails:resultDetails };
}

function manualUpdateNotion() {
  try {
    updateNotion();
    return { success: true, message: 'Notion更新完了' };
  } catch (e) {
    return { success: false, message: e.message };
  }
}

// === AI提案系関数（フェーズ1: 読み取り系） ===

/**
 * AI提案データを取得（指定セット）
 * @param {number} setNumber - セット番号
 * @return {Object} { success: boolean, rallies: array, error: string }
 */
function getAIProposals(setNumber) {
  var sheet = getAIProposalsSheet();
  if (!sheet) {
    return { success: false, error: 'AI提案シートがありません。先にColabを実行してください。', rallies: [] };
  }
  
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) {
    return { success: true, rallies: [] };
  }
  
  var col = getAIColumnMapping(sheet);
  var data = sheet.getRange(2, 1, lastRow - 1, AI_COLUMN_COUNT).getValues();
  
  // 指定セットでフィルタ
  var filtered = data.filter(function(row) {
    var setVal = row[col['set']];
    return setVal === setNumber || parseInt(setVal) === setNumber;
  });
  
  // オブジェクト配列に変換
  var rallies = filtered.map(function(row) {
    return {
      status: row[col['status']] ? row[col['status']].toString() : '',
      rally_key: row[col['rally_key']] ? row[col['rally_key']].toString() : '',
      line_index: parseInt(row[col['line_index']]) || 1,
      rally_seq: parseInt(row[col['rally_seq']]) || 0,
      is_two_line: row[col['is_two_line']] ? row[col['is_two_line']].toString() : 'FALSE',
      source_file: row[col['source_file']] ? row[col['source_file']].toString() : '',
      drive_file_id: row[col['drive_file_id']] ? row[col['drive_file_id']].toString() : '',
      confidence: parseFloat(row[col['confidence']]) || 0,
      rally_start_sec: parseFloat(row[col['rally_start_sec']]) || 0,
      rally_end_sec: parseFloat(row[col['rally_end_sec']]) || 0,
      date: row[col['date']] ? row[col['date']].toString() : '',
      opponent: row[col['opponent']] ? row[col['opponent']].toString() : '',
      set: parseInt(row[col['set']]) || 1,
      score_us: parseInt(row[col['score_us']]) || 0,
      score_them: parseInt(row[col['score_them']]) || 0,
      point_team: row[col['point_team']] ? row[col['point_team']].toString() : '',
      serve_team: row[col['serve_team']] ? row[col['serve_team']].toString() : '',
      rotation: parseInt(row[col['rotation']]) || 1,
      deciding_team: row[col['deciding_team']] ? row[col['deciding_team']].toString() : '',
      receive_grade: row[col['receive_grade']] ? row[col['receive_grade']].toString() : '',
      receiver: row[col['receiver']] ? row[col['receiver']].toString() : '',
      team: row[col['team']] ? row[col['team']].toString() : '',
      player: row[col['player']] ? row[col['player']].toString() : '',
      play_type: row[col['play_type']] ? row[col['play_type']].toString() : '',
      result: row[col['result']] ? row[col['result']].toString() : '',
      result_detail: row[col['result_detail']] ? row[col['result_detail']].toString() : '',
      attack_type: row[col['attack_type']] ? row[col['attack_type']].toString() : '',
      blocker_count: row[col['blocker_count']] ? row[col['blocker_count']].toString() : '',
      zone_from: row[col['zone_from']] ? row[col['zone_from']].toString() : '',
      zone_to: row[col['zone_to']] ? row[col['zone_to']].toString() : '',
      note: row[col['note']] ? row[col['note']].toString() : '',
      ai_note: row[col['ai_note']] ? row[col['ai_note']].toString() : '',
      field_confidences: row[col['field_confidences']] ? row[col['field_confidences']].toString() : '',
      original_payload: row[col['original_payload']] ? row[col['original_payload']].toString() : '',
      final_payload: row[col['final_payload']] ? row[col['final_payload']].toString() : '',
      human_modified: row[col['human_modified']] ? row[col['human_modified']].toString() : '',
      match_id: row[col['match_id']] ? row[col['match_id']].toString() : '',
      analysis_run_id: row[col['analysis_run_id']] ? row[col['analysis_run_id']].toString() : '',
      prompt_version: row[col['prompt_version']] ? row[col['prompt_version']].toString() : '',
      approved_at: row[col['approved_at']] ? row[col['approved_at']].toString() : '',
      initial_serve_team: row[col['initial_serve_team']] ? row[col['initial_serve_team']].toString() : '',
      initial_rotation: parseInt(row[col['initial_rotation']]) || 1,
      approved_by: row[col['approved_by']] ? row[col['approved_by']].toString() : ''
    };
  });
  
  return { success: true, rallies: rallies };
}

/**
 * AI提案サマリーを取得（全セット）
 * @return {Object} { success: boolean, summary: array, error: string }
 */
function getAIProposalSummary() {
  var sheet = getAIProposalsSheet();
  if (!sheet) {
    return { success: false, error: 'AI提案シートがありません。先にColabを実行してください。', summary: [] };
  }
  
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) {
    return { success: true, summary: [] };
  }
  
  var col = getAIColumnMapping(sheet);
  var data = sheet.getRange(2, 1, lastRow - 1, AI_COLUMN_COUNT).getValues();
  
  // セットごとの集計
  var summaryBySet = {};
  data.forEach(function(row) {
    var setVal = parseInt(row[col['set']]) || 1;
    var status = row[col['status']] ? row[col['status']].toString() : '';
    
    if (!summaryBySet[setVal]) {
      summaryBySet[setVal] = {
        set: setVal,
        total: 0,
        high: 0,
        medium: 0,
        low: 0,
        error: 0,
        approved: 0,
        committed: 0
      };
    }
    
    summaryBySet[setVal].total++;
    if (status === 'HIGH') summaryBySet[setVal].high++;
    else if (status === 'MEDIUM') summaryBySet[setVal].medium++;
    else if (status === 'LOW') summaryBySet[setVal].low++;
    else if (status === 'ERROR') summaryBySet[setVal].error++;
    else if (status === 'APPROVED') summaryBySet[setVal].approved++;
    else if (status === 'COMMITTED') summaryBySet[setVal].committed++;
  });
  
  // 配列に変換
  var summary = Object.keys(summaryBySet).map(function(key) {
    return summaryBySet[key];
  }).sort(function(a, b) { return a.set - b.set; });
  
  return { success: true, summary: summary };
}

/**
 * canonical JSON生成（設計書§4.5）
 * 精度ログ比較対象項目のみ含むラリー単位JSON
 * @param {Array} row1 - line_index=1の行データ
 * @param {Object} col - カラムマッピング
 * @param {boolean} isTwoLine - 2行記録か
 * @param {Array} row2 - line_index=2の行データ（2行記録の場合）
 * @return {string} canonical JSON文字列
 */
function _buildCanonicalJSON(row1, col, isTwoLine, row2) {
  var g = function(row, field) {
    if (!row || col[field] === undefined) return '';
    var v = row[col[field]];
    if (v === null || v === undefined || v === 'null' || v === 'None') return '';
    return v.toString().trim();
  };
  
  var canonical = {};
  
  // 設計書§4.5 canonical JSON再構成ルール
  canonical.point_team = g(row1, 'point_team');
  canonical.deciding_team = g(row1, 'deciding_team');
  canonical.receive_grade = g(row1, 'receive_grade');
  canonical.receiver = g(row1, 'receiver');
  canonical.result_detail = g(row1, 'result_detail');
  canonical.note = g(row1, 'note');
  
  if (isTwoLine && row2) {
    // 2行記録: play_type/player/attack_type等はline2から取得
    canonical.play_type = g(row2, 'play_type');
    canonical.player = g(row2, 'player');
    canonical.attack_type = g(row2, 'attack_type');
    canonical.blocker_count = g(row2, 'blocker_count');
    canonical.zone_from = g(row2, 'zone_from');
    canonical.zone_to = g(row2, 'zone_to');
    // our_defense_typeはline1のplay_typeから逆算
    var line1PlayType = g(row1, 'play_type');
    canonical.our_defense_type = (line1PlayType === 'ディグ' || line1PlayType === 'ブロック') ? line1PlayType : '';
  } else {
    // 1行記録: すべてline1から
    canonical.play_type = g(row1, 'play_type');
    canonical.player = g(row1, 'player');
    canonical.attack_type = g(row1, 'attack_type');
    canonical.blocker_count = g(row1, 'blocker_count');
    canonical.zone_from = g(row1, 'zone_from');
    canonical.zone_to = g(row1, 'zone_to');
    canonical.our_defense_type = '';
  }
  
  return JSON.stringify(canonical);
}

// === AI提案系関数（フェーズ2: 承認系） ===

/**
 * AI提案を承認
 * @param {string} rallyKey - ラリーキー
 * @param {Object} modifiedData - 修正データ（オプション）
 * @return {Object} { success: boolean, error: string }
 */
function approveProposal(rallyKey, modifiedData) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000); // 10秒待機
  } catch (e) {
    return { success: false, error: 'ロック取得失敗: ' + e.message };
  }
  
  try {
    var sheet = getAIProposalsSheet();
    if (!sheet) {
      return { success: false, error: 'AI提案シートがありません' };
    }
    
    var lastRow = sheet.getLastRow();
    if (lastRow <= 1) {
      return { success: false, error: 'データがありません' };
    }
    
    var col = getAIColumnMapping(sheet);
    var data = sheet.getRange(2, 1, lastRow - 1, AI_COLUMN_COUNT).getValues();
    
    // rally_keyで検索（2行ペアも含める）
    var rowIndices = [];
    for (var i = 0; i < data.length; i++) {
      if (data[i][col['rally_key']] && data[i][col['rally_key']].toString() === rallyKey) {
        rowIndices.push(i + 2); // 1-indexed
      }
    }
    
    if (rowIndices.length === 0) {
      return { success: false, error: 'rally_keyが見つかりません: ' + rallyKey };
    }
    
    var line1Index = -1;
    var line2Index = -1;
    for (var j = 0; j < rowIndices.length; j++) {
      var row = data[rowIndices[j] - 2];
      var lineIndex = parseInt(row[col['line_index']]) || 1;
      var status = row[col['status']] ? row[col['status']].toString() : '';
      
      if (status === 'COMMITTED') {
        return { success: false, error: 'COMMITTEDは変更できません' };
      }
      
      if (lineIndex === 1) {
        line1Index = rowIndices[j];
      } else if (lineIndex === 2) {
        line2Index = rowIndices[j];
      }
    }
    
    if (line1Index === -1) {
      return { success: false, error: 'line_index=1が見つかりません' };
    }
    
    var row1 = data[line1Index - 2];
    var row2 = line2Index !== -1 ? data[line2Index - 2] : null;
    var isTwoLine = row1[col['is_two_line']] ? row1[col['is_two_line']].toString() : 'FALSE';
    
    // 修正データのマージと構造変更バリデーション
    var updatedRow1 = row1.slice();
    var updatedRow2 = row2 ? row2.slice() : null;
    var modifiedFields = [];
    
    if (modifiedData) {
      // 更新可能なフィールド（派生値を除く）
      var updateFields = ['point_team', 'deciding_team', 'receive_grade', 'receiver', 'player', 
                          'play_type', 'result_detail', 'attack_type', 'blocker_count',
                          'zone_from', 'zone_to', 'note'];
      
      updateFields.forEach(function(field) {
        if (modifiedData[field] !== undefined && modifiedData[field] !== null) {
          var oldValue = row1[col[field]] ? row1[col[field]].toString() : '';
          var newValue = modifiedData[field] ? modifiedData[field].toString() : '';
          
          // 正規化ルール適用（null系統一、trim）
          if (!oldValue || oldValue === 'null' || oldValue === 'None' || oldValue.trim() === '') oldValue = '';
          else oldValue = oldValue.trim();
          if (!newValue || newValue === 'null' || newValue === 'None' || newValue.trim() === '') newValue = '';
          else newValue = newValue.trim();
          
          if (oldValue !== newValue) {
            modifiedFields.push(field);
            updatedRow1[col[field]] = modifiedData[field];
          }
        }
      });
      
      // 構造変更バリデーション（設計書§8.2ステップ4）
      var newPointTeam = updatedRow1[col['point_team']] ? updatedRow1[col['point_team']].toString() : '';
      var newDecidingTeam = updatedRow1[col['deciding_team']] ? updatedRow1[col['deciding_team']].toString() : '';
      var newPlayType = updatedRow1[col['play_type']] ? updatedRow1[col['play_type']].toString() : '';
      
      // 2行記録条件: point_team=相手名, deciding_team=相手名, play_type=スパイク/フェイント/プッシュ
      var opponent = row1[col['opponent']] ? row1[col['opponent']].toString() : '';
      var shouldBeTwoLine = (newPointTeam === opponent && newDecidingTeam === opponent && 
                             ['スパイク', 'フェイント', 'プッシュ'].indexOf(newPlayType) >= 0);
      
      if (shouldBeTwoLine !== (isTwoLine === 'TRUE')) {
        return { success: false, error: '構造変更は未対応です。削除して再追加してください。' };
      }
      
      // point_team変更時は派生値再計算
      var pointTeamChanged = modifiedFields.indexOf('point_team') >= 0;
      var decidingTeamChanged = modifiedFields.indexOf('deciding_team') >= 0;
      
      if (pointTeamChanged) {
        var setNumber = parseInt(updatedRow1[col['set']]) || 1;
        _recalcDerivedValuesInternal(setNumber);
        // 再計算後のデータを再取得
        data = sheet.getRange(2, 1, lastRow - 1, AI_COLUMN_COUNT).getValues();
        updatedRow1 = data[line1Index - 2].slice();
        if (line2Index !== -1) {
          updatedRow2 = data[line2Index - 2].slice();
        }
      } else if (decidingTeamChanged && modifiedFields.length === 1) {
        // deciding_teamのみ変更時は該当ラリーのteam/resultのみ再決定（設計書§8.2ステップ5）
        var newPointTeam = updatedRow1[col['point_team']] ? updatedRow1[col['point_team']].toString() : '';
        var newDecidingTeam = updatedRow1[col['deciding_team']] ? updatedRow1[col['deciding_team']].toString() : '';
        var opponent = row1[col['opponent']] ? row1[col['opponent']].toString() : '';
        
        // team/result決定（設計書§6.1.3, §7.3）
        if (isTwoLine === 'TRUE') {
          // 2行記録
          updatedRow1[col['team']] = '自チーム';
          updatedRow1[col['result']] = 'ミス';
          if (updatedRow2) {
            updatedRow2[col['team']] = opponent;
            updatedRow2[col['result']] = '得点';
          }
        } else {
          // 1行記録
          if (newDecidingTeam === '自チーム') {
            if (newPointTeam === '自チーム') {
              updatedRow1[col['team']] = '自チーム';
              updatedRow1[col['result']] = '得点';
            } else {
              updatedRow1[col['team']] = '自チーム';
              updatedRow1[col['result']] = 'ミス';
            }
          } else {
            if (newPointTeam === opponent) {
              updatedRow1[col['team']] = opponent;
              updatedRow1[col['result']] = '得点';
            } else {
              updatedRow1[col['team']] = opponent;
              updatedRow1[col['result']] = 'ミス';
            }
          }
        }
      }
    }
    
    // ステータスAPPROVEDに（2行ペアとも）
    updatedRow1[col['status']] = 'APPROVED';
    if (updatedRow2) {
      updatedRow2[col['status']] = 'APPROVED';
    }
    
    // approved_at, approved_byを設定（line1のみ）
    updatedRow1[col['approved_at']] = new Date().toISOString();
    try {
      updatedRow1[col['approved_by']] = Session.getActiveUser().getEmail();
    } catch (e) {
      updatedRow1[col['approved_by']] = '';
    }
    
    // canonical JSONをfinal_payloadに保存（line1のみ）
    var canonical = _buildCanonicalJSON(updatedRow1, col, isTwoLine === 'TRUE', updatedRow2);
    updatedRow1[col['final_payload']] = canonical;
    
    // human_modifiedに修正項目名を記録（line1のみ。派生値含めない）
    if (modifiedFields.length > 0) {
      updatedRow1[col['human_modified']] = modifiedFields.join(',');
    } else {
      updatedRow1[col['human_modified']] = '';
    }
    
    // line_index=2の場合、payload関連フィールドは空のまま
    if (updatedRow2) {
      updatedRow2[col['original_payload']] = '';
      updatedRow2[col['final_payload']] = '';
      updatedRow2[col['human_modified']] = '';
      updatedRow2[col['approved_at']] = '';
      updatedRow2[col['approved_by']] = '';
    }
    
    // 更新（バッチ）
    sheet.getRange(line1Index, 1, 1, AI_COLUMN_COUNT).setValues([updatedRow1]);
    if (line2Index !== -1 && updatedRow2) {
      sheet.getRange(line2Index, 1, 1, AI_COLUMN_COUNT).setValues([updatedRow2]);
    }
    
    return { success: true, modifiedFields: modifiedFields };
    
  } catch (e) {
    return { success: false, error: e.message };
  } finally {
    lock.releaseLock();
  }
}

/**
 * 高確信度の提案を一括承認
 * @param {number} setNumber - セット番号
 * @return {Object} { success: boolean, approved: number, error: string }
 */
function bulkApproveHighConfidence(setNumber) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
  } catch (e) {
    return { success: false, approved: 0, error: 'ロック取得失敗: ' + e.message };
  }
  
  try {
    var sheet = getAIProposalsSheet();
    if (!sheet) {
      return { success: false, approved: 0, error: 'AI提案シートがありません' };
    }
    
    var lastRow = sheet.getLastRow();
    if (lastRow <= 1) {
      return { success: true, approved: 0 };
    }
    
    var col = getAIColumnMapping(sheet);
    var data = sheet.getRange(2, 1, lastRow - 1, AI_COLUMN_COUNT).getValues();
    
    var approvedCount = 0;
    var rowsToUpdate = [];
    
    // 指定セットのHIGHをAPPROVEDに（line_index=1のみ）
    var highRallyKeys = [];
    for (var i = 0; i < data.length; i++) {
      var setVal = parseInt(data[i][col['set']]) || 1;
      var status = data[i][col['status']] ? data[i][col['status']].toString() : '';
      var lineIndex = parseInt(data[i][col['line_index']]) || 1;
      
      if (setVal === setNumber && status === 'HIGH' && lineIndex === 1) {
        highRallyKeys.push({ key: data[i][col['rally_key']].toString(), index: i });
      }
    }
    
    // 2行ペアをまとめて処理
    for (var j = 0; j < highRallyKeys.length; j++) {
      var rallyKey = highRallyKeys[j].key;
      var line1Index = highRallyKeys[j].index;
      var line2Index = -1;
      
      // 2行目を検索
      for (var k = 0; k < data.length; k++) {
        if (data[k][col['rally_key']] && data[k][col['rally_key']].toString() === rallyKey &&
            parseInt(data[k][col['line_index']]) === 2) {
          line2Index = k;
          break;
        }
      }
      
      var row1 = data[line1Index].slice();
      var row2 = line2Index !== -1 ? data[line2Index].slice() : null;
      var isTwoLine = row1[col['is_two_line']] ? row1[col['is_two_line']].toString() : 'FALSE';
      
      // ステータスAPPROVED
      row1[col['status']] = 'APPROVED';
      row1[col['approved_at']] = new Date().toISOString();
      try {
        row1[col['approved_by']] = Session.getActiveUser().getEmail();
      } catch (e) {
        row1[col['approved_by']] = '';
      }
      
      // canonical JSONをfinal_payloadに保存（line1のみ）
      var canonical = _buildCanonicalJSON(row1, col, isTwoLine === 'TRUE', row2);
      row1[col['final_payload']] = canonical;
      row1[col['human_modified']] = ''; // 一括承認は空文字列
      
      rowsToUpdate.push({ row: line1Index + 2, data: row1 });
      
      // 2行目も更新
      if (row2) {
        row2[col['status']] = 'APPROVED';
        rowsToUpdate.push({ row: line2Index + 2, data: row2 });
      }
      
      approvedCount++;
    }
    
    // バッチ更新
    if (rowsToUpdate.length > 0) {
      rowsToUpdate.forEach(function(item) {
        sheet.getRange(item.row, 1, 1, AI_COLUMN_COUNT).setValues([item.data]);
      });
    }
    
    return { success: true, approved: approvedCount };
    
  } catch (e) {
    return { success: false, approved: 0, error: e.message };
  } finally {
    lock.releaseLock();
  }
}

// === AI提案系関数（フェーズ3: 再計算・編集系） ===

/**
 * 派生値再計算（内部ヘルパー、Lockなし）
 * @param {number} setNumber - セット番号
 * @return {Object} { success: boolean, error: string }
 */
function _recalcDerivedValuesInternal(setNumber) {
  var sheet = getAIProposalsSheet();
  if (!sheet) {
    return { success: false, error: 'AI提案シートがありません' };
  }
  
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) {
    return { success: true };
  }
  
  var col = getAIColumnMapping(sheet);
  var data = sheet.getRange(2, 1, lastRow - 1, AI_COLUMN_COUNT).getValues();
  
  // 指定セットでフィルタ（line_index=1のみ）
  var filtered = data.filter(function(row) {
    var setVal = parseInt(row[col['set']]) || 1;
    var lineIndex = parseInt(row[col['line_index']]) || 1;
    return setVal === setNumber && lineIndex === 1;
  });
  
  if (filtered.length === 0) {
    return { success: true };
  }
  
  // rally_seqでソート
  filtered.sort(function(a, b) {
    var seqA = parseInt(a[col['rally_seq']]) || 0;
    var seqB = parseInt(b[col['rally_seq']]) || 0;
    return seqA - seqB;
  });
  
  // 初期値取得（最初の行から）
  var firstRow = filtered[0];
  var scoreUs = 0;
  var scoreThem = 0;
  var serveTeam = firstRow[col['initial_serve_team']] ? firstRow[col['initial_serve_team']].toString() : '';
  var rotation = parseInt(firstRow[col['initial_rotation']]) || 1;
  var opponent = firstRow[col['opponent']] ? firstRow[col['opponent']].toString() : '';
  
  // 派生値計算
  var rowsToUpdate = [];
  filtered.forEach(function(row) {
    var pointTeam = row[col['point_team']] ? row[col['point_team']].toString() : '';
    
    // スコア更新
    if (pointTeam === '自チーム') {
      scoreUs++;
    } else if (pointTeam === opponent) {
      scoreThem++;
    }
    
    // serve_teamが空欄でない場合のみ更新
    if (serveTeam) {
      // 自チーム得点 かつ serve_team!=自チーム → serve_team=自チーム, rotation++
      if (pointTeam === '自チーム' && serveTeam !== '自チーム') {
        serveTeam = '自チーム';
        rotation = (rotation % 6) + 1;
      }
      // 相手得点 かつ serve_team==自チーム → serve_team=相手チーム名
      else if (pointTeam === opponent && serveTeam === '自チーム') {
        serveTeam = opponent;
      }
    }
    
    // team/result決定（設計書§6.1.3）
    var decidingTeam = row[col['deciding_team']] ? row[col['deciding_team']].toString() : '';
    var team = '';
    var result = '';
    var isTwoLine = row[col['is_two_line']] ? row[col['is_two_line']].toString() : 'FALSE';
    
    if (isTwoLine === 'TRUE') {
      // 2行記録: line1は自チーム/ミス、line2は相手名/得点（設計書§6.1.3）
      team = '自チーム';
      result = 'ミス';
    } else {
      // 1行記録
      if (decidingTeam === '自チーム') {
        if (pointTeam === '自チーム') {
          team = '自チーム';
          result = '得点';
        } else {
          team = '自チーム';
          result = 'ミス';
        }
      } else {
        if (pointTeam === opponent) {
          team = opponent;
          result = '得点';
        } else {
          team = opponent;
          result = 'ミス';
        }
      }
    }
    
    // 更新行作成
    var updatedRow = row.slice();
    updatedRow[col['score_us']] = scoreUs;
    updatedRow[col['score_them']] = scoreThem;
    updatedRow[col['serve_team']] = serveTeam;
    updatedRow[col['rotation']] = rotation;
    updatedRow[col['team']] = team;
    updatedRow[col['result']] = result;
    
    rowsToUpdate.push(updatedRow);
    
    // 2行記録の場合、同じ派生値を設定
    var isTwoLine = row[col['is_two_line']] ? row[col['is_two_line']].toString() : 'FALSE';
    if (isTwoLine === 'TRUE') {
      var rallyKey = row[col['rally_key']] ? row[col['rally_key']].toString() : '';
      // 2行目を検索
      for (var i = 0; i < data.length; i++) {
        if (data[i][col['rally_key']] && data[i][col['rally_key']].toString() === rallyKey &&
            parseInt(data[i][col['line_index']]) === 2) {
          var updatedRow2 = data[i].slice();
          updatedRow2[col['score_us']] = scoreUs;
          updatedRow2[col['score_them']] = scoreThem;
          updatedRow2[col['serve_team']] = serveTeam;
          updatedRow2[col['rotation']] = rotation;
          // 2行目はteam=相手名, result=得点に固定（設計書§6.1.3）
          updatedRow2[col['team']] = opponent;
          updatedRow2[col['result']] = '得点';
          rowsToUpdate.push(updatedRow2);
          break;
        }
      }
    }
  });
  
  // バッチ更新
  if (rowsToUpdate.length > 0) {
    var rowIndex = 2;
    data.forEach(function(originalRow) {
      for (var i = 0; i < rowsToUpdate.length; i++) {
        var originalKey = originalRow[col['rally_key']] ? originalRow[col['rally_key']].toString() : '';
        var updatedKey = rowsToUpdate[i][col['rally_key']] ? rowsToUpdate[i][col['rally_key']].toString() : '';
        var originalLine = parseInt(originalRow[col['line_index']]) || 1;
        var updatedLine = parseInt(rowsToUpdate[i][col['line_index']]) || 1;
        
        if (originalKey === updatedKey && originalLine === updatedLine) {
          sheet.getRange(rowIndex, 1, 1, AI_COLUMN_COUNT).setValues([rowsToUpdate[i]]);
          rowsToUpdate.splice(i, 1);
          break;
        }
      }
      rowIndex++;
    });
  }
  
  return { success: true };
}

/**
 * ラリー削除
 * @param {string} rallyKey - ラリーキー
 * @return {Object} { success: boolean, error: string }
 */
function deleteRally(rallyKey) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
  } catch (e) {
    return { success: false, error: 'ロック取得失敗: ' + e.message };
  }
  
  try {
    var sheet = getAIProposalsSheet();
    if (!sheet) {
      return { success: false, error: 'AI提案シートがありません' };
    }
    
    var lastRow = sheet.getLastRow();
    if (lastRow <= 1) {
      return { success: false, error: 'データがありません' };
    }
    
    var col = getAIColumnMapping(sheet);
    var data = sheet.getRange(2, 1, lastRow - 1, AI_COLUMN_COUNT).getValues();
    
    // rally_keyで検索
    var rowIndices = [];
    for (var i = 0; i < data.length; i++) {
      if (data[i][col['rally_key']] && data[i][col['rally_key']].toString() === rallyKey) {
        rowIndices.push(i + 2); // 1-indexed
      }
    }
    
    if (rowIndices.length === 0) {
      return { success: false, error: 'rally_keyが見つかりません: ' + rallyKey };
    }
    
    // COMMITTEDは削除不可
    for (var j = 0; j < rowIndices.length; j++) {
      var row = data[rowIndices[j] - 2];
      var status = row[col['status']] ? row[col['status']].toString() : '';
      if (status === 'COMMITTED') {
        return { success: false, error: 'COMMITTEDは削除できません' };
      }
    }
    
    // 削除（後ろから行を削除してインデックスズレを防ぐ）
    rowIndices.sort(function(a, b) { return b - a; });
    rowIndices.forEach(function(rowIndex) {
      sheet.deleteRow(rowIndex);
    });
    
    // セット番号を取得
    var deletedRow = data[rowIndices[rowIndices.length - 1] - 2];
    var setNumber = parseInt(deletedRow[col['set']]) || 1;
    
    // rally_seq振り直し（派生値再計算より先に実行）
    var newLastRow = sheet.getLastRow();
    if (newLastRow > 1) {
      var newData = sheet.getRange(2, 1, newLastRow - 1, AI_COLUMN_COUNT).getValues();
      var seq = 1;
      for (var k = 0; k < newData.length; k++) {
        if (parseInt(newData[k][col['set']]) === setNumber && parseInt(newData[k][col['line_index']]) === 1) {
          sheet.getRange(k + 2, col['rally_seq'] + 1).setValue(seq);
          seq++;
        }
      }
    }
    
    // 派生値再計算（rally_seq振り直し後に実行しスコアを正しく計算）
    _recalcDerivedValuesInternal(setNumber);
    
    return { success: true };
    
  } catch (e) {
    return { success: false, error: e.message };
  } finally {
    lock.releaseLock();
  }
}

/**
 * ラリー挿入
 * @param {string} afterRallyKey - 挿入位置の後のラリーキー（nullなら先頭）
 * @param {Object} rallyData - ラリーデータ
 * @return {Object} { success: boolean, error: string }
 */
function insertRally(afterRallyKey, rallyData) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
  } catch (e) {
    return { success: false, error: 'ロック取得失敗: ' + e.message };
  }
  
  try {
    var sheet = getAIProposalsSheet();
    if (!sheet) {
      return { success: false, error: 'AI提案シートがありません' };
    }
    
    var lastRow = sheet.getLastRow();
    var col = getAIColumnMapping(sheet);
    
    var insertRowIndex = 2; // デフォルトは先頭
    var setNumber = rallyData.set || 1;
    
    if (afterRallyKey && lastRow > 1) {
      var data = sheet.getRange(2, 1, lastRow - 1, AI_COLUMN_COUNT).getValues();
      for (var i = 0; i < data.length; i++) {
        if (data[i][col['rally_key']] && data[i][col['rally_key']].toString() === afterRallyKey) {
          insertRowIndex = i + 3; // 挿入位置の後
          setNumber = parseInt(data[i][col['set']]) || 1;
          break;
        }
      }
    }
    
    // 同セット既存行からinitial_serve_team/initial_rotationを継承（設計書§8.2）
    var initialServeTeam = '';
    var initialRotation = 1;
    var matchId = '';
    var inheritedDate = '';
    var inheritedOpponent = '';
    if (lastRow > 1) {
      var data = sheet.getRange(2, 1, lastRow - 1, AI_COLUMN_COUNT).getValues();
      for (var i = 0; i < data.length; i++) {
        if (parseInt(data[i][col['set']]) === setNumber && parseInt(data[i][col['line_index']]) === 1) {
          initialServeTeam = data[i][col['initial_serve_team']] ? data[i][col['initial_serve_team']].toString() : '';
          initialRotation = parseInt(data[i][col['initial_rotation']]) || 1;
          matchId = data[i][col['match_id']] ? data[i][col['match_id']].toString() : '';
          inheritedDate = data[i][col['date']] ? data[i][col['date']].toString() : '';
          inheritedOpponent = data[i][col['opponent']] ? data[i][col['opponent']].toString() : '';
          break;
        }
      }
    }
    
    // 新しいrally_key生成（設計書§5形式: {match_id}_set{N}_rally{NNN}）
    // rally_seqは派生値再計算後に設定するため、仮の値を設定
    var newRallyKey = matchId + '_set' + setNumber + '_rallyTMP';
    
    // 行作成
    var newRow = new Array(AI_COLUMN_COUNT);
    newRow.fill('');
    newRow[col['status']] = 'APPROVED'; // 手動追加は承認済み
    newRow[col['rally_key']] = newRallyKey;
    newRow[col['line_index']] = 1;
    newRow[col['is_two_line']] = 'FALSE';
    newRow[col['confidence']] = 0;
    newRow[col['date']] = rallyData.date || inheritedDate;
    newRow[col['opponent']] = rallyData.opponent || inheritedOpponent;
    newRow[col['set']] = setNumber;
    newRow[col['point_team']] = rallyData.point_team || '';
    newRow[col['deciding_team']] = rallyData.deciding_team || '';
    newRow[col['receive_grade']] = rallyData.receive_grade || '';
    newRow[col['receiver']] = rallyData.receiver || '';
    newRow[col['player']] = rallyData.player || '';
    newRow[col['play_type']] = rallyData.play_type || '';
    newRow[col['result_detail']] = rallyData.result_detail || '';
    newRow[col['attack_type']] = rallyData.attack_type || '';
    newRow[col['blocker_count']] = rallyData.blocker_count || '';
    newRow[col['zone_from']] = rallyData.zone_from || '';
    newRow[col['zone_to']] = rallyData.zone_to || '';
    newRow[col['note']] = rallyData.note || '';
    newRow[col['ai_note']] = '手動追加';
    newRow[col['human_modified']] = 'TRUE';
    newRow[col['approved_at']] = new Date().toISOString(); // 承認日時を設定
    try {
      newRow[col['approved_by']] = Session.getActiveUser().getEmail(); // 承認者を設定
    } catch (e) {
      newRow[col['approved_by']] = '';
    }
    newRow[col['initial_serve_team']] = initialServeTeam;
    newRow[col['initial_rotation']] = initialRotation;
    newRow[col['match_id']] = matchId;
    
    // 挿入（insertRowBeforeで空行を挿入してからデータを書き込む）
    sheet.insertRowBefore(insertRowIndex);
    sheet.getRange(insertRowIndex, 1, 1, AI_COLUMN_COUNT).setValues([newRow]);
    
    // rally_seq・rally_key振り直し（全行。2行記録のline2も同じrally_keyに更新）
    var newLastRow = sheet.getLastRow();
    var newData = sheet.getRange(2, 1, newLastRow - 1, AI_COLUMN_COUNT).getValues();
    var seq = 1;
    var updatedRallyKey = '';
    var keyMap = {}; // 旧rally_key → 新rally_key
    for (var j = 0; j < newData.length; j++) {
      if (parseInt(newData[j][col['set']]) === setNumber && parseInt(newData[j][col['line_index']]) === 1) {
        var oldKey = newData[j][col['rally_key']] ? newData[j][col['rally_key']].toString() : '';
        var newKey = matchId + '_set' + setNumber + '_rally' + seq.toString().padStart(3, '0');
        sheet.getRange(j + 2, col['rally_seq'] + 1).setValue(seq);
        sheet.getRange(j + 2, col['rally_key'] + 1).setValue(newKey);
        keyMap[oldKey] = newKey;
        if (oldKey === newRallyKey) {
          updatedRallyKey = newKey;
        }
        seq++;
      }
    }
    // line2のrally_keyも更新
    for (var k = 0; k < newData.length; k++) {
      if (parseInt(newData[k][col['set']]) === setNumber && parseInt(newData[k][col['line_index']]) === 2) {
        var oldKey2 = newData[k][col['rally_key']] ? newData[k][col['rally_key']].toString() : '';
        if (keyMap[oldKey2]) {
          sheet.getRange(k + 2, col['rally_key'] + 1).setValue(keyMap[oldKey2]);
        }
      }
    }
    
    // 派生値再計算（rally_seq振り直し後に実行しスコアを正しく計算）
    _recalcDerivedValuesInternal(setNumber);
    
    return { success: true, rally_key: updatedRallyKey || newRallyKey };
    
  } catch (e) {
    return { success: false, error: e.message };
  } finally {
    lock.releaseLock();
  }
}

/**
 * 派生値再計算（公開関数、Lock必要）
 * @param {number} setNumber - セット番号
 * @return {Object} { success: boolean, error: string }
 */
function recalcDerivedValues(setNumber) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
  } catch (e) {
    return { success: false, error: 'ロック取得失敗: ' + e.message };
  }
  try {
    return _recalcDerivedValuesInternal(setNumber);
  } catch (e) {
    return { success: false, error: e.message };
  } finally {
    lock.releaseLock();
  }
}

// === AI提案系関数（フェーズ4: 確定系） ===

/**
 * 動画リンク生成
 * @param {string} driveFileId - DriveファイルID
 * @param {number} startSec - 開始秒数
 * @return {string} 動画リンク
 */
function getVideoLink(driveFileId, startSec) {
  if (!driveFileId) {
    return '';
  }
  var link = 'https://drive.google.com/file/d/' + driveFileId + '/view';
  if (startSec !== undefined && startSec !== null && startSec > 0) {
    link += '?t=' + Math.floor(startSec);
  }
  return link;
}

/**
 * 生データへ転記
 * @param {number} setNumber - セット番号
 * @return {Object} { success: boolean, committed: number, error: string }
 */
function commitToRawData(setNumber) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
  } catch (e) {
    return { success: false, committed: 0, error: 'ロック取得失敗: ' + e.message };
  }
  
  try {
    var aiSheet = getAIProposalsSheet();
    var dataSheet = getDataSheet();
    
    if (!aiSheet) {
      return { success: false, committed: 0, error: 'AI提案シートがありません' };
    }
    if (!dataSheet) {
      return { success: false, committed: 0, error: '生データシートがありません' };
    }
    
    var lastRow = aiSheet.getLastRow();
    if (lastRow <= 1) {
      return { success: true, committed: 0 };
    }
    
    var aiCol = getAIColumnMapping(aiSheet);
    var dataCol = getColumnMapping(dataSheet);
    var aiData = aiSheet.getRange(2, 1, lastRow - 1, AI_COLUMN_COUNT).getValues();
    
    // 指定セットのAPPROVED行をフィルタ（line_index=1のみ）
    var toCommit = aiData.filter(function(row) {
      var setVal = parseInt(row[aiCol['set']]) || 1;
      var status = row[aiCol['status']] ? row[aiCol['status']].toString() : '';
      var lineIndex = parseInt(row[aiCol['line_index']]) || 1;
      return setVal === setNumber && status === 'APPROVED' && lineIndex === 1;
    });
    
    // COMMITTED済みの再commit防止チェック（設計書§4.6）
    var hasCommitted = aiData.some(function(row) {
      var setVal = parseInt(row[aiCol['set']]) || 1;
      var status = row[aiCol['status']] ? row[aiCol['status']].toString() : '';
      var lineIndex = parseInt(row[aiCol['line_index']]) || 1;
      return setVal === setNumber && lineIndex === 1 && status === 'COMMITTED';
    });
    
    if (hasCommitted && toCommit.length === 0) {
      return { success: false, committed: 0, error: 'このセットは既に転記済みです。' };
    }
    
    // 未承認データが存在する場合はエラー
    var hasUnapproved = aiData.some(function(row) {
      var setVal = parseInt(row[aiCol['set']]) || 1;
      var status = row[aiCol['status']] ? row[aiCol['status']].toString() : '';
      var lineIndex = parseInt(row[aiCol['line_index']]) || 1;
      return setVal === setNumber && lineIndex === 1 && 
             (status === 'HIGH' || status === 'MEDIUM' || status === 'LOW' || status === 'ERROR' || status === 'PENDING');
    });
    
    if (hasUnapproved) {
      return { success: false, committed: 0, error: '未承認の提案が存在します。先に承認してください。' };
    }
    
    if (toCommit.length === 0) {
      return { success: true, committed: 0 };
    }
    
    // 生データシートの既存データを取得（重複チェック用）
    var dataLastRow = dataSheet.getLastRow();
    var existingKeys = {};
    if (dataLastRow > 1) {
      var existingData = dataSheet.getRange(2, 1, dataLastRow - 1, COLUMN_COUNT).getValues();
      existingData.forEach(function(row) {
        // 重複キーを date_set_scoreUs_scoreThem_team_result に修正（設計書§8.2ステップ5）
        var key = (row[dataCol['date']] || '') + '_' + 
                  (row[dataCol['set']] || '') + '_' + 
                  (row[dataCol['score_us']] || '') + '_' + 
                  (row[dataCol['score_them']] || '') + '_' +
                  (row[dataCol['team']] || '') + '_' +
                  (row[dataCol['result']] || '');
        existingKeys[key] = true;
      });
    }
    
    // 派生値再計算
    _recalcDerivedValuesInternal(setNumber);
    
    // 最新のAIデータを再取得
    aiData = aiSheet.getRange(2, 1, lastRow - 1, AI_COLUMN_COUNT).getValues();
    toCommit = aiData.filter(function(row) {
      var setVal = parseInt(row[aiCol['set']]) || 1;
      var status = row[aiCol['status']] ? row[aiCol['status']].toString() : '';
      var lineIndex = parseInt(row[aiCol['line_index']]) || 1;
      return setVal === setNumber && status === 'APPROVED' && lineIndex === 1;
    });
    
    // rally_seqでソート
    toCommit.sort(function(a, b) {
      var seqA = parseInt(a[aiCol['rally_seq']]) || 0;
      var seqB = parseInt(b[aiCol['rally_seq']]) || 0;
      return seqA - seqB;
    });
    
    var committedCount = 0;
    var rowsToAppend = [];
    
    toCommit.forEach(function(aiRow) {
      var isTwoLine = aiRow[aiCol['is_two_line']] ? aiRow[aiCol['is_two_line']].toString() : 'FALSE';
      
      // line1のデータを作成
      var rowData = {
        date: aiRow[aiCol['date']] ? aiRow[aiCol['date']].toString() : '',
        opponent: aiRow[aiCol['opponent']] ? aiRow[aiCol['opponent']].toString() : '',
        set: parseInt(aiRow[aiCol['set']]) || 1,
        scoreUs: parseInt(aiRow[aiCol['score_us']]) || 0,
        scoreThem: parseInt(aiRow[aiCol['score_them']]) || 0,
        pointTeam: aiRow[aiCol['point_team']] ? aiRow[aiCol['point_team']].toString() : '',
        serveTeam: aiRow[aiCol['serve_team']] ? aiRow[aiCol['serve_team']].toString() : '',
        rotation: parseInt(aiRow[aiCol['rotation']]) || 1,
        receiveGrade: aiRow[aiCol['receive_grade']] ? aiRow[aiCol['receive_grade']].toString() : '',
        receiver: aiRow[aiCol['receiver']] ? aiRow[aiCol['receiver']].toString() : '',
        team: aiRow[aiCol['team']] ? aiRow[aiCol['team']].toString() : '',
        player: aiRow[aiCol['player']] ? aiRow[aiCol['player']].toString() : '',
        playType: aiRow[aiCol['play_type']] ? aiRow[aiCol['play_type']].toString() : '',
        result: aiRow[aiCol['result']] ? aiRow[aiCol['result']].toString() : '',
        resultDetail: aiRow[aiCol['result_detail']] ? aiRow[aiCol['result_detail']].toString() : '',
        attackType: aiRow[aiCol['attack_type']] ? aiRow[aiCol['attack_type']].toString() : '',
        blockerCount: aiRow[aiCol['blocker_count']] ? aiRow[aiCol['blocker_count']].toString() : '',
        zoneFrom: aiRow[aiCol['zone_from']] ? aiRow[aiCol['zone_from']].toString() : '',
        zoneTo: aiRow[aiCol['zone_to']] ? aiRow[aiCol['zone_to']].toString() : '',
        note: aiRow[aiCol['note']] ? aiRow[aiCol['note']].toString() : ''
      };
      
      // 重複チェック（date_set_scoreUs_scoreThem_team_result）
      var key = rowData.date + '_' + rowData.set + '_' + rowData.scoreUs + '_' + rowData.scoreThem + '_' + rowData.team + '_' + rowData.result;
      if (existingKeys[key]) {
        return; // 重複はスキップ
      }
      
      rowsToAppend.push(rowData);
      existingKeys[key] = true;
      committedCount++;
      
      // 2行記録の場合、line2も転記
      if (isTwoLine === 'TRUE') {
        var rallyKey = aiRow[aiCol['rally_key']] ? aiRow[aiCol['rally_key']].toString() : '';
        for (var i = 0; i < aiData.length; i++) {
          if (aiData[i][aiCol['rally_key']] && aiData[i][aiCol['rally_key']].toString() === rallyKey &&
              parseInt(aiData[i][aiCol['line_index']]) === 2) {
            var aiRow2 = aiData[i];
            var rowData2 = {
              date: aiRow2[aiCol['date']] ? aiRow2[aiCol['date']].toString() : '',
              opponent: aiRow2[aiCol['opponent']] ? aiRow2[aiCol['opponent']].toString() : '',
              set: parseInt(aiRow2[aiCol['set']]) || 1,
              scoreUs: parseInt(aiRow2[aiCol['score_us']]) || 0,
              scoreThem: parseInt(aiRow2[aiCol['score_them']]) || 0,
              pointTeam: aiRow2[aiCol['point_team']] ? aiRow2[aiCol['point_team']].toString() : '',
              serveTeam: aiRow2[aiCol['serve_team']] ? aiRow2[aiCol['serve_team']].toString() : '',
              rotation: parseInt(aiRow2[aiCol['rotation']]) || 1,
              receiveGrade: aiRow2[aiCol['receive_grade']] ? aiRow2[aiCol['receive_grade']].toString() : '',
              receiver: aiRow2[aiCol['receiver']] ? aiRow2[aiCol['receiver']].toString() : '',
              team: aiRow2[aiCol['team']] ? aiRow2[aiCol['team']].toString() : '',
              player: aiRow2[aiCol['player']] ? aiRow2[aiCol['player']].toString() : '',
              playType: aiRow2[aiCol['play_type']] ? aiRow2[aiCol['play_type']].toString() : '',
              result: aiRow2[aiCol['result']] ? aiRow2[aiCol['result']].toString() : '',
              resultDetail: aiRow2[aiCol['result_detail']] ? aiRow2[aiCol['result_detail']].toString() : '',
              attackType: aiRow2[aiCol['attack_type']] ? aiRow2[aiCol['attack_type']].toString() : '',
              blockerCount: aiRow2[aiCol['blocker_count']] ? aiRow2[aiCol['blocker_count']].toString() : '',
              zoneFrom: aiRow2[aiCol['zone_from']] ? aiRow2[aiCol['zone_from']].toString() : '',
              zoneTo: aiRow2[aiCol['zone_to']] ? aiRow2[aiCol['zone_to']].toString() : '',
              note: aiRow2[aiCol['note']] ? aiRow2[aiCol['note']].toString() : ''
            };
            
            var key2 = rowData2.date + '_' + rowData2.set + '_' + rowData2.scoreUs + '_' + rowData2.scoreThem + '_' + rowData2.team + '_' + rowData2.result;
            if (!existingKeys[key2]) {
              rowsToAppend.push(rowData2);
              existingKeys[key2] = true;
              committedCount++;
            }
            break;
          }
        }
      }
    });
    
    // バッチ追記
    if (rowsToAppend.length > 0) {
      var appendData = rowsToAppend.map(function(d) {
        return [
          d.date,
          d.opponent,
          d.set,
          d.scoreUs,
          d.scoreThem,
          d.pointTeam,
          d.serveTeam,
          d.rotation,
          d.receiveGrade,
          d.receiver,
          d.team,
          d.player,
          d.playType,
          d.result,
          d.resultDetail,
          d.attackType,
          d.blockerCount,
          d.zoneFrom,
          d.zoneTo,
          d.note
        ];
      });
      dataSheet.getRange(dataSheet.getLastRow() + 1, 1, appendData.length, COLUMN_COUNT).setValues(appendData);
    }
    
    // AI提案シートのステータスをCOMMITTEDに更新
    var rowsToUpdate = [];
    aiData.forEach(function(row, index) {
      var setVal = parseInt(row[aiCol['set']]) || 1;
      var status = row[aiCol['status']] ? row[aiCol['status']].toString() : '';
      var lineIndex = parseInt(row[aiCol['line_index']]) || 1;
      
      if (setVal === setNumber && status === 'APPROVED' && lineIndex === 1) {
        var updatedRow = row.slice();
        updatedRow[aiCol['status']] = 'COMMITTED';
        rowsToUpdate.push({ row: index + 2, data: updatedRow });
        
        // 2行記録も更新
        var rallyKey = row[aiCol['rally_key']] ? row[aiCol['rally_key']].toString() : '';
        var isTwoLine = row[aiCol['is_two_line']] ? row[aiCol['is_two_line']].toString() : 'FALSE';
        if (isTwoLine === 'TRUE') {
          for (var i = 0; i < aiData.length; i++) {
            if (aiData[i][aiCol['rally_key']] && aiData[i][aiCol['rally_key']].toString() === rallyKey &&
                parseInt(aiData[i][aiCol['line_index']]) === 2) {
              var updatedRow2 = aiData[i].slice();
              updatedRow2[aiCol['status']] = 'COMMITTED';
              rowsToUpdate.push({ row: i + 2, data: updatedRow2 });
              break;
            }
          }
        }
      }
    });
    
    rowsToUpdate.forEach(function(item) {
      aiSheet.getRange(item.row, 1, 1, AI_COLUMN_COUNT).setValues([item.data]);
    });
    
    // AI精度ログ記録（設計書§5.4）
    var accuracyLogSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('AI精度ログ');
    if (!accuracyLogSheet) {
      accuracyLogSheet = SpreadsheetApp.getActiveSpreadsheet().insertSheet('AI精度ログ');
      // ヘッダー行を設定
      accuracyLogSheet.appendRow(['date', 'set', 'rally_key', 'field_name', 'ai_value', 'human_value', 'was_correct', 'ai_confidence']);
    }
    
    var accuracyRows = [];
    var comparisonFields = ['point_team', 'deciding_team', 'receive_grade', 'receiver', 'play_type', 'player', 'result_detail', 'attack_type', 'blocker_count', 'zone_from', 'zone_to', 'our_defense_type'];
    
    aiData.forEach(function(row) {
      var setVal = parseInt(row[aiCol['set']]) || 1;
      var status = row[aiCol['status']] ? row[aiCol['status']].toString() : '';
      var lineIndex = parseInt(row[aiCol['line_index']]) || 1;
      var originalPayload = row[aiCol['original_payload']] ? row[aiCol['original_payload']].toString() : '';
      var finalPayload = row[aiCol['final_payload']] ? row[aiCol['final_payload']].toString() : '';
      var fieldConfidences = row[aiCol['field_confidences']] ? row[aiCol['field_confidences']].toString() : '';
      
      // line1かつoriginal_payload非空の行のみ（設計書§5.4）
      if (setVal === setNumber && lineIndex === 1 && status === 'COMMITTED' && originalPayload && originalPayload !== '') {
        try {
          var originalJson = JSON.parse(originalPayload);
          var finalJson = finalPayload ? JSON.parse(finalPayload) : {};
          var confJson = fieldConfidences ? JSON.parse(fieldConfidences) : {};
          
          comparisonFields.forEach(function(field) {
            var aiValue = originalJson[field] || '';
            var humanValue = finalJson[field] || '';
            var wasCorrect = aiValue === humanValue;
            var aiConfidence = confJson[field] || 0;
            
            accuracyRows.push([
              row[aiCol['date']] ? row[aiCol['date']].toString() : '',
              setVal,
              row[aiCol['rally_key']] ? row[aiCol['rally_key']].toString() : '',
              field,
              aiValue,
              humanValue,
              wasCorrect,
              aiConfidence
            ]);
          });
        } catch (e) {
          // JSONパースエラーはスキップ
        }
      }
    });
    
    // 精度ログを追記
    if (accuracyRows.length > 0) {
      accuracyLogSheet.getRange(accuracyLogSheet.getLastRow() + 1, 1, accuracyRows.length, 8).setValues(accuracyRows);
    }
    
    return { success: true, committed: committedCount };
    
  } catch (e) {
    return { success: false, committed: 0, error: e.message };
  } finally {
    lock.releaseLock();
  }
}

// === Notion設定 ===
function getNotionPageId() {
  var props = PropertiesService.getScriptProperties();
  return props.getProperty('NOTION_PAGE_ID');
}

// === 試合データ集計 ===
function analyzeMatch(rows, col) {
  var last = rows[rows.length - 1];
  var scoreUs = parseInt(last[col['score_us']]) || 0;
  var scoreThem = parseInt(last[col['score_them']]) || 0;
  var osvTotal=0,osvWon=0,usvTotal=0,usvWon=0;
  var recvA=0,recvB=0,recvC=0,recvD=0;
  var rot={};
  for(var r=1;r<=ROTATION_COUNT;r++)rot[r]={won:0,lost:0};
  var playPt={},playMs={};
  PLAY_TYPES.forEach(function(p){playPt[p]=0;playMs[p]=0});
  var usPoints=0,usMiss=0;

  rows.forEach(function(row){
    var st=row[col['serve_team']].toString();
    var pt=row[col['point_team']].toString();
    var rotation=parseInt(row[col['rotation']])||0;
    var rg=row[col['receive_grade']].toString();
    var team=row[col['team']].toString();
    var result=row[col['result']].toString();
    var playType=row[col['play_type']].toString();

    if(st!=='自チーム'){osvTotal++;if(pt==='自チーム')osvWon++}
    else{usvTotal++;if(pt==='自チーム')usvWon++}
    if(rg==='A')recvA++;if(rg==='B')recvB++;if(rg==='C')recvC++;if(rg==='D')recvD++;
    if(rotation>=1&&rotation<=ROTATION_COUNT){if(pt==='自チーム')rot[rotation].won++;else rot[rotation].lost++}
    if(team==='自チーム'){
      if(result==='得点'){usPoints++;if(playPt[playType]!==undefined)playPt[playType]++}
      if(result==='ミス'){usMiss++;if(playMs[playType]!==undefined)playMs[playType]++}
    }
  });

  var recvTotal=recvA+recvB+recvC+recvD;
  return {
    date:last[col['date']].toString(),opponent:last[col['opponent']].toString(),
    scoreUs:scoreUs,scoreThem:scoreThem,
    result:scoreUs>scoreThem?'勝':scoreUs<scoreThem?'負':'分',
    rallies:rows.length,
    soRate:osvTotal>0?(osvWon/osvTotal*100).toFixed(1):'0.0',soWon:osvWon,soTotal:osvTotal,
    brkRate:usvTotal>0?(usvWon/usvTotal*100).toFixed(1):'0.0',brkWon:usvWon,brkTotal:usvTotal,
    usEff:(usPoints+usMiss)>0?(usPoints/(usPoints+usMiss)*100).toFixed(1):'0.0',
    recvA:recvA,recvB:recvB,recvC:recvC,recvD:recvD,
    recvABRate:recvTotal>0?((recvA+recvB)/recvTotal*100).toFixed(1):'0.0',
    rot:rot,playPt:playPt,playMs:playMs,
  };
}

// === Notion自動更新 ===
function updateNotion() {
  var NOTION_TOKEN = getNotionToken();
  var NOTION_PAGE_ID = getNotionPageId();

  // トークンまたはページIDが未設定の場合はエラー
  if (!NOTION_TOKEN || !NOTION_PAGE_ID) {
    throw new Error('NOTION_TOKENまたはNOTION_PAGE_IDがスクリプトプロパティに設定されていません');
  }

  var sheet = getDataSheet();
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return;

  var col = getColumnMapping(sheet);
  var data = sheet.getRange(2, 1, lastRow - 1, COLUMN_COUNT).getValues();

  var matches = {};
  data.forEach(function(row) {
    var key = row[col['date']] + '_' + row[col['opponent']];
    if (!matches[key]) matches[key] = [];
    matches[key].push(row);
  });

  var keys = Object.keys(matches).sort().reverse().slice(0, MAX_MATCHES).reverse();
  var results = keys.map(function(key) {
    return analyzeMatch(matches[key], col);
  });

  clearNotionPage(NOTION_PAGE_ID, NOTION_TOKEN);

  var lastR=results[results.length-1];
  notionAddHeading(NOTION_PAGE_ID,'3試合比較レポート',1, NOTION_TOKEN);
  notionAddText(NOTION_PAGE_ID,'最終更新: '+lastR.date+' vs '+lastR.opponent+' | 全'+data.length+'ラリー', NOTION_TOKEN);
  notionAddDivider(NOTION_PAGE_ID, NOTION_TOKEN);

  notionAddHeading(NOTION_PAGE_ID,'試合結果', 2, NOTION_TOKEN);
  notionAddTable(NOTION_PAGE_ID,['日付','相手','スコア','結果','ラリー数'],
    results.map(function(r){return[r.date,r.opponent,r.scoreUs+'-'+r.scoreThem,r.result,r.rallies+'']}), NOTION_TOKEN);
  notionAddDivider(NOTION_PAGE_ID, NOTION_TOKEN);

  notionAddHeading(NOTION_PAGE_ID,'SO率 / BRK率', 2, NOTION_TOKEN);
  notionAddTable(NOTION_PAGE_ID,['日付','相手','SO率','BRK率','攻撃効率'],
    results.map(function(r){return[r.date,r.opponent,r.soRate+'% ('+r.soWon+'/'+r.soTotal+')',r.brkRate+'% ('+r.brkWon+'/'+r.brkTotal+')',r.usEff+'%']}), NOTION_TOKEN);
  notionAddDivider(NOTION_PAGE_ID, NOTION_TOKEN);

  notionAddHeading(NOTION_PAGE_ID,'サーブキャッチ', 2, NOTION_TOKEN);
  notionAddTable(NOTION_PAGE_ID,['日付','相手','A','B','C','D','A+B率'],
    results.map(function(r){return[r.date,r.opponent,r.recvA+'',r.recvB+'',r.recvC+'',r.recvD+'',r.recvABRate+'%']}), NOTION_TOKEN);
  notionAddDivider(NOTION_PAGE_ID, NOTION_TOKEN);

  notionAddHeading(NOTION_PAGE_ID,'ローテーション別', 2, NOTION_TOKEN);
  var rotH=['日付','相手','R1','R2','R3','R4','R5','R6'];
  notionAddTable(NOTION_PAGE_ID,rotH,results.map(function(r){
    var row=[r.date,r.opponent];
    for(var i=1;i<=ROTATION_COUNT;i++){var t=r.rot[i].won+r.rot[i].lost;row.push((t>0?(r.rot[i].won/t*100).toFixed(0):'0')+'% ('+r.rot[i].won+'/'+t+')')}
    return row;
  }), NOTION_TOKEN);
  notionAddDivider(NOTION_PAGE_ID, NOTION_TOKEN);

  notionAddHeading(NOTION_PAGE_ID,'プレー別', 2, NOTION_TOKEN);
  notionAddTable(NOTION_PAGE_ID,['日付','相手'].concat(PLAY_TYPES),
    results.map(function(r){var row=[r.date,r.opponent];PLAY_TYPES.forEach(function(p){row.push(r.playPt[p]+'得/'+r.playMs[p]+'失')});return row}), NOTION_TOKEN);
}

// === Notion APIヘルパー ===
function notionFetch(endpoint,payload,token){
  return JSON.parse(UrlFetchApp.fetch('https://api.notion.com/v1/'+endpoint,{
    method:'post',headers:{'Authorization':'Bearer '+token,'Content-Type':'application/json','Notion-Version':NOTION_API_VERSION},
    payload:JSON.stringify(payload),muteHttpExceptions:true
  }).getContentText());
}

function notionGet(endpoint,token){
  return JSON.parse(UrlFetchApp.fetch('https://api.notion.com/v1/'+endpoint,{
    method:'get',headers:{'Authorization':'Bearer '+token,'Notion-Version':NOTION_API_VERSION},muteHttpExceptions:true
  }).getContentText());
}

function notionDelete(endpoint,token){
  UrlFetchApp.fetch('https://api.notion.com/v1/'+endpoint,{
    method:'delete',headers:{'Authorization':'Bearer '+token,'Notion-Version':NOTION_API_VERSION},muteHttpExceptions:true
  });
}

function clearNotionPage(pageId,token){
  var blocks=notionGet('blocks/'+pageId+'/children',token);
  if(blocks.results){blocks.results.forEach(function(b){
    notionDelete('blocks/'+b.id,token);
  })}
}

function notionAddHeading(pid,text,level,token){
  level=level||2;var b={type:'heading_'+level};b['heading_'+level]={rich_text:[{text:{content:text}}]};
  notionFetch('blocks/'+pid+'/children',{children:[b]},token);
}

function notionAddText(pid,text,token){
  notionFetch('blocks/'+pid+'/children',{children:[{type:'paragraph',paragraph:{rich_text:[{text:{content:text}}]}}]},token);
}

function notionAddDivider(pid,token){
  notionFetch('blocks/'+pid+'/children',{children:[{type:'divider',divider:{}}]},token);
}

function notionAddTable(pid,headers,rows,token){
  var w=headers.length;
  var trs=[{type:'table_row',table_row:{cells:headers.map(function(h){return[{type:'text',text:{content:h+''}}]})}}];
  rows.forEach(function(row){trs.push({type:'table_row',table_row:{cells:row.map(function(v){return[{type:'text',text:{content:v+''}}]})}})});
  notionFetch('blocks/'+pid+'/children',{children:[{type:'table',table:{table_width:w,has_column_header:true,has_row_header:false,children:trs}}]},token);
}
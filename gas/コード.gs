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
    
    // rally_keyで検索
    var rowIndex = -1;
    for (var i = 0; i < data.length; i++) {
      if (data[i][col['rally_key']] && data[i][col['rally_key']].toString() === rallyKey) {
        rowIndex = i + 2; // 1-indexed (ヘッダー行+1)
        break;
      }
    }
    
    if (rowIndex === -1) {
      return { success: false, error: 'rally_keyが見つかりません: ' + rallyKey };
    }
    
    var row = data[rowIndex - 2];
    var status = row[col['status']] ? row[col['status']].toString() : '';
    
    // COMMITTEDは変更不可
    if (status === 'COMMITTED') {
      return { success: false, error: 'COMMITTEDは変更できません' };
    }
    
    // 修正データのマージ
    var updatedRow = row.slice();
    if (modifiedData) {
      // point_teamが変更された場合、派生値再計算が必要
      var pointTeamChanged = modifiedData.point_team && modifiedData.point_team !== row[col['point_team']];
      
      // 更新可能なフィールドのみ
      var updateFields = ['point_team', 'serve_team', 'rotation', 'deciding_team', 
                          'receive_grade', 'receiver', 'team', 'player', 'play_type',
                          'result', 'result_detail', 'attack_type', 'blocker_count',
                          'zone_from', 'zone_to', 'note'];
      
      updateFields.forEach(function(field) {
        if (modifiedData[field] !== undefined && modifiedData[field] !== null) {
          updatedRow[col[field]] = modifiedData[field];
        }
      });
      
      // human_modifiedをTRUE
      updatedRow[col['human_modified']] = 'TRUE';
      
      // final_payloadを更新（JSON文字列化）
      modifiedData.human_modified = 'TRUE';
      updatedRow[col['final_payload']] = JSON.stringify(modifiedData);
      
      // point_team変更時は派生値再計算
      if (pointTeamChanged) {
        var setNumber = parseInt(updatedRow[col['set']]) || 1;
        _recalcDerivedValuesInternal(setNumber);
      }
    }
    
    // statusをAPPROVEDに
    updatedRow[col['status']] = 'APPROVED';
    
    // approved_at, approved_byを設定
    updatedRow[col['approved_at']] = new Date().toISOString();
    updatedRow[col['approved_by']] = Session.getActiveUser().getEmail();
    
    // line_index=2の場合、payload関連フィールドは空のまま
    if (parseInt(updatedRow[col['line_index']]) === 2) {
      updatedRow[col['original_payload']] = '';
      updatedRow[col['final_payload']] = '';
      updatedRow[col['human_modified']] = '';
      updatedRow[col['approved_at']] = '';
      updatedRow[col['approved_by']] = '';
    }
    
    // 更新
    sheet.getRange(rowIndex, 1, 1, AI_COLUMN_COUNT).setValues([updatedRow]);
    
    return { success: true };
    
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
    
    // 指定セットのHIGH/MEDIUMをAPPROVEDに
    for (var i = 0; i < data.length; i++) {
      var setVal = parseInt(data[i][col['set']]) || 1;
      var status = data[i][col['status']] ? data[i][col['status']].toString() : '';
      
      if (setVal === setNumber && (status === 'HIGH' || status === 'MEDIUM')) {
        var updatedRow = data[i].slice();
        updatedRow[col['status']] = 'APPROVED';
        updatedRow[col['approved_at']] = new Date().toISOString();
        updatedRow[col['approved_by']] = Session.getActiveUser().getEmail();
        rowsToUpdate.push({ row: i + 2, data: updatedRow });
        approvedCount++;
      }
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
function doGet() {
  return HtmlService.createHtmlOutputFromFile('InputForm')
    .setTitle('🏐 バレー スタッツ')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function addRecord(data) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('生データ');

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
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('生データ');
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return { success: false };

  // ヘッダーから列位置を取得（ずれ防止）
  var headers = sheet.getRange(1, 1, 1, 20).getValues()[0];
  var col = {};
  headers.forEach(function(h, i) { col[h.toString().trim()] = i; });

  var row = sheet.getRange(lastRow, 1, 1, 20).getValues()[0];
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
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('生データ');
  var lastRow = sheet.getLastRow();

  if (lastRow <= 1) {
    return {
      found: false,
      set: 1, scoreUs: 0, scoreThem: 0,
      date: '', opponent: '',
      serveTeam: '', rotation: 1, pointTeam: ''
    };
  }

  // ヘッダーから列位置を取得
  var headers = sheet.getRange(1, 1, 1, 20).getValues()[0];
  var col = {};
  headers.forEach(function(h, i) { col[h.toString().trim()] = i; });

  // 最後の行を取得
  var row = sheet.getRange(lastRow, 1, 1, 20).getValues()[0];

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
    var allData = sheet.getRange(2, 1, lastRow - 1, 20).getValues();
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
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('生データ');
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return [];

  // ヘッダーからopponent列を特定
  var headers = sheet.getRange(1, 1, 1, 20).getValues()[0];
  var oppCol = -1;
  headers.forEach(function(h, i) { if(h.toString().trim() === 'opponent') oppCol = i + 1; });
  if (oppCol < 0) return [];

  var data = sheet.getRange(2, oppCol, lastRow-1, 1).getValues();
  var u = {};
  data.forEach(function(r){ if(r[0]&&r[0].toString().trim()) u[r[0].toString().trim()]=true; });
  return Object.keys(u).sort();
}

function getSettings() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('設定');
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
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

function manualUpdateNotion() {
  try {
    updateNotion();
    return { success: true, message: 'Notion更新完了' };
  } catch (e) {
    return { success: false, message: e.message };
  }
}

// === Notion設定 ===
var NOTION_TOKEN = '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';
var NOTION_PAGE_ID = '331feaabd15e80b092a8f392c9157be3';

// === Notion自動更新 ===
function updateNotion() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('生データ');
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return;

  var headers = sheet.getRange(1, 1, 1, 20).getValues()[0];
  var col = {};
  headers.forEach(function(h, i) { col[h.toString().trim()] = i; });

  var data = sheet.getRange(2, 1, lastRow - 1, 20).getValues();

  var matches = {};
  data.forEach(function(row) {
    var key = row[col['date']] + '_' + row[col['opponent']];
    if (!matches[key]) matches[key] = [];
    matches[key].push(row);
  });

  var keys = Object.keys(matches).sort().reverse().slice(0, 3).reverse();

  var results = keys.map(function(key) {
    var rows = matches[key];
    var last = rows[rows.length - 1];
    var scoreUs = parseInt(last[col['score_us']]) || 0;
    var scoreThem = parseInt(last[col['score_them']]) || 0;
    var osvTotal=0,osvWon=0,usvTotal=0,usvWon=0;
    var recvA=0,recvB=0,recvC=0,recvD=0;
    var rot={};
    for(var r=1;r<=6;r++)rot[r]={won:0,lost:0};
    var playPt={},playMs={};
    ['サーブ','スパイク','フェイント','プッシュ','ブロック'].forEach(function(p){playPt[p]=0;playMs[p]=0});
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
      if(rotation>=1&&rotation<=6){if(pt==='自チーム')rot[rotation].won++;else rot[rotation].lost++}
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
  });

  clearNotionPage(NOTION_PAGE_ID);

  var lastR=results[results.length-1];
  notionAddHeading(NOTION_PAGE_ID,'3試合比較レポート',1);
  notionAddText(NOTION_PAGE_ID,'最終更新: '+lastR.date+' vs '+lastR.opponent+' | 全'+data.length+'ラリー');
  notionAddDivider(NOTION_PAGE_ID);

  notionAddHeading(NOTION_PAGE_ID,'試合結果');
  notionAddTable(NOTION_PAGE_ID,['日付','相手','スコア','結果','ラリー数'],
    results.map(function(r){return[r.date,r.opponent,r.scoreUs+'-'+r.scoreThem,r.result,r.rallies+'']}));
  notionAddDivider(NOTION_PAGE_ID);

  notionAddHeading(NOTION_PAGE_ID,'SO率 / BRK率');
  notionAddTable(NOTION_PAGE_ID,['日付','相手','SO率','BRK率','攻撃効率'],
    results.map(function(r){return[r.date,r.opponent,r.soRate+'% ('+r.soWon+'/'+r.soTotal+')',r.brkRate+'% ('+r.brkWon+'/'+r.brkTotal+')',r.usEff+'%']}));
  notionAddDivider(NOTION_PAGE_ID);

  notionAddHeading(NOTION_PAGE_ID,'サーブキャッチ');
  notionAddTable(NOTION_PAGE_ID,['日付','相手','A','B','C','D','A+B率'],
    results.map(function(r){return[r.date,r.opponent,r.recvA+'',r.recvB+'',r.recvC+'',r.recvD+'',r.recvABRate+'%']}));
  notionAddDivider(NOTION_PAGE_ID);

  notionAddHeading(NOTION_PAGE_ID,'ローテーション別');
  var rotH=['日付','相手','R1','R2','R3','R4','R5','R6'];
  notionAddTable(NOTION_PAGE_ID,rotH,results.map(function(r){
    var row=[r.date,r.opponent];
    for(var i=1;i<=6;i++){var t=r.rot[i].won+r.rot[i].lost;row.push((t>0?(r.rot[i].won/t*100).toFixed(0):'0')+'% ('+r.rot[i].won+'/'+t+')')}
    return row;
  }));
  notionAddDivider(NOTION_PAGE_ID);

  var plays=['サーブ','スパイク','フェイント','プッシュ','ブロック'];
  notionAddHeading(NOTION_PAGE_ID,'プレー別');
  notionAddTable(NOTION_PAGE_ID,['日付','相手'].concat(plays),
    results.map(function(r){var row=[r.date,r.opponent];plays.forEach(function(p){row.push(r.playPt[p]+'得/'+r.playMs[p]+'失')});return row}));
}

// === Notion APIヘルパー ===
function notionFetch(endpoint,payload){
  return JSON.parse(UrlFetchApp.fetch('https://api.notion.com/v1/'+endpoint,{
    method:'post',headers:{'Authorization':'Bearer '+NOTION_TOKEN,'Content-Type':'application/json','Notion-Version':'2022-06-28'},
    payload:JSON.stringify(payload),muteHttpExceptions:true
  }).getContentText());
}

function notionGet(endpoint){
  return JSON.parse(UrlFetchApp.fetch('https://api.notion.com/v1/'+endpoint,{
    method:'get',headers:{'Authorization':'Bearer '+NOTION_TOKEN,'Notion-Version':'2022-06-28'},muteHttpExceptions:true
  }).getContentText());
}

function clearNotionPage(pageId){
  var blocks=notionGet('blocks/'+pageId+'/children');
  if(blocks.results){blocks.results.forEach(function(b){
    UrlFetchApp.fetch('https://api.notion.com/v1/blocks/'+b.id,{
      method:'delete',headers:{'Authorization':'Bearer '+NOTION_TOKEN,'Notion-Version':'2022-06-28'},muteHttpExceptions:true
    });
  })}
}

function notionAddHeading(pid,text,level){
  level=level||2;var b={type:'heading_'+level};b['heading_'+level]={rich_text:[{text:{content:text}}]};
  notionFetch('blocks/'+pid+'/children',{children:[b]});
}

function notionAddText(pid,text){
  notionFetch('blocks/'+pid+'/children',{children:[{type:'paragraph',paragraph:{rich_text:[{text:{content:text}}]}}]});
}

function notionAddDivider(pid){
  notionFetch('blocks/'+pid+'/children',{children:[{type:'divider',divider:{}}]});
}

function notionAddTable(pid,headers,rows){
  var w=headers.length;
  var trs=[{type:'table_row',table_row:{cells:headers.map(function(h){return[{type:'text',text:{content:h+''}}]})}}];
  rows.forEach(function(row){trs.push({type:'table_row',table_row:{cells:row.map(function(v){return[{type:'text',text:{content:v+''}}]})}})});
  notionFetch('blocks/'+pid+'/children',{children:[{type:'table',table:{table_width:w,has_column_header:true,has_row_header:false,children:trs}}]});
}
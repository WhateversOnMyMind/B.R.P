import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const code = readFileSync(new URL('../apps-script/Code.gs', import.meta.url), 'utf8');
function setup(rows = [['Timestamp','Arm','Count','Distance(cm)']]) {
  const sheets = new Map();
  const makeSheet = (rows) => ({rows, getLastRow:()=>rows.length,
    appendRow:r=>rows.push(r), getDataRange:()=>({getValues:()=>rows}),
    getRange:(r,c)=>({getValue:()=>rows[r-1]?.[c-1] ?? '',
      setValue:v=>{(rows[r-1]??=[])[c-1]=v;}})});
  sheets.set('Data',makeSheet(rows));
  let releases=0;
  const ctx=vm.createContext({
    LockService:{getScriptLock:()=>({waitLock:()=>{},releaseLock:()=>releases++})},
    SpreadsheetApp:{getActiveSpreadsheet:()=>({getSheetByName:n=>sheets.get(n),
      getSheets:()=>[...sheets.values()],insertSheet:n=>{const s=makeSheet([]);sheets.set(n,s);return s;}})},
    ContentService:{MimeType:{JSON:'json'},createTextOutput:text=>({text,setMimeType(){return this;}})}
  });
  vm.runInContext(code,ctx);
  return {sheets,rows,releases:()=>releases,
    post:data=>JSON.parse(ctx.doPost({postData:{contents:JSON.stringify(data)}}).text),
    get:arm=>JSON.parse(ctx.doGet({parameter:{arm}}).text)};
}
test('logs left/right/no alert and preserves original columns and history',()=>{
  const history=['old','L',1,2];
  const s=setup([['Timestamp','Arm','Count','Distance(cm)'],history]);
  for(const [arm,alerted,result] of [['L',true,'L'],['R',true,'R'],['R',false,'None']]){
    assert.equal(s.post({arm,count:7,distance:125,alerted}).status,'ok');
    assert.deepEqual(Array.from(s.rows.at(-1).slice(1)),[arm,7,125,result]);
  }
  assert.equal(s.rows[0][4],'Alerted Arm');
  assert.deepEqual(history,['old','L',1,2]);
  assert.equal(s.get('L').alertedArm,'L');
  assert.equal(s.get('R').alertedArm,'None');
  assert.equal(s.releases(),3);
});
test('legacy records are Unknown, not false',()=>{
  const s=setup([['Timestamp','Arm','Count','Distance(cm)'],['old','L',1,2]]);
  assert.equal(s.get('L').alertedArm,'Unknown');
  s.post({arm:'R',count:1,distance:2});
  assert.equal(s.rows.at(-1)[4],'Unknown');
});
test('toggle events stay separate and keep their schema',()=>{
  const s=setup();
  assert.equal(s.post({event:'motor_toggle',state:'off',ts:1700000000}).status,'ok');
  const rows=s.sheets.get('Events').rows;
  assert.equal(rows.length,2);
  assert.equal(rows[1].length,4);
  assert.equal(rows[1][2],'off');
  assert.equal(rows[1][3].getTime(),1700000000000);
  assert.equal(s.rows.length,1);
});
test('rejects ambiguous alert values and avoids overwriting another column',()=>{
  const s=setup();
  assert.equal(s.post({arm:'L',count:1,distance:2,alerted:'false'}).status,'error');
  assert.equal(s.post({arm:'?',count:1,distance:2,alerted:true}).status,'error');
  s.rows[0][4]='Notes';
  assert.equal(s.post({arm:'L',count:1,distance:2,alerted:true}).status,'error');
  assert.equal(s.rows.length,1);
  assert.equal(s.rows[0][4],'Notes');
  assert.equal(s.releases(),3);
});
test('initializes an empty Data sheet',()=>{
  const s=setup([]);
  assert.equal(s.get('L').status,'empty');
  s.post({arm:'L',count:0,distance:0,alerted:false});
  assert.equal(s.rows.length,2);
  assert.equal(s.rows[0][4],'Alerted Arm');
});

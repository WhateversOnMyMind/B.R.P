import test from 'node:test';
import assert from 'node:assert/strict';
import {ControlApi} from '../B.R.P Website/control/api.mjs';
import {createHarness} from '../cloudflare/test/harness.mjs';
import worker from '../cloudflare/src/worker.mjs';

test('operator CSV exports every page of real archived measurements and labels commanded alerts', async () => {
  const h=await createHarness();
  for(let sequence=1;sequence<=3;sequence++) {
    await h.exchange(sequence===2?'R':'L',{windowReady:true,windowSequence:sequence,
      windowCount:sequence,windowDistanceCm:sequence*10,windowAlerted:sequence===1,
      windowStartMs:sequence*10000,windowEndMs:(sequence+1)*10000,
      windowLateMs:0,windowMissedDeadlines:0});
  }
  const api=new ControlApi('https://control.example',(url,init)=>worker.fetch(new Request(url,init),h.env));
  api.signIn(h.keys.operator);
  assert.equal(typeof api.measurements,'function');
  assert.equal(typeof api.exportMeasurements,'function');
  const result=await api.exportMeasurements({fromMs:Date.now()-60000,toMs:Date.now()+60000,limit:2});
  assert.equal(result.count,3);
  const lines=result.csv.trim().split('\r\n');
  assert.equal(lines.length,4);
  assert.equal(lines[0],'Received At (UTC),Arm,Count,Distance(cm),Alerted Arm,Device,Boot ID,Window Sequence,Window Start(ms since boot),Window End(ms since boot),Window Late(ms),Missed Deadlines');
  assert.match(lines[1],/,L,3,30,None,left-a,101,3,30000,40000,0,0$/);
  assert.match(lines[2],/,R,2,20,None,right-a,202,2,20000,30000,0,0$/);
  assert.match(lines[3],/,L,1,10,L,left-a,101,1,10000,20000,0,0$/);
});

test('an interrupted export never returns a partial CSV as success', async () => {
  let calls=0;
  const api=new ControlApi('https://control.example',async()=> {
    if(++calls===1) return Response.json({records:[{id:10,receivedMs:1000,arm:'L',count:1,distanceCm:2,alertedArm:'None',deviceId:'left',bootId:'1',windowSequence:1,windowStartMs:0,windowEndMs:10000,windowLateMs:0,windowMissedDeadlines:0}],nextBeforeId:10});
    return Response.json({error:'Try again'},{status:503});
  });
  api.signIn('test-only-key');
  assert.equal(typeof api.exportMeasurements,'function');
  await assert.rejects(api.exportMeasurements({fromMs:0,toMs:2000}),/Try again/);
});

test('signing out during an export prevents later pages from crossing sessions', async () => {
  let calls=0;
  const api=new ControlApi('https://control.example',async()=> {
    calls++; return Response.json({records:[{id:10,receivedMs:1000}],nextBeforeId:10});
  });
  api.signIn('test-only-key');
  assert.equal(typeof api.exportMeasurements,'function');
  await assert.rejects(api.exportMeasurements({fromMs:0,toMs:2000},()=> {
    api.signOut(); api.signIn('different-test-key');
  }),/Session changed/);
  assert.equal(calls,1);
});

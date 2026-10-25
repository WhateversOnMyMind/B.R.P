import test from 'node:test';
import assert from 'node:assert/strict';
import {createHarness} from './harness.mjs';

const window = (sequence=1, changes={}) => ({windowReady:true, windowSequence:sequence,
  windowCount:12, windowDistanceCm:345.67, windowAlerted:true,
  windowStartMs:5000+(sequence-1)*10000, windowEndMs:15000+(sequence-1)*10000,
  windowLateMs:0, windowMissedDeadlines:0, ...changes});
const range = () => ({fromMs:Date.now()-3600000,toMs:Date.now()+60000});
const path = (query={}) => '/v1/operator/measurements?'+new URLSearchParams({...range(),...query});

test('each received window is archived once, survives newer status, and distinguishes arms and reboots', async () => {
  const h=await createHarness();
  assert.equal((await h.exchange('L',window())).status,200);
  assert.equal((await h.exchange('L',window(1,{windowCount:99}))).status,200);
  assert.equal((await h.exchange('R',window(1,{windowAlerted:false}))).status,200);
  assert.equal((await h.exchange('L',window(2,{windowCount:0,windowDistanceCm:0,windowAlerted:false}))).status,200);
  assert.equal((await h.exchange('L',window(),{bootId:'303'})).status,200);
  const response=await h.request(path());
  assert.equal(response.status,200);
  const {records,nextBeforeId}=await response.json();
  assert.equal(records.length,4); assert.equal(nextBeforeId,null);
  const first=records.find(r=>r.arm==='L'&&r.bootId==='101'&&r.windowSequence===1);
  assert.equal(first.count,12); assert.equal(first.distanceCm,345.67);
  assert.equal(first.alertedArm,'L'); assert.equal(first.windowStartMs,5000);
  assert.equal(first.windowEndMs,15000); assert.ok(first.receivedMs>Date.now()-60000);
  assert.equal(records.find(r=>r.arm==='R').alertedArm,'None');
  assert.equal(records.find(r=>r.windowSequence===2).count,0);
});

test('stale exchanges and retired boots cannot add history', async () => {
  const h=await createHarness();
  await h.exchange('L',window());
  assert.equal((await h.exchange('L',window(2),{sequence:1})).status,409);
  await h.exchange('L',window(),{bootId:'303'});
  assert.equal((await h.exchange('L',window(3),{bootId:'101'})).status,409);
  const response=await h.request(path()); assert.equal(response.status,200);
  assert.equal((await response.json()).records.length,2);
});

test('history requires an operator, stays within its pair, and works while boards are offline', async () => {
  const h=await createHarness(); await h.exchange('L',window()); await h.exchange('otherL',window());
  h.DB.sqlite.exec('UPDATE devices SET last_seen_ms=0');
  assert.equal((await h.request(path(),{as:'L'})).status,403);
  assert.equal((await h.request(path(),{as:'invalid-token'})).status,401);
  const own=await h.request(path()); assert.equal(own.status,200);
  assert.deepEqual((await own.json()).records.map(r=>r.deviceId),['left-a']);
  const other=await h.request(path(),{as:'other'}); assert.equal(other.status,200);
  assert.deepEqual((await other.json()).records.map(r=>r.deviceId),['left-b']);
});

test('history pages preserve order without duplicates when newer windows arrive during export', async () => {
  const h=await createHarness();
  for(let seq=1;seq<=5;seq++) await h.exchange('L',window(seq));
  const selected=range();
  const first=await h.request(path({...selected,limit:2})); assert.equal(first.status,200);
  const a=await first.json(); assert.deepEqual(a.records.map(r=>r.windowSequence),[5,4]);
  await h.exchange('L',window(6));
  const b=await (await h.request(path({...selected,limit:2,beforeId:a.nextBeforeId}))).json();
  assert.deepEqual(b.records.map(r=>r.windowSequence),[3,2]);
  const c=await (await h.request(path({...selected,limit:2,beforeId:b.nextBeforeId}))).json();
  assert.deepEqual(c.records.map(r=>r.windowSequence),[1]); assert.equal(c.nextBeforeId,null);
});

test('history validates date range and pagination instead of silently truncating or widening a query', async () => {
  const h=await createHarness();
  for(const q of [{fromMs:'bad'},{fromMs:2,toMs:1},{fromMs:0,toMs:32*86400000},
    {limit:0},{limit:1001},{beforeId:-1},{limit:1.5}]) {
    assert.equal((await h.request(path(q))).status,400,JSON.stringify(q));
  }
  assert.equal((await h.request('/v1/operator/measurements')).status,400);
  await h.exchange('L',window());
  const outside=await h.request(path({fromMs:0,toMs:1000})); assert.equal(outside.status,200);
  assert.deepEqual((await outside.json()).records,[]);
});

test('invalid measurement data cannot enter the archive; legacy status without measurements still works', async () => {
  const h=await createHarness();
  assert.equal((await h.exchange('L')).status,200);
  assert.equal((await h.exchange('L',{windowReady:false,windowSequence:0})).status,200);
  for(const changed of [{windowSequence:0},{windowCount:-1},{windowCount:1.5},
    {windowDistanceCm:-1},{windowDistanceCm:'4'},{windowAlerted:'true'},
    {windowStartMs:-1},{windowEndMs:4294967296},{windowLateMs:-1}]) {
    assert.equal((await h.exchange('L',window(1,changed))).status,400,JSON.stringify(changed));
  }
  const legacy=window(); delete legacy.windowAlerted;
  assert.equal((await h.exchange('L',legacy)).status,200);
  const response=await h.request(path()); assert.equal(response.status,200);
  const records=(await response.json()).records;
  assert.equal(records.length,1); assert.equal(records[0].alertedArm,'Unknown');
});

test('a wrapped board clock is stored as reported rather than treated as wall-clock time', async () => {
  const h=await createHarness();
  assert.equal((await h.exchange('R',window(1,{windowStartMs:4294965000,windowEndMs:7704}))).status,200);
  const response=await h.request(path()); assert.equal(response.status,200);
  const row=(await response.json()).records[0];
  assert.equal(row.windowStartMs,4294965000); assert.equal(row.windowEndMs,7704);
});

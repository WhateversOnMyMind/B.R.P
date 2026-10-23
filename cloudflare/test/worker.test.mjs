import test from 'node:test';
import assert from 'node:assert/strict';
import {createHarness,hash} from './harness.mjs';
import worker from '../src/worker.mjs';

test('authentication, revocation, role and CORS cannot cross pair scope',async()=>{
 const h=await createHarness();
 assert.equal((await h.request('/v1/operator/state',{as:'bad'})).status,401);
 assert.equal((await h.request('/v1/operator/state',{as:'L'})).status,403);
 assert.equal((await h.request('/v1/device/exchange',{method:'POST',body:{}})).status,403);
 assert.equal((await h.request('/v1/operator/state',{headers:{Origin:'https://evil.example'}})).status,403);
 const response=await h.request('/v1/operator/state',{headers:{Origin:'https://blindrunning.com'}});
 assert.equal(response.headers.get('Access-Control-Allow-Origin'),'https://blindrunning.com');
 assert.equal(response.headers.get('Cache-Control'),'no-store');
 assert.equal((await response.json()).pairId,'pair-a');
 assert.equal((await (await h.request('/v1/operator/state',{as:'other'})).json()).pairId,'pair-b');
 await h.DB.prepare('UPDATE credentials SET revoked=1 WHERE token_hash=?').bind(hash(h.keys.operator)).run();
 assert.equal((await h.request('/v1/operator/state')).status,401);
});

test('command admission requires online devices and atomically compares revision and inserts one command',async()=>{
 const h=await createHarness(); assert.equal((await h.command()).status,503); await h.online();
 const responses=await Promise.all([h.command(),h.command()]);
 assert.deepEqual(responses.map(r=>r.status).sort(),[201,409]);
 const state=await h.state(); assert.equal(state.revision,1); assert.equal(state.commands.length,1); assert.equal(state.commands[0].state,'pending');
 assert.equal((await h.command({},0)).status,400);
 assert.equal((await h.command({action:'set_sensitivity',target:'pair',value:0.31},1)).status,400);
 assert.equal((await h.command({action:'set_motor_enabled',target:'R',value:false},1)).status,400);
});

test('shared execution goes only left; left acknowledgment alone is partial; right revision confirms',async()=>{
 const h=await createHarness(); await h.online(); const cmd=await (await h.command()).json();
 assert.equal((await (await h.exchange('R')).json()).commands.length,0);
 const delivery=(await (await h.exchange()).json()).commands[0]; assert.equal(delivery.id,cmd.id); assert.equal(delivery.bootId,'101'); assert.ok(delivery.ttlMs>0&&delivery.ttlMs<=15000);
 assert.equal((await h.exchange('L',{settingsRevision:1,motorEnabled:false},{ack:{...cmd,result:'applied'}})).status,200);
 let state=await h.state(); assert.equal(state.commands[0].state,'pending'); assert.equal(state.commands[0].results.L.result,'applied');
 await h.exchange('R',{settingsRevision:1,motorEnabled:false}); state=await h.state(); assert.equal(state.commands[0].state,'applied'); assert.equal(state.commands[0].results.R.result,'applied');
 assert.equal((await h.exchange('L',{settingsRevision:1,motorEnabled:false},{ack:{...cmd,result:'applied'}})).status,200);
 assert.equal((await h.exchange('L',{}, {ack:{...cmd,result:'failed'}})).status,409);
});

test('stale sequence and retired boot cannot refresh or replace latest status',async()=>{
 const h=await createHarness(); await h.online(); const before=(await h.state()).devices.find(d=>d.arm==='L');
 assert.equal((await h.exchange('L',{tempC:99},{sequence:1})).status,409);
 assert.deepEqual((await h.state()).devices.find(d=>d.arm==='L'),before);
 await h.exchange('L',{tempC:30},{bootId:'303',sequence:1});
 assert.equal((await h.exchange('L',{tempC:99},{bootId:'101',sequence:100})).status,409);
 assert.equal((await h.state()).devices.find(d=>d.arm==='L').bootId,'303');
});

test('boot changes invalidate pending pair commands and wrong scope acknowledgments fail',async()=>{
 const h=await createHarness(); await h.online(); const cmd=await (await h.command()).json();
 assert.equal((await h.exchange('R',{}, {ack:{...cmd,result:'applied'}})).status,409);
 assert.equal((await h.exchange('L',{}, {ack:{...cmd,id:crypto.randomUUID(),result:'applied'}})).status,409);
 await h.exchange('R',{}, {bootId:'999',sequence:1});
 assert.equal((await h.state()).commands[0].state,'unknown');
 assert.equal((await h.exchange('L',{}, {ack:{...cmd,result:'applied'}})).status,409);
 assert.equal((await (await h.exchange()).json()).commands.length,0);
});

test('expired commands cannot execute or acknowledge and allow the next revision',async()=>{
 const h=await createHarness(); await h.online(); const cmd=await (await h.command()).json();
 await h.DB.prepare('UPDATE commands SET expires_ms=? WHERE id=?').bind(Date.now()-1,cmd.id).run();
 assert.equal((await h.exchange('L',{}, {ack:{...cmd,result:'applied'}})).status,409);
 assert.equal((await h.state()).commands[0].state,'expired');
 assert.equal((await h.command({action:'recalibrate',target:'L'},1)).status,201);
});

test('captures require issued target ownership, finalization, bounded length and checksum before private download',async()=>{
 const h=await createHarness(); await h.online(); const cmd=await (await h.command({action:'raw_start',target:'L'})).json();
 const data='time,value\n0,42\n'; const bytes=Buffer.byteLength(data); const sha256=hash(data);
 const upload=(as='L',text=data,headers={})=>h.request(`/v1/device/captures/${cmd.id}`,{as,method:'PUT',body:text,headers:{'Content-Length':String(Buffer.byteLength(text)),'X-Content-SHA256':sha256,...headers}});
 assert.equal((await upload()).status,409);
 await h.exchange('L',{captureId:cmd.id,rawLogging:true,rawLogBytes:bytes},{ack:{...cmd,result:'applied'}});
 assert.equal((await upload()).status,409);
 await h.exchange('L',{captureId:cmd.id,rawLogging:false,rawLogBytes:bytes});
 assert.equal((await upload('R')).status,403);
 assert.equal((await upload('L',data,{'X-Content-SHA256':'0'.repeat(64)})).status,400);
 assert.equal((await upload('L',data,{'Content-Length':'2000161'})).status,413);
 assert.equal((await upload('L',data,{'Content-Length':String(bytes-1)})).status,400);
 assert.equal((await h.state()).captures.length,0);
 const uploaded=await upload(); assert.equal(uploaded.status,200); assert.deepEqual(await uploaded.json(),{captureId:cmd.id,bytes,sha256});
 assert.equal((await upload()).status,200);
 assert.equal((await upload('L',data.replace('42','43'),{'X-Content-SHA256':hash(data.replace('42','43'))})).status,409);
 assert.equal((await h.request(`/v1/operator/captures/left-a/${cmd.id}`,{as:'other'})).status,404);
 const downloaded=await h.request(`/v1/operator/captures/left-a/${cmd.id}`); assert.equal(downloaded.status,200); assert.equal(await downloaded.text(),data);
});

test('raw start cannot overwrite a capture and stop/clear require its exact identity',async()=>{
 const h=await createHarness(); await h.online();
 await h.exchange('L',{captureId:'existing-capture',rawLogBytes:20});
 assert.equal((await h.command({action:'raw_start',target:'L'})).status,409);
 assert.equal((await h.command({action:'raw_stop',target:'L',captureId:'wrong-capture'})).status,409);
 assert.equal((await h.command({action:'raw_clear',target:'L',captureId:'existing-capture'})).status,201);
});

test('concurrent conflicting acknowledgments cannot both report acceptance',async()=>{
 const h=await createHarness(); await h.online(); const cmd=await (await h.command({action:'recalibrate',target:'L'})).json();
 const batch=h.DB.batch.bind(h.DB); let arrivals=0; let release; const ready=new Promise(resolve=>{release=resolve;});
 h.DB.batch=async statements=>{ if(++arrivals===2) release(); if(arrivals<=2) await ready; return batch(statements); };
 const responses=await Promise.all([h.exchange('L',{}, {ack:{...cmd,result:'applied'}}),h.exchange('L',{}, {ack:{...cmd,result:'failed'}})]);
 assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);
 assert.equal((await h.state()).commands[0].state,'applied');
});

test('failed command result is terminal, not applied, and duplicate acknowledgment is harmless',async()=>{
 const h=await createHarness(); await h.online(); const cmd=await (await h.command()).json();
 await h.exchange('L',{}, {ack:{...cmd,result:'failed',message:'local rejection'}});
 const c=(await h.state()).commands[0]; assert.equal(c.state,'failed'); assert.deepEqual(c.results.L,{result:'failed',message:'local rejection'});
 assert.equal((await h.exchange('L',{}, {ack:{...cmd,result:'failed'}})).status,200);
 assert.equal((await h.command({action:'set_sensitivity',target:'pair',value:0.3},1)).status,201);
});

test('a right revision with mismatched setting does not produce paired success',async()=>{
 const h=await createHarness(); await h.online(); const cmd=await (await h.command()).json();
 await h.exchange('L',{motorEnabled:false,settingsRevision:1},{ack:{...cmd,result:'applied'}});
 await h.exchange('R',{settingsRevision:1,motorEnabled:true});
 assert.equal((await h.state()).commands[0].state,'pending');
});

test('float32 sensitivity at the legal upper boundary acknowledges both arms and normalizes fresh status',async()=>{
 const h=await createHarness(); await h.online();
 const response=await h.command({action:'set_sensitivity',target:'pair',value:0.3}); assert.equal(response.status,201);
 const cmd=await response.json();
 const delivered=(await (await h.exchange('L')).json()).commands[0]; assert.equal(delivered.value,0.3);
 const before=Date.now();
 assert.equal((await h.exchange('L',{feedbackDeadZone:Math.fround(delivered.value),settingsRevision:cmd.revision},{ack:{...cmd,result:'applied'}})).status,200);
 assert.equal((await h.exchange('R',{feedbackDeadZone:Math.fround(delivered.value),settingsRevision:cmd.revision})).status,200);
 const state=await h.state(); assert.equal(state.commands[0].state,'applied');
 for(const arm of ['L','R']) {
   assert.equal(state.commands[0].results[arm].result,'applied');
   const device=state.devices.find(d=>d.arm===arm); assert.equal(device.status.feedbackDeadZone,0.3); assert.ok(device.lastSeenMs>=before);
 }
 assert.equal((await h.command({action:'set_sensitivity',target:'pair',value:Math.fround(0.3)},cmd.revision)).status,400);
});

test('device sensitivity above the float32 boundary is rejected without refreshing stored status',async()=>{
 const h=await createHarness(); await h.online(); const before=(await h.state()).devices.find(d=>d.arm==='L');
 for(const value of [Math.fround(0.3)+Number.EPSILON,0.300001,0.31,-Number.EPSILON]) assert.equal((await h.exchange('L',{feedbackDeadZone:value})).status,400);
 assert.deepEqual((await h.state()).devices.find(d=>d.arm==='L'),before);
});

test('a capture cleared while R2 upload is pending never becomes downloadable',async()=>{
 const h=await createHarness(); await h.online(); const cmd=await (await h.command({action:'raw_start',target:'L'})).json();
 await h.exchange('L',{captureId:cmd.id,rawLogBytes:3},{ack:{...cmd,result:'applied'}});
 const put=h.CAPTURES.put.bind(h.CAPTURES);
 h.CAPTURES.put=async(...args)=>{ const result=await put(...args); await h.exchange('L'); return result; };
 const response=await h.request(`/v1/device/captures/${cmd.id}`,{as:'L',method:'PUT',body:'abc',headers:{'Content-Length':'3','X-Content-SHA256':hash('abc')}});
 assert.equal(response.status,409); assert.equal((await h.state()).captures.length,0);
 assert.equal((await h.request(`/v1/operator/captures/left-a/${cmd.id}`)).status,404);
});

test('untrusted status, oversized JSON and foreign capture IDs are rejected',async()=>{
 const h=await createHarness(); await h.online();
 assert.equal((await h.exchange('L',{arm:'R'})).status,400);
 assert.equal((await h.exchange('L',{}, {bootId:'4294967296'})).status,400);
 assert.equal((await h.exchange('L',{}, {bootId:'001'})).status,400);
 assert.equal((await h.exchange('L',{settingsRevision:-1})).status,400);
 assert.equal((await h.exchange('L',{diagnostic:'x'.repeat(17000)})).status,413);
 assert.equal((await h.request(`/v1/device/captures/${crypto.randomUUID()}`,{as:'L',method:'PUT',body:'abc',headers:{'Content-Length':'3','X-Content-SHA256':hash('abc')}})).status,403);
});

test('an acknowledgment body delayed beyond expiry cannot become applied',async()=>{
 const h=await createHarness(); await h.online(); const cmd=await (await h.command({action:'recalibrate',target:'L'})).json();
 await h.DB.prepare('UPDATE commands SET expires_ms=? WHERE id=?').bind(Date.now()+25,cmd.id).run();
 const status=(await h.state()).devices.find(d=>d.arm==='L').status;
 const stream=new ReadableStream({start(controller){setTimeout(()=>{controller.enqueue(new TextEncoder().encode(JSON.stringify({bootId:'101',sequence:2,status,ack:{...cmd,result:'applied'}})));controller.close();},75);}});
 const request=new Request('https://control.example/v1/device/exchange',{method:'POST',headers:{Authorization:`Bearer ${h.keys.L}`},body:stream,duplex:'half'});
 assert.equal((await worker.fetch(request,h.env)).status,409);
 assert.equal((await h.state()).commands[0].state,'expired');
});

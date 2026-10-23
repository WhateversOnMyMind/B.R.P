// Authenticated synthetic-device smoke test. Never use a physical pair's keys.
// Usage: node tools/smoke.mjs HTTPS_API_BASE provisioning/FOLDER/secrets.json
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash,randomInt} from 'node:crypto';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';

const sha256=value=>createHash('sha256').update(value).digest('hex');
class SmokeFailure extends Error {}
const check=(condition,message)=>{if(!condition) throw new SmokeFailure(message);};

export async function runSmoke(base,secrets,fetchImpl=fetch) {
  check(new URL(base).protocol==='https:','Smoke API must use HTTPS');
  check(secrets.pairId.startsWith('deployment-smoke-'),'Only dedicated deployment-smoke pairs are permitted');
  check(secrets.keys?.operator&&secrets.keys?.L&&secrets.keys?.R,'Pair credential file required');
  const checks=[]; const boots={L:String(randomInt(1,0xffffffff)),R:String(randomInt(1,0xffffffff))};
  const sequences={L:0,R:0};
  const statuses=Object.fromEntries(['L','R'].map(arm=>[arm,{arm,motorEnabled:true,feedbackDeadZone:0.055,settingsRevision:0,peerFresh:true,tempC:25,rawLogging:false,rawLogBytes:0,captureId:'',captureUploaded:false,recalibrating:false,commandedPwm:0,feedbackEligible:true,synthetic:true}]));
  async function request(path,{as='operator',method='GET',body,headers={},expected=200}={}) {
    const response=await fetchImpl(base.replace(/\/$/,'')+path,{method,headers:{...(as?{Authorization:`Bearer ${secrets.keys[as]}`} : {}),...(body===undefined?{}:{'Content-Type':typeof body==='string'?'text/csv':'application/json'}),...headers},body:body===undefined?undefined:typeof body==='string'?body:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
    check(response.status===expected,`${method} ${path}: expected ${expected}, received ${response.status}`);
    check(response.headers.get('Cache-Control')==='no-store',`${path}: missing no-store`);
    return response;
  }
  const state=async()=> (await request('/v1/operator/state')).json();
  async function exchange(arm,changes={},ack=null) {
    Object.assign(statuses[arm],changes);
    return (await request('/v1/device/exchange',{as:arm,method:'POST',body:{bootId:boots[arm],sequence:++sequences[arm],status:statuses[arm],ack}})).json();
  }
  async function command(action,target,fields={}) {
    // Refresh both synthetic boards before each control admission.
    await exchange('L'); await exchange('R');
    const current=await state();
    return (await request('/v1/operator/commands',{method:'POST',body:{expectedRevision:current.revision,action,target,...fields},expected:201})).json();
  }
  await request('/v1/operator/state',{as:null,expected:401});
  await request('/v1/operator/state',{as:'L',expected:403});
  await request('/v1/device/exchange',{method:'POST',body:{},expected:403});
  check((await state()).pairId===secrets.pairId,'Operator pair scope mismatch');
  checks.push('unauthenticated rejection and operator/device role scope');
  const allowed=await request('/v1/operator/state',{headers:{Origin:'https://blindrunning.com'}});
  check(allowed.headers.get('Access-Control-Allow-Origin')==='https://blindrunning.com','Permitted CORS origin missing');
  const denied=await request('/v1/operator/state',{headers:{Origin:'https://untrusted.example'},expected:403});
  check(!denied.headers.has('Access-Control-Allow-Origin'),'Denied CORS origin was exposed');
  await request('/v1/operator/commands',{as:null,method:'OPTIONS',headers:{Origin:'https://blindrunning.com','Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'authorization,content-type'},expected:204});
  checks.push('exact CORS allow/deny and unauthenticated preflight');

  for(const [action,value,field] of [['set_motor_enabled',false,'motorEnabled'],['set_sensitivity',0.3,'feedbackDeadZone']]) {
    const cmd=await command(action,'pair',{value});
    const delivered=await exchange('L'); check(delivered.commands[0]?.id===cmd.id,'Shared command missing from left delivery');
    check((await exchange('R')).commands.length===0,'Shared command wrongly delivered to right');
    const valueOnDevice=action==='set_sensitivity'?Math.fround(value):value;
    await exchange('L',{[field]:valueOnDevice,settingsRevision:cmd.revision},{...cmd,result:'applied',message:'Synthetic smoke execution'});
    let current=await state(); check(current.commands.find(c=>c.id===cmd.id)?.state==='pending','Left-only acknowledgment falsely applied pair');
    await exchange('R',{[field]:valueOnDevice,settingsRevision:cmd.revision});
    current=await state(); check(current.commands.find(c=>c.id===cmd.id)?.state==='applied','Paired setting did not apply');
    if(action==='set_sensitivity') check(current.devices.every(d=>d.status.feedbackDeadZone===0.3),'Float32 boundary was not normalized');
    checks.push(`${action}: left delivery, partial result, right confirmation`);
  }

  const csv='time_ms,value\n0,42\n20,43\n'; const bytes=Buffer.byteLength(csv); const checksum=sha256(csv);
  const start=await command('raw_start','L');
  const startDelivery=(await exchange('L')).commands[0]; check(startDelivery?.captureId===start.id,'Capture identity not assigned by backend');
  await exchange('L',{captureId:start.id,rawLogging:true,rawLogBytes:bytes},{...start,result:'applied'});
  const stop=await command('raw_stop','L',{captureId:start.id});
  check((await exchange('L')).commands[0]?.captureId===start.id,'Stop command capture identity mismatch');
  await exchange('L',{rawLogging:false},{...stop,result:'applied'});
  const upload=await request(`/v1/device/captures/${start.id}`,{as:'L',method:'PUT',body:csv,headers:{'Content-Length':String(bytes),'X-Content-SHA256':checksum}});
  const uploaded=await upload.json(); check(uploaded.captureId===start.id&&uploaded.bytes===bytes&&uploaded.sha256===checksum,'Upload metadata mismatch');
  await exchange('L',{captureUploaded:true});
  const download=await request(`/v1/operator/captures/${secrets.leftDeviceId}/${start.id}`);
  check(sha256(await download.text())===checksum,'Downloaded checksum mismatch');
  check(download.headers.get('X-Content-SHA256')===checksum,'Download checksum header mismatch');
  await request(`/v1/operator/captures/${secrets.leftDeviceId}/${start.id}`,{as:'R',expected:403});
  await request(`/v1/operator/captures/not-this-pair/${start.id}`,{expected:404});
  checks.push('raw start/stop, private R2 upload/download, exact bytes and SHA-256, scope rejection');

  const pending=await command('recalibrate','R');
  boots.R=String((Number(boots.R)+1)>>>0); sequences.R=0;
  await exchange('R',{settingsRevision:0});
  const final=await state();
  check(final.commands.find(c=>c.id===pending.id)?.state==='unknown','Reboot did not invalidate pending command');
  checks.push('right reboot invalidates pending command without false success');
  return {apiBase:base,pairId:secrets.pairId,leftDeviceId:secrets.leftDeviceId,rightDeviceId:secrets.rightDeviceId,revision:final.revision,commandCount:final.commands.length,captureCount:final.captures.length,captureId:start.id,captureBytes:bytes,captureSha256:checksum,checks,completedAt:new Date().toISOString()};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {
    const [base,secretPath]=process.argv.slice(2);
    const secrets=JSON.parse(readFileSync(secretPath,'utf8'));
    const report=await runSmoke(base,secrets);
    const reportPath=join(dirname(resolve(secretPath)),'smoke-report.json');
    writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n',{mode:0o600});
    process.stdout.write(JSON.stringify({...report,reportPath},null,2)+'\n');
  } catch(error) {
    // JSON parser and transport errors can contain source fragments; never echo them.
    const message=error instanceof SmokeFailure?error.message:'Credential file, API configuration, or network request could not be processed';
    process.stderr.write(`Synthetic smoke failed: ${message}\n`); process.exitCode=1;
  }
}

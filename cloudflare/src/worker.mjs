const STALE_MS = 10_000;
const TTL_MS = 15_000;
const MAX_CAPTURE = 2_000_160;
const SQL_NOW = "CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)";
const ID = /^[A-Za-z0-9_-]{1,100}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const shared = action => action === 'set_motor_enabled' || action === 'set_sensitivity';
class HttpError extends Error { constructor(status, message) { super(message); this.status=status; } }
const fail = (status, message) => { throw new HttpError(status,message); };
const stmt = (db, sql, ...args) => db.prepare(sql).bind(...args);
const rows = async (db, sql, ...args) => (await stmt(db,sql,...args).all()).results;
const one = (db, sql, ...args) => stmt(db,sql,...args).first();
const expire = (db,pair,now) => stmt(db,`UPDATE commands SET state='expired' WHERE pair_id=? AND state='pending' AND expires_ms<=max(?,${SQL_NOW})`,pair,now);
const hex = buffer => [...new Uint8Array(buffer)].map(v=>v.toString(16).padStart(2,'0')).join('');
async function digest(bytes) { return hex(await crypto.subtle.digest('SHA-256',bytes)); }

async function boundedBody(request, limit) {
  const reader=request.body?.getReader();
  if(!reader) return new Uint8Array();
  const chunks=[]; let size=0;
  try {
    while(true) { const {value,done}=await reader.read(); if(done) break; size+=value.byteLength; if(size>limit) { await reader.cancel(); fail(413,'Request too large'); } chunks.push(value); }
  } finally { reader.releaseLock(); }
  const bytes=new Uint8Array(size); let offset=0;
  for(const chunk of chunks) { bytes.set(chunk,offset); offset+=chunk.byteLength; }
  return bytes;
}
async function jsonBody(request) {
  let value;
  try { value=JSON.parse(new TextDecoder().decode(await boundedBody(request,16384))); }
  catch(error) { if(error instanceof HttpError) throw error; fail(400,'Invalid JSON'); }
  if(!value || typeof value!=='object' || Array.isArray(value)) fail(400,'Expected JSON object');
  return value;
}
async function identity(request,env) {
  const token=/^Bearer ([A-Za-z0-9_-]{10,256})$/.exec(request.headers.get('Authorization')??'')?.[1];
  if(!token) fail(401,'Invalid credentials');
  const auth=await one(env.DB,'SELECT c.*,d.arm FROM credentials c LEFT JOIN devices d ON d.id=c.device_id AND d.pair_id=c.pair_id WHERE c.token_hash=? AND c.revoked=0',await digest(new TextEncoder().encode(token)));
  if(!auth || (auth.role==='device'&&!auth.arm)) fail(401,'Invalid credentials');
  return auth;
}
function validateStatus(body,auth) {
  const s=body.status;
  if(typeof body.bootId!=='string'||!/^\d{1,10}$/.test(body.bootId)||Number(body.bootId)>4294967295||String(Number(body.bootId))!==body.bootId) fail(400,'Invalid bootId');
  if(!Number.isSafeInteger(body.sequence)||body.sequence<1) fail(400,'Invalid sequence');
  if(!s||typeof s!=='object'||Array.isArray(s)||s.arm!==auth.arm) fail(400,'Invalid arm');
  for(const key of ['motorEnabled','peerFresh','rawLogging','captureUploaded','recalibrating']) if(typeof s[key]!=='boolean') fail(400,`Invalid ${key}`);
  // ESP32 float32 encodes the legal 0.3 setting slightly above its decimal value.
  // Accept only that representable upper boundary; operator inputs remain strict.
  if(!Number.isFinite(s.feedbackDeadZone)||s.feedbackDeadZone<0||s.feedbackDeadZone>Math.fround(0.3)) fail(400,'Invalid sensitivity');
  if(s.feedbackDeadZone>0.3) s.feedbackDeadZone=0.3;
  if(!Number.isSafeInteger(s.settingsRevision)||s.settingsRevision<0) fail(400,'Invalid settingsRevision');
  if(!Number.isSafeInteger(s.rawLogBytes)||s.rawLogBytes<0||s.rawLogBytes>MAX_CAPTURE) fail(400,'Invalid rawLogBytes');
  if(typeof s.captureId!=='string'||(s.captureId!==''&&!ID.test(s.captureId))) fail(400,'Invalid captureId');
  if(s.rawLogging&&!s.captureId) fail(400,'Recording requires captureId');
}
function bootFor(command,arm) { return arm==='L'?command.left_boot:command.right_boot; }

async function exchange(request,env,auth,now) {
  const body=await jsonBody(request); validateStatus(body,auth);
  now=Date.now();
  const ack=body.ack;
  if(ack!==null&&ack!==undefined) {
    if(!ack||!UUID.test(ack.id??'')||!Number.isSafeInteger(ack.revision)||!['applied','failed'].includes(ack.result)|| (ack.message!==undefined&&(typeof ack.message!=='string'||ack.message.length>256))) fail(400,'Invalid acknowledgment');
    const command=await one(env.DB,'SELECT * FROM commands WHERE id=? AND pair_id=?',ack.id,auth.pair_id);
    if(!command||command.revision!==ack.revision||bootFor(command,auth.arm)!==body.bootId||(command.target!==auth.arm&&!(command.target==='pair'&&auth.arm==='L'))) fail(409,'Acknowledgment does not match device, boot or command');
    const result=await one(env.DB,'SELECT result FROM command_results WHERE command_id=? AND arm=?',ack.id,auth.arm);
    if(result) { if(result.result!==ack.result) fail(409,'Conflicting acknowledgment'); }
    else if(command.state!=='pending'||command.expires_ms<=now) fail(409,'Command is no longer pending');
  }
  const exchangeId=crypto.randomUUID();
  const accepted='EXISTS (SELECT 1 FROM devices WHERE id=? AND exchange_id=?)';
  const statements=[
    stmt(env.DB,`UPDATE devices SET boot_id=?,sequence=?,status_json=?,last_seen_ms=?,exchange_id=? WHERE id=? AND ((boot_id=? AND sequence<?) OR ((boot_id IS NULL OR boot_id<>?) AND NOT EXISTS (SELECT 1 FROM device_boots WHERE device_id=? AND boot_id=?)))`,body.bootId,body.sequence,JSON.stringify(body.status),now,exchangeId,auth.device_id,body.bootId,body.sequence,body.bootId,auth.device_id,body.bootId),
    stmt(env.DB,`INSERT OR IGNORE INTO device_boots(device_id,boot_id) SELECT id,boot_id FROM devices WHERE id=? AND exchange_id=?`,auth.device_id,exchangeId),
    expire(env.DB,auth.pair_id,now),
    stmt(env.DB,`UPDATE commands SET state='unknown' WHERE pair_id=? AND state='pending' AND ${accepted} AND ((left_boot IS NOT NULL AND left_boot<>(SELECT boot_id FROM devices WHERE pair_id=? AND arm='L')) OR (right_boot IS NOT NULL AND right_boot<>(SELECT boot_id FROM devices WHERE pair_id=? AND arm='R')))`,auth.pair_id,auth.device_id,exchangeId,auth.pair_id,auth.pair_id)
  ];
  if(ack) statements.push(stmt(env.DB,`INSERT OR IGNORE INTO command_results(command_id,arm,result,message,received_ms) SELECT id,?,?,?,? FROM commands WHERE id=? AND pair_id=? AND revision=? AND state='pending' AND expires_ms>? AND ${accepted} AND (CASE WHEN ?='L' THEN left_boot ELSE right_boot END)=?`,auth.arm,ack.result,ack.message??'',now,ack.id,auth.pair_id,ack.revision,now,auth.device_id,exchangeId,auth.arm,body.bootId));
  if(auth.arm==='R') statements.push(stmt(env.DB,`INSERT OR IGNORE INTO command_results(command_id,arm,result,message,received_ms) SELECT id,'R','applied','Confirmed in device status',? FROM commands WHERE pair_id=? AND target='pair' AND state='pending' AND revision=? AND right_boot=? AND expires_ms>? AND ${accepted} AND ((action='set_motor_enabled' AND json_extract(value_json,'$')=?) OR (action='set_sensitivity' AND abs(json_extract(value_json,'$')-?)<0.000001))`,now,auth.pair_id,body.status.settingsRevision,body.bootId,now,auth.device_id,exchangeId,body.status.motorEnabled?1:0,body.status.feedbackDeadZone));
  statements.push(stmt(env.DB,`UPDATE commands SET state=CASE WHEN EXISTS (SELECT 1 FROM command_results r WHERE r.command_id=commands.id AND r.result='failed') THEN 'failed' ELSE 'applied' END WHERE pair_id=? AND state='pending' AND (EXISTS (SELECT 1 FROM command_results r WHERE r.command_id=commands.id AND r.result='failed') OR (SELECT count(*) FROM command_results r WHERE r.command_id=commands.id AND r.result='applied')=CASE WHEN target='pair' THEN 2 ELSE 1 END)`,auth.pair_id));
  statements.push(stmt(env.DB,`SELECT * FROM commands WHERE pair_id=? AND state='pending' AND expires_ms>? AND (target=? OR (target='pair' AND ?='L')) AND (CASE WHEN ?='L' THEN left_boot ELSE right_boot END)=? AND NOT EXISTS (SELECT 1 FROM command_results r WHERE r.command_id=commands.id AND r.arm=?) AND ${accepted} LIMIT 1`,auth.pair_id,now,auth.arm,auth.arm,auth.arm,body.bootId,auth.arm,auth.device_id,exchangeId));
  const deliveryIndex=statements.length-1;
  if(ack) statements.push(stmt(env.DB,'SELECT result FROM command_results WHERE command_id=? AND arm=?',ack.id,auth.arm));
  const result=await env.DB.batch(statements);
  if(result[0].meta.changes!==1) fail(409,'Stale sequence or retired boot');
  if(ack&&result.at(-1).results[0]?.result!==ack.result) fail(409,'Acknowledgment raced a command state change');
  const serverTimeMs=Date.now();
  return Response.json({serverTimeMs,commands:result[deliveryIndex].results.filter(c=>c.expires_ms>serverTimeMs).map(c=>({id:c.id,revision:c.revision,action:c.action,target:c.target,bootId:body.bootId,ttlMs:c.expires_ms-serverTimeMs,...(c.value_json!==null?{value:JSON.parse(c.value_json)}:{}),...(c.capture_id?{captureId:c.capture_id}:{})}))});
}

function validateCommand(body) {
  if(!Number.isSafeInteger(body.expectedRevision)||body.expectedRevision<0) fail(400,'Invalid expectedRevision');
  if(shared(body.action)) {
    if(body.target!=='pair') fail(400,'Shared settings require pair target');
    if(body.action==='set_motor_enabled'&&typeof body.value!=='boolean') fail(400,'Motor value must be boolean');
    if(body.action==='set_sensitivity'&&(!Number.isFinite(body.value)||body.value<0||body.value>0.3)) fail(400,'Sensitivity must be 0 to 0.3');
  } else {
    if(!['raw_start','raw_stop','raw_clear','recalibrate'].includes(body.action)||!['L','R'].includes(body.target)) fail(400,'Invalid action or target');
    if(['raw_stop','raw_clear'].includes(body.action)&&!ID.test(body.captureId??'')) fail(400,'Exact captureId required');
    if(body.value!==undefined) fail(400,'Unexpected value');
  }
}
async function submit(request,env,auth,now) {
  const body=await jsonBody(request); validateCommand(body);
  now=Date.now();
  const id=crypto.randomUUID(); const revision=body.expectedRevision+1;
  const arms=body.target==='pair'?['L','R']:[body.target];
  const fresh=`(SELECT count(*) FROM devices WHERE pair_id=p.id AND arm IN (${arms.map(()=>'?').join(',')}) AND boot_id IS NOT NULL AND last_seen_ms>?)=${arms.length}`;
  let guard='1=1'; const guardArgs=[];
  if(body.action==='raw_start') guard="EXISTS (SELECT 1 FROM devices WHERE pair_id=p.id AND arm=? AND json_extract(status_json,'$.captureId')='' AND json_extract(status_json,'$.rawLogging')=0)",guardArgs.push(body.target);
  if(['raw_stop','raw_clear'].includes(body.action)) { guard=`EXISTS (SELECT 1 FROM devices WHERE pair_id=p.id AND arm=? AND json_extract(status_json,'$.captureId')=?${body.action==='raw_clear'?" AND json_extract(status_json,'$.rawLogging')=0":''})`; guardArgs.push(body.target,body.captureId); }
  const result=await env.DB.batch([
    expire(env.DB,auth.pair_id,now),
    stmt(env.DB,`INSERT INTO commands(id,pair_id,revision,action,target,value_json,capture_id,left_boot,right_boot,created_ms,expires_ms)
      SELECT ?,p.id,?,?,?,?,?,CASE WHEN ? IN ('pair','L') THEN (SELECT boot_id FROM devices WHERE pair_id=p.id AND arm='L') END,CASE WHEN ? IN ('pair','R') THEN (SELECT boot_id FROM devices WHERE pair_id=p.id AND arm='R') END,?,?
      FROM pairs p WHERE p.id=? AND p.revision=? AND NOT EXISTS (SELECT 1 FROM commands WHERE pair_id=p.id AND state='pending') AND ${fresh} AND ${guard}`,
      id,revision,body.action,body.target,shared(body.action)?JSON.stringify(body.value):null,body.action==='raw_start'?id:body.captureId??null,body.target,body.target,now,now+TTL_MS,auth.pair_id,body.expectedRevision,...arms,now-STALE_MS,...guardArgs),
    stmt(env.DB,'UPDATE pairs SET revision=? WHERE id=? AND revision=? AND EXISTS (SELECT 1 FROM commands WHERE id=?)',revision,auth.pair_id,body.expectedRevision,id)
  ]);
  if(result[1].meta.changes!==1) {
    const pair=await one(env.DB,'SELECT revision FROM pairs WHERE id=?',auth.pair_id);
    if(pair.revision!==body.expectedRevision) fail(409,'Stale revision');
    const devices=await rows(env.DB,'SELECT arm,last_seen_ms FROM devices WHERE pair_id=?',auth.pair_id);
    if(arms.some(arm=>!devices.some(d=>d.arm===arm&&d.last_seen_ms>now-STALE_MS))) fail(503,'Required device offline');
    fail(409,'Pair busy or capture state changed');
  }
  return Response.json({id,revision},{status:201});
}

async function state(env,auth,now) {
  const result=await env.DB.batch([
    expire(env.DB,auth.pair_id,now),
    stmt(env.DB,'SELECT revision FROM pairs WHERE id=?',auth.pair_id),
    stmt(env.DB,'SELECT * FROM devices WHERE pair_id=? ORDER BY arm',auth.pair_id),
    stmt(env.DB,'SELECT * FROM commands WHERE pair_id=? ORDER BY revision DESC LIMIT 50',auth.pair_id),
    stmt(env.DB,'SELECT r.* FROM command_results r JOIN commands c ON c.id=r.command_id WHERE c.id IN (SELECT id FROM commands WHERE pair_id=? ORDER BY revision DESC LIMIT 50)',auth.pair_id),
    stmt(env.DB,'SELECT * FROM captures WHERE pair_id=? ORDER BY created_ms DESC LIMIT 50',auth.pair_id)
  ]);
  return Response.json({pairId:auth.pair_id,revision:result[1].results[0].revision,serverTimeMs:now,
    devices:result[2].results.map(d=>({id:d.id,arm:d.arm,bootId:d.boot_id,lastSeenMs:d.last_seen_ms,status:JSON.parse(d.status_json)})),
    commands:result[3].results.map(c=>({id:c.id,revision:c.revision,action:c.action,target:c.target,...(c.value_json!==null?{value:JSON.parse(c.value_json)}:{}),...(c.capture_id?{captureId:c.capture_id}:{}),createdMs:c.created_ms,expiresMs:c.expires_ms,state:c.state,results:Object.fromEntries(result[4].results.filter(r=>r.command_id===c.id).map(r=>[r.arm,{result:r.result,message:r.message}]))})),
    captures:result[5].results.map(c=>({deviceId:c.device_id,captureId:c.capture_id,bytes:c.bytes,sha256:c.sha256,createdMs:c.created_ms}))});
}

async function upload(request,env,auth,captureId,now) {
  if(!UUID.test(captureId)) fail(400,'Invalid captureId');
  const length=request.headers.get('Content-Length');
  if(!length||!/^\d+$/.test(length)) fail(411,'Exact Content-Length required');
  const bytes=Number(length); if(bytes>MAX_CAPTURE) fail(413,'Capture too large');
  const sha256=request.headers.get('X-Content-SHA256'); if(!/^[0-9a-f]{64}$/.test(sha256??'')) fail(400,'Invalid SHA-256');
  const issued=await one(env.DB,"SELECT id FROM commands WHERE id=? AND pair_id=? AND action='raw_start' AND target=?",captureId,auth.pair_id,auth.arm);
  if(!issued) fail(403,'Capture not issued for device');
  const existing=await one(env.DB,'SELECT * FROM captures WHERE device_id=? AND capture_id=?',auth.device_id,captureId);
  if(existing&&(existing.sha256!==sha256||existing.bytes!==bytes)) fail(409,'Capture already finalized with different content');
  const device=await one(env.DB,'SELECT status_json FROM devices WHERE id=?',auth.device_id);
  const status=JSON.parse(device.status_json);
  if(!existing&&(status.captureId!==captureId||status.rawLogging)) fail(409,'Capture is not finalized');
  if(!existing&&status.rawLogBytes!==bytes) fail(400,'Content-Length does not match finalized capture');
  const payload=await boundedBody(request,MAX_CAPTURE);
  if(payload.byteLength!==bytes) fail(400,'Content-Length mismatch');
  if(await digest(payload)!==sha256) fail(400,'Checksum mismatch');
  if(existing) return Response.json({captureId,bytes,sha256});
  // Content-addressed keys prevent competing uploads from overwriting committed bytes.
  const objectKey=`${auth.pair_id}/${auth.device_id}/${captureId}/${sha256}`;
  await env.CAPTURES.put(objectKey,payload,{sha256,httpMetadata:{contentType:'text/csv; charset=utf-8'}});
  await stmt(env.DB,`INSERT OR IGNORE INTO captures(device_id,capture_id,pair_id,bytes,sha256,object_key,created_ms) SELECT ?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM devices WHERE id=? AND json_extract(status_json,'$.captureId')=? AND json_extract(status_json,'$.rawLogging')=0 AND json_extract(status_json,'$.rawLogBytes')=?)`,auth.device_id,captureId,auth.pair_id,bytes,sha256,objectKey,now,auth.device_id,captureId,bytes).run();
  const committed=await one(env.DB,'SELECT sha256,bytes FROM captures WHERE device_id=? AND capture_id=?',auth.device_id,captureId);
  if(!committed||committed.sha256!==sha256||committed.bytes!==bytes) fail(409,'Capture changed during upload');
  return Response.json({captureId,bytes,sha256});
}

async function download(env,auth,deviceId,captureId) {
  if(!ID.test(deviceId)||!UUID.test(captureId)) fail(404,'Capture not found');
  const capture=await one(env.DB,'SELECT * FROM captures WHERE pair_id=? AND device_id=? AND capture_id=?',auth.pair_id,deviceId,captureId);
  if(!capture) fail(404,'Capture not found');
  const object=await env.CAPTURES.get(capture.object_key); if(!object) fail(503,'Capture storage unavailable');
  return new Response(object.body,{headers:{'Content-Type':'text/csv; charset=utf-8','Content-Length':String(capture.bytes),'X-Content-SHA256':capture.sha256,'Content-Disposition':`attachment; filename="${deviceId}-${captureId}.csv"`}});
}

export default {
  async fetch(request,env) {
    const origin=request.headers.get('Origin');
    const allowed=(env.ALLOWED_ORIGINS??'').split(',').map(s=>s.trim()).filter(Boolean);
    let response;
    try {
      if(origin&&!allowed.includes(origin)) fail(403,'Origin not allowed');
      if(request.method==='OPTIONS') response=new Response(null,{status:204,headers:{'Access-Control-Allow-Methods':'GET, POST, PUT, OPTIONS','Access-Control-Allow-Headers':'Authorization, Content-Type, X-Content-SHA256','Access-Control-Max-Age':'600'}});
      else {
        const path=new URL(request.url).pathname;
        const auth=await identity(request,env); const now=Date.now();
        if(path.startsWith('/v1/operator/')&&auth.role!=='operator') fail(403,'Operator credential required');
        if(path.startsWith('/v1/device/')&&auth.role!=='device') fail(403,'Device credential required');
        if(path==='/v1/device/exchange'&&request.method==='POST') response=await exchange(request,env,auth,now);
        else if(path==='/v1/operator/state'&&request.method==='GET') response=await state(env,auth,now);
        else if(path==='/v1/operator/commands'&&request.method==='POST') response=await submit(request,env,auth,now);
        else if(/^\/v1\/device\/captures\/[^/]+$/.test(path)&&request.method==='PUT') response=await upload(request,env,auth,path.split('/')[4],now);
        else if(/^\/v1\/operator\/captures\/[^/]+\/[^/]+$/.test(path)&&request.method==='GET') response=await download(env,auth,...path.split('/').slice(4));
        else fail(404,'Not found');
      }
    } catch(error) { response=Response.json({error:error instanceof HttpError?error.message:'Service unavailable'},{status:error instanceof HttpError?error.status:503}); }
    const headers=new Headers(response.headers);
    headers.set('Cache-Control','no-store'); headers.set('X-Content-Type-Options','nosniff'); headers.set('Vary','Origin');
    if(origin&&allowed.includes(origin)) { headers.set('Access-Control-Allow-Origin',origin); headers.set('Access-Control-Expose-Headers','Content-Disposition, Content-Length, X-Content-SHA256'); }
    return new Response(response.body,{status:response.status,headers});
  }
};

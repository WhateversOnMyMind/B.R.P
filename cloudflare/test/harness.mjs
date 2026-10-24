import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import worker from '../src/worker.mjs';

export const hash = value => createHash('sha256').update(value).digest('hex');
export class SQLiteD1 {
  constructor() { this.sqlite = new DatabaseSync(':memory:'); this.sqlite.exec(readFileSync(new URL('../migrations/0001_control.sql', import.meta.url), 'utf8')); }
  prepare(sql) {
    const db = this.sqlite;
    return { args: [], bind(...args) { this.args = args; return this; },
      async first() { return db.prepare(sql).get(...this.args) ?? null; },
      async all() { return {results: db.prepare(sql).all(...this.args), success:true}; },
      async run() { const r = db.prepare(sql).run(...this.args); return {success:true, meta:{changes:Number(r.changes)}}; },
      execute() { const s=db.prepare(sql); if (/^\s*SELECT\b/i.test(sql)) return {success:true,results:s.all(...this.args)}; const r=s.run(...this.args); return {success:true,meta:{changes:Number(r.changes)}}; }
    };
  }
  async batch(statements) { this.sqlite.exec('BEGIN IMMEDIATE'); try { const results=statements.map(s=>s.execute()); this.sqlite.exec('COMMIT'); return results; } catch(e) { this.sqlite.exec('ROLLBACK'); throw e; } }
}

// Only R2 is substituted: tests execute production requests and real SQLite SQL.
export class MemoryR2 {
  objects = new Map();
  async put(key, body, options = {}) { const bytes = new Uint8Array(await new Response(body).arrayBuffer()); if(options.sha256 && hash(bytes)!==options.sha256) throw Error('checksum mismatch'); this.objects.set(key,bytes); return {key,size:bytes.length}; }
  async get(key) { const bytes=this.objects.get(key); return bytes ? {body:bytes,size:bytes.length} : null; }
}

export async function createHarness() {
  const DB = new SQLiteD1(); const CAPTURES = new MemoryR2();
  DB.sqlite.exec("INSERT INTO pairs(id) VALUES ('pair-a'),('pair-b'); INSERT INTO devices(id,pair_id,arm) VALUES ('left-a','pair-a','L'),('right-a','pair-a','R'),('left-b','pair-b','L'),('right-b','pair-b','R');");
  const keys={operator:'operator-a-test-key',other:'operator-b-test-key',L:'left-a-test-key',R:'right-a-test-key',otherL:'left-b-test-key'};
  for(const [name,key] of Object.entries(keys)) {
    const device = {L:'left-a',R:'right-a',otherL:'left-b'}[name];
    await DB.prepare('INSERT INTO credentials(token_hash,role,pair_id,device_id,label) VALUES (?,?,?,?,?)').bind(hash(key),device?'device':'operator',name.startsWith('other')?'pair-b':'pair-a',device??null,name).run();
  }
  const env={DB,CAPTURES,ALLOWED_ORIGINS:'https://blindrunning.com,https://preview.example'};
  const sequences={L:0,R:0,otherL:0};
  async function request(path, {as='operator', method='GET', body, headers={}}={}) {
    const req=new Request(`https://control.example${path}`,{method,headers:{Authorization:`Bearer ${keys[as]??as}`,...(body!==undefined?{'Content-Type':'application/json'}:{}),...headers},body:body===undefined?undefined:typeof body==='string'||body instanceof Uint8Array?body:JSON.stringify(body)});
    return worker.fetch(req,env,{});
  }
  async function exchange(arm='L', changes={}, extra={}) {
    return request('/v1/device/exchange',{as:arm,method:'POST',body:{bootId:arm==='R'?'202':'101',sequence:++sequences[arm],status:{arm:arm==='R'?'R':'L',actuator:'piezo',feedbackIntensity:0,toneActive:false,toneHz:4000,pulsePeriodMs:0,motorEnabled:true,feedbackDeadZone:0.055,settingsRevision:0,peerFresh:true,tempC:25,rawLogging:false,rawLogBytes:0,captureId:'',captureUploaded:false,recalibrating:false,...changes},ack:null,...extra}});
  }
  async function online() { await exchange('L'); await exchange('R'); }
  async function command(body={action:'set_motor_enabled',target:'pair',value:false},expectedRevision=0) { return request('/v1/operator/commands',{method:'POST',body:{expectedRevision,...body}}); }
  async function state() { return (await request('/v1/operator/state')).json(); }
  return {DB,CAPTURES,env,keys,request,exchange,online,command,state};
}

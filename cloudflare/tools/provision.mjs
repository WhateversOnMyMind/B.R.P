import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const [mode,pairId,first,second,third,...extra]=process.argv.slice(2);
const valid=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(value);
const quote=value=>`'${value.replaceAll("'","''")}'`;
const hash=value=>createHash('sha256').update(value).digest('hex');
try {
  if(extra.length||!['pair','operator','device'].includes(mode)||!valid(pairId)||!valid(first)) throw Error('arguments');
  if(mode==='pair'&&(!valid(second)||!valid(third)||first===second)) throw Error('arguments');
  if(mode==='operator'&&(second!==undefined||third!==undefined)) throw Error('arguments');
  if(mode==='device'&&(!valid(second)||third!==undefined)) throw Error('arguments');
  const keys={}; const statements=[];
  function credential(name,role,deviceId,label) {
    const key=randomBytes(32).toString('base64url'); keys[name]=key;
    const values=[hash(key),role,pairId,deviceId,label].map(v=>v===null?'NULL':quote(v));
    statements.push(`INSERT INTO credentials(token_hash,role,pair_id,device_id,label) VALUES (${values.join(',')});`);
  }
  if(mode==='pair') {
    statements.push(`INSERT INTO pairs(id) VALUES (${quote(pairId)});`);
    statements.push(`INSERT INTO devices(id,pair_id,arm) VALUES (${quote(first)},${quote(pairId)},'L'),(${quote(second)},${quote(pairId)},'R');`);
    credential('operator','operator',null,third); credential('L','device',first,`${pairId}-L`); credential('R','device',second,`${pairId}-R`);
  } else if(mode==='operator') credential('operator','operator',null,first);
  else credential('device','device',first,second);
  const folder=new URL(`../provisioning/${pairId}-${randomUUID()}/`,import.meta.url);
  mkdirSync(folder,{recursive:true,mode:0o700});
  writeFileSync(new URL('secrets.json',folder),JSON.stringify({pairId,mode,...(mode==='pair'?{leftDeviceId:first,rightDeviceId:second}:{}),keys},null,2)+'\n',{flag:'wx',mode:0o600});
  writeFileSync(new URL('insert.sql',folder),statements.join('\n')+'\n',{flag:'wx',mode:0o600});
  process.stdout.write(`Provisioning files saved in ${fileURLToPath(folder)}\nApply insert.sql only after reviewing IDs. Keep secrets.json private. No remote changes made.\n`);
} catch {
  process.stderr.write('Provisioning failed. Usage: node tools/provision.mjs pair PAIR LEFT_ID RIGHT_ID OPERATOR_LABEL | operator PAIR LABEL | device PAIR DEVICE_ID LABEL. IDs/labels must contain only letters, digits, underscore or hyphen, at most 100 characters.\n');
  process.exitCode=1;
}

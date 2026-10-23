import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync,readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createHarness,hash} from './harness.mjs';

test('provisioning creates distinct 256-bit keys, writes only hashes to executable SQL, and never prints secrets',async()=>{
 const cwd=fileURLToPath(new URL('..',import.meta.url));
 const pair=`test-${crypto.randomUUID()}`;
 const output=spawnSync(process.execPath,['tools/provision.mjs','pair',pair,`${pair}-L`,`${pair}-R`,'test-operator'],{cwd,encoding:'utf8'});
 assert.equal(output.status,0);
 const folders=readdirSync(new URL('../provisioning/',import.meta.url)).filter(name=>name.startsWith(pair)); assert.equal(folders.length,1);
 const dir=new URL(`../provisioning/${folders[0]}/`,import.meta.url);
 const secrets=JSON.parse(readFileSync(new URL('secrets.json',dir),'utf8'));
 const sql=readFileSync(new URL('insert.sql',dir),'utf8');
 const keys=Object.values(secrets.keys); assert.equal(keys.length,3); assert.equal(new Set(keys).size,3);
 for(const key of keys) { assert.ok(/^[A-Za-z0-9_-]{43}$/.test(key)); assert.ok(!sql.includes(key)); assert.ok(!output.stdout.includes(key)); assert.ok(!output.stderr.includes(key)); assert.ok(sql.includes(hash(key))); }
 const h=await createHarness(); h.DB.sqlite.exec(sql);
 const identity=await h.request('/v1/operator/state',{as:secrets.keys.operator}); assert.equal(identity.status,200); assert.equal((await identity.json()).pairId,pair);
 const again=spawnSync(process.execPath,['tools/provision.mjs','pair','invalid/pair','L','R','label'],{cwd,encoding:'utf8'}); assert.notEqual(again.status,0);
});

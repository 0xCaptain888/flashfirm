import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {handle,sha,decryptReceipt} from '../cloudflare/api.mjs';
import {verifyCaseExport} from '../src/task-case.mjs';
import {hash,identity} from '../src/protocol.mjs';
const revised=JSON.parse(readFileSync(new URL('../evidence/revised-live-receipt.json',import.meta.url),'utf8'));
const original=JSON.parse(readFileSync(new URL('../evidence/queued-live-receipt.json',import.meta.url),'utf8'));
class D1 {
 constructor(){this.db=new DatabaseSync(':memory:');this.db.exec('PRAGMA foreign_keys=ON');for(const file of ['0001_workspace.sql','0002_task_cases.sql'])this.db.exec(readFileSync(new URL('../cloudflare/migrations/'+file,import.meta.url),'utf8'));}
 prepare(sql){const db=this.db;let args=[];return {bind(...values){args=values;return this;},async first(){return db.prepare(sql).get(...args)??null;},async all(){return {results:db.prepare(sql).all(...args)};},async run(){const result=db.prepare(sql).run(...args);return {meta:{changes:result.changes}};}};}
 async batch(statements){this.db.exec('BEGIN');try{const result=[];for(const s of statements)result.push(await s.run());this.db.exec('COMMIT');return result;}catch(e){this.db.exec('ROLLBACK');throw e;}}
}
async function fixture(){
 const DB=new D1(),created=new Set();
 const env={DB,VAULT_KEY:randomBytes(32).toString('hex'),VERIFICATION:{
  async create({id}){if(created.has(id))throw Error('exists');created.add(id);},
  async get(id){return {async status(){if(!created.has(id))throw Error('missing');return {status:'queued'};}};}
 },ASSETS:{fetch:()=>new Response('asset')}};
 const a=randomBytes(32).toString('base64url'),b=randomBytes(32).toString('base64url');
 for(const [token,owner]of [[a,'alice'],[b,'bob']])await DB.prepare('INSERT INTO tokens(hash,owner,expires) VALUES(?,?,?)').bind(await sha(token),owner,Date.now()+60000).run();
 const request=(path='',method='GET',input,token=a,headers={})=>handle(new Request('https://unit.example/api/workspaces'+path,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json',...headers},...(input===undefined?{}:{body:JSON.stringify(input)})}),env);
 const response=await request('','POST',{title:'Review'});assert.equal(response.status,201);const firm=await response.json();return {env,DB,a,b,firm,request,created};
}
test('cloud API isolates owners, rejects origins and exposes no paid runner',async()=>{
 const f=await fixture();try{
 assert.equal((await f.request('/'+f.firm.id,'GET',undefined,f.b)).status,404);
 assert.equal((await f.request('','GET',undefined,'bad')).status,401);
 assert.equal((await f.request('','GET',undefined,f.a,{Origin:'https://evil.example'})).status,403);
 const model=await(await f.request('/model-status')).json();assert.equal(model.enabled,false);assert.equal(model.budget.calls,10);
 assert.equal((await f.request(`/${f.firm.id}/jobs`,'POST',{kind:'LIVE_PUBLIC_REVIEW'},{},{})).status,401);
 assert.equal((await f.request(`/${f.firm.id}/jobs`,'POST',{kind:'LIVE_PUBLIC_REVIEW',receipt:{}},f.a,{'Idempotency-Key':'paid-attempt'})).status,409);
 assert.equal(f.created.size,0);
 }finally{f.DB.db.close();}
});
test('cloud jobs encrypt input, deduplicate retry and reject changed input or closed workspace',async()=>{
 const f=await fixture();try{
 const input={kind:'VERIFY_RECEIPT',receipt:{payload:{private:'never store as plaintext'}}},headers={'Idempotency-Key':'test-request-one'};
 const first=await f.request(`/${f.firm.id}/jobs`,'POST',input,f.a,headers);assert.equal(first.status,202);const job=await first.json();assert.equal(job.input,undefined);
 const stored=await f.env.DB.prepare('SELECT * FROM jobs WHERE id=?').bind(job.id).first();assert.ok(!stored.input.includes('never store'));assert.deepEqual(await decryptReceipt(f.env,stored),input.receipt);
 const again=await(await f.request(`/${f.firm.id}/jobs`,'POST',input,f.a,headers)).json();assert.equal(again.id,job.id);assert.equal(f.created.size,1);
 assert.equal((await f.request(`/${f.firm.id}/jobs`,'POST',{...input,receipt:{}},f.a,headers)).status,409);
 assert.equal((await f.request(`/${f.firm.id}/jobs/${job.id}`,'GET',undefined,f.b)).status,404);
 assert.equal((await f.request(`/${f.firm.id}/dissolve`,'POST',{})).status,200);
 assert.equal((await f.request(`/${f.firm.id}/jobs`,'POST',input,f.a,headers)).status,409);
 assert.equal((await(await f.request(`/${f.firm.id}/jobs/${job.id}`)).json()).state,'CANCELLED');
 }finally{f.DB.db.close();}
});
test('cloud dispatch failure retains the same queued job for explicit resume',async()=>{
 const f=await fixture();try{
 const real=f.env.VERIFICATION;f.env.VERIFICATION={create:async()=>{throw Error('unavailable');},get:async()=>{throw Error('unknown');}};
 const job=await(await f.request(`/${f.firm.id}/jobs`,'POST',{kind:'VERIFY_RECEIPT',receipt:{}},f.a,{'Idempotency-Key':'resume-test'})).json();assert.equal(job.dispatched,false);
 f.env.VERIFICATION=real;
 const resumed=await(await f.request(`/${f.firm.id}/jobs/${job.id}/resume`,'POST',{})).json();assert.equal(resumed.dispatched,true);assert.equal(resumed.id,job.id);
 assert.equal((await(await f.request(`/${f.firm.id}/jobs`)).json()).length,1);
 }finally{f.DB.db.close();}
});
test('cloud quota and payload limits reject before unbounded work',async()=>{
 const f=await fixture();try{
 assert.equal((await f.request('','POST',{title:'x'.repeat(100001)})).status,413);
 const day=new Date().toISOString().slice(0,10);await f.DB.prepare('INSERT INTO quotas VALUES(?,?) ON CONFLICT(bucket) DO UPDATE SET count=500').bind('write:'+day,500).run();
 assert.equal((await f.request('','POST',{title:'limited'})).status,429);
 assert.equal(f.created.size,0);
 }finally{f.DB.db.close();}
});
test('cloud task dossier is encrypted, immutable, owner scoped and retained after closure',async()=>{
 const f=await fixture(),path=`/${f.firm.id}`;
 try{
  assert.equal((await(await f.request(path+'/case')).json()).status.attached,false);
  const response=await f.request(path+'/case','POST',{receipt:revised});assert.equal(response.status,201);
  const result=await response.json();assert.equal(result.status.state,'AWAITING_REVIEW');
  assert.equal(result.status.settlementExecuted,false);
  assert.equal((await f.request(path+'/jobs','POST',{kind:'VERIFY_RECEIPT',receipt:original},f.a,{'Idempotency-Key':'wrong-case-report'})).status,409);
  assert.equal((await f.request(path+'/jobs','POST',{kind:'VERIFY_RECEIPT',receipt:revised},f.a,{'Idempotency-Key':'exact-case-report'})).status,202);
  const blob=f.DB.db.prepare('SELECT blob FROM task_cases').get().blob;
  assert.ok(!blob.includes(revised.payload.taskId));
  assert.equal((await f.request(path+'/case','POST',{receipt:original})).status,409);
  assert.equal((await f.request(path+'/case','GET',undefined,f.b)).status,404);
  assert.equal((await f.request(path+'/case-export','GET',undefined,f.b)).status,404);
  const inbox=await(await f.request(path+'/notifications')).json();assert.equal(inbox.unread,1);
  assert.equal((await f.request(path+'/notifications/'+inbox.items[0].id,'POST',{})).status,200);
  assert.equal((await(await f.request(path+'/notifications')).json()).unread,0);
  await f.request(path+'/dissolve','POST',{});
  const dossier=await(await f.request(path+'/case-export')).json();
  assert.equal(verifyCaseExport(dossier).valid,true);assert.equal(dossier.status.state,'CLOSED');
  assert.equal((await f.request(path+'/case','POST',{receipt:revised})).status,409);
 }finally{f.DB.db.close();}
});
test('cloud database guards case/review binding and closed-workspace races atomically',async()=>{
 const f=await fixture(),path=`/${f.firm.id}`;
 try{
  const status=(await(await f.request(path+'/case','POST',{receipt:revised})).json()).status;
  const keys=Array.from({length:6},()=>identity().publicKey);
  const policy={taskRoot:status.taskRoot,buyerKey:keys[0],appealKey:keys[1],workerKeys:[keys[2]],reviewers:keys.slice(3).map((key,i)=>({key,operator:'development-'+i})),expiresAt:Date.now()+600000,appealWindowMs:60000};
  assert.equal((await f.request(path+'/review','POST',{policy,resultRoot:hash(original)})).status,400);
  assert.equal((await f.request(path+'/review','POST',{policy,resultRoot:hash(revised)})).status,201);
  const stored=f.DB.db.prepare('SELECT body FROM reviews').get().body;
  const changed=JSON.parse(stored);changed.resultRoot=hash(original);
  assert.throws(()=>f.DB.db.prepare('UPDATE reviews SET body=?').run(JSON.stringify(changed)),/CASE_REVIEW_MISMATCH/);
  const another=await(await f.request('','POST',{title:'race test'})).json();
  await f.request('/'+another.id+'/dissolve','POST',{});
  assert.throws(()=>f.DB.db.prepare('INSERT INTO task_cases VALUES(?,?,?,?)').run(another.id,'x','y','{}'),/WORKSPACE_CLOSED/);
 }finally{f.DB.db.close();}
});

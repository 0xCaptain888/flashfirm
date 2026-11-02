import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {handle,sha,decryptReceipt} from '../cloudflare/api.mjs';
class D1 {
 constructor(){this.db=new DatabaseSync(':memory:');this.db.exec('PRAGMA foreign_keys=ON');this.db.exec(readFileSync(new URL('../cloudflare/migrations/0001_workspace.sql',import.meta.url),'utf8'));}
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

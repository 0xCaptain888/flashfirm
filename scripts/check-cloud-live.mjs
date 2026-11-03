import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
const base=process.argv[2],owner=process.argv[3];
if(base!=='https://flashfirm-api.fluoridated-rhinoceros.workers.dev'||!/^[a-z0-9-]{1,40}$/.test(owner??''))throw Error('Expected the dedicated public deployment and a scoped smoke owner');
const root=new URL('../',import.meta.url),dir=new URL('.runtime/cloudflare/',root);
const token=(await readFile(new URL(`${owner}-token.txt`,dir),'utf8')).trim();
const api=async(path='',method='GET',value,key,expected=200)=>{
 const r=await fetch(base+'/api/workspaces'+path,{method,redirect:'error',signal:AbortSignal.timeout(20000),headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json',...(key?{'Idempotency-Key':key}:{})},...(value===undefined?{}:{body:JSON.stringify(value)})});
 const result=await r.json();assert.equal(r.status,expected,JSON.stringify({status:r.status,error:result.error}));return result;
};
const healthResponse=await fetch(base+'/healthz'),health=await healthResponse.json();
assert.equal(healthResponse.status,200);assert.equal(health.status,'READY');assert.equal(health.paidCallsEnabled,false);
assert.equal((await fetch(base+'/api/workspaces')).status,401);
assert.equal((await fetch(base+'/api/workspaces',{headers:{Origin:'https://untrusted.example'}})).status,403);
await api('/00000000-0000-0000-0000-000000000000','GET',undefined,undefined,404);
const receipt=JSON.parse(await readFile(new URL('evidence/queued-live-receipt.json',root),'utf8'));
// A private journal preserves the idempotency key if a remote response is lost.
const journalFile=new URL(`${owner}-smoke.json`,dir);
let journal;
try{journal=JSON.parse(await readFile(journalFile,'utf8'));}
catch(error){
 if(error.code!=='ENOENT')throw error;
 const firm=await api('','POST',{title:'Public deployment verification'},undefined,201);
 journal={firmId:firm.id,requestKey:crypto.randomUUID()};
 await writeFile(journalFile,JSON.stringify(journal),{flag:'wx',mode:0o600});
}
const id=journal.firmId,requestKey=journal.requestKey;
const job=await api(`/${id}/jobs`,'POST',{kind:'VERIFY_RECEIPT',receipt},requestKey,202);
assert.equal((await api(`/${id}/jobs`,'POST',{kind:'VERIFY_RECEIPT',receipt},requestKey,202)).id,job.id);
await api(`/${id}/jobs`,'POST',{kind:'VERIFY_RECEIPT',receipt:{tampered:true}},requestKey,409);
let final;
for(let i=0;i<25;i++){final=await api(`/${id}/jobs/${job.id}`);if(final.state==='SUCCEEDED')break;await delay(2000);}
assert.equal(final.state,'SUCCEEDED');assert.equal(final.result.valid,true);
const note=await api(`/${id}/documents`,'POST',{text:'Public deployment verification: disposable encrypted test note.'},undefined,201);
assert.ok(note.id);
assert.equal((await api('/'+id)).state,'ACTIVE');
assert.ok((await api(`/${id}/jobs`)).some(j=>j.id===job.id));
await api(`/${id}/dissolve`,'POST',{});
assert.equal((await api('/'+id)).state,'CLOSED');
assert.equal((await api(`/${id}/jobs/${job.id}`)).result.valid,true);
await api(`/${id}/documents`,'POST',{text:'Must be rejected after closure'},undefined,409);
const evidence={status:'PUBLIC_WORKER_D1_WORKFLOW_VERIFIED',verifiedAt:new Date().toISOString(),endpoint:base,storage:'D1',firmId:id,jobId:job.id,receiptSha256:createHash('sha256').update(JSON.stringify(receipt)).digest('hex'),receiptValid:true,duplicateJobPrevented:true,conflictingReplayRejected:true,unauthenticatedRejected:true,crossOriginRejected:true,persistedAcrossRequests:true,closedWorkspaceWritesRejected:true,closed:true,paidCalls:0,financialTransactions:0,independentOperatorsVerified:false,teeEnabled:false};
await mkdir(new URL('evidence/',root),{recursive:true});
await writeFile(new URL('evidence/cloudflare-deployment.json',root),JSON.stringify(evidence,null,2)+'\n');
console.log(JSON.stringify(evidence));

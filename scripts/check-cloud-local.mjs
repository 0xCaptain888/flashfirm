import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {verifyCaseExport} from '../src/task-case.mjs';
const base='http://127.0.0.1:43184';
const token=await readFile(new URL('../.runtime/cloudflare/local-test-token.txt',import.meta.url),'utf8');
const api=async(path='',method='GET',value,key)=>{
 const r=await fetch(base+'/api/workspaces'+path,{method,redirect:'error',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json',...(key?{'Idempotency-Key':key}:{})},...(value===undefined?{}:{body:JSON.stringify(value)})});
 const result=await r.json();assert.ok(r.ok,JSON.stringify({status:r.status,error:result.error}));return result;
};
assert.equal((await fetch(base+'/healthz')).status,200);
assert.equal((await fetch(base+'/api/workspaces')).status,401);
const receipt=JSON.parse(await readFile(new URL('../evidence/queued-live-receipt.json',import.meta.url),'utf8'));
const firm=await api('','POST',{title:'Cloudflare local integration check'});
const requestKey=crypto.randomUUID(),job=await api(`/${firm.id}/jobs`,'POST',{kind:'VERIFY_RECEIPT',receipt},requestKey);
assert.equal((await api(`/${firm.id}/jobs`,'POST',{kind:'VERIFY_RECEIPT',receipt},requestKey)).id,job.id);
let final;
for(let i=0;i<30;i++){final=await api(`/${firm.id}/jobs/${job.id}`);if(final.state==='SUCCEEDED')break;await delay(1000);}
assert.equal(final.state,'SUCCEEDED');assert.equal(final.result.valid,true);
const revision=JSON.parse(await readFile(new URL('../evidence/revised-live-receipt.json',import.meta.url),'utf8'));
const task=await api(`/${firm.id}/case`,'POST',{receipt:revision});
assert.equal(task.status.state,'AWAITING_REVIEW');
const inbox=await api(`/${firm.id}/notifications`);
assert.ok(inbox.unread>0);
for(const item of inbox.items)await api(`/${firm.id}/notifications/${item.id}`,'POST',{});
assert.equal((await api(`/${firm.id}/notifications`)).unread,0);
assert.equal(verifyCaseExport(await api(`/${firm.id}/case-export`)).valid,true);
const revisedJob=await api(`/${firm.id}/jobs`,'POST',{kind:'VERIFY_RECEIPT',receipt:revision},crypto.randomUUID());
let revisedFinal;
for(let i=0;i<15;i++){revisedFinal=await api(`/${firm.id}/jobs/${revisedJob.id}`);if(revisedFinal.state==='SUCCEEDED')break;await delay(1000);}
assert.equal(revisedFinal.result.valid,true);assert.equal(revisedFinal.result.qualityState,'AWAITING_NEW_REVIEW');
await api(`/${firm.id}/documents`,'POST',{text:'Local encrypted smoke note'});
await api(`/${firm.id}/dissolve`,'POST',{});
assert.equal((await api('/'+firm.id)).state,'CLOSED');
assert.equal(verifyCaseExport(await api(`/${firm.id}/case-export`)).valid,true);
console.log(JSON.stringify({status:'LOCAL_WORKER_D1_WORKFLOW_PASSED',firmId:firm.id,jobId:job.id,receiptValid:true,duplicateJobPrevented:true,paidCalls:0,remoteDeployment:false}));

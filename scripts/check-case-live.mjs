import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {verifyCaseExport} from '../src/task-case.mjs';
import {hash} from '../src/protocol.mjs';
import {setTimeout as delay} from 'node:timers/promises';
const base=process.argv[2],owner=process.argv[3];
if(!['https://flashfirm-api.fluoridated-rhinoceros.workers.dev','http://127.0.0.1:43184'].includes(base)||!/^case-qa-[a-z0-9-]{1,20}$/.test(owner??''))throw Error('Dedicated service and disposable case-qa owner required');
if(process.env.FLASHFIRM_USE_SYSTEM_PROXY==='1'){
 const {ProxyAgent,setGlobalDispatcher}=await import('../cloudflare/node_modules/undici/index.js');
 setGlobalDispatcher(new ProxyAgent('http://127.0.0.1:7897'));
}
const token=(await readFile(`.runtime/cloudflare/${owner}-token.txt`,'utf8')).trim();
if(process.argv[4]==='--revoked'){
 const response=await fetch(base+'/api/workspaces',{headers:{Authorization:`Bearer ${token}`},redirect:'error',signal:AbortSignal.timeout(20000)});
 assert.equal(response.status,401);
 const evidence=JSON.parse(await readFile('evidence/cloudflare-case-upgrade.json','utf8'));
 evidence.testTokenRevokedAndRejected=true;
 await writeFile('evidence/cloudflare-case-upgrade.json',JSON.stringify(evidence,null,2)+'\n');
 console.log('Disposable test token revoked and rejected; evidence updated.');
 process.exit(0);
}
const api=async(path='',method='GET',value,expected=200,key)=>{
 const r=await fetch(base+'/api/workspaces'+path,{method,redirect:'error',signal:AbortSignal.timeout(20000),headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json',...(key?{'Idempotency-Key':key}:{})},...(value===undefined?{}:{body:JSON.stringify(value)})});
 const result=await r.json();assert.equal(r.status,expected,result.error);return result;
};
const revision=JSON.parse(await readFile('evidence/revised-live-receipt.json','utf8'));
const original=JSON.parse(await readFile('evidence/queued-live-receipt.json','utf8'));
const journalFile=`.runtime/cloudflare/${owner}-case-check.json`;
let journal;
try{journal=JSON.parse(await readFile(journalFile,'utf8'));}
catch(e){if(e.code!=='ENOENT')throw e;const firm=await api('','POST',{title:'Disposable task dossier acceptance'},201);journal={firmId:firm.id,requestKey:crypto.randomUUID()};await writeFile(journalFile,JSON.stringify(journal),{flag:'wx',mode:0o600});}
const id=journal.firmId;
const task=await api(`/${id}/case`,'POST',{receipt:revision},201);
assert.equal(task.status.receiptHash,hash(revision));assert.equal(task.status.state,'AWAITING_REVIEW');
await api(`/${id}/case`,'POST',{receipt:original},409);
const inbox=await api(`/${id}/notifications`);assert.equal(inbox.unread,1);
await api(`/${id}/notifications/${inbox.items[0].id}`,'POST',{});
assert.equal((await api(`/${id}/notifications`)).unread,0);
const job=await api(`/${id}/jobs`,'POST',{kind:'VERIFY_RECEIPT',receipt:revision},202,journal.requestKey);
assert.equal((await api(`/${id}/jobs`,'POST',{kind:'VERIFY_RECEIPT',receipt:revision},202,journal.requestKey)).id,job.id);
await api(`/${id}/jobs`,'POST',{kind:'VERIFY_RECEIPT',receipt:original},409,crypto.randomUUID());
let final;
for(let i=0;i<20;i++){final=await api(`/${id}/jobs/${job.id}`);if(final.state==='SUCCEEDED')break;await delay(1000);}
assert.equal(final.state,'SUCCEEDED');assert.equal(final.result.valid,true);assert.equal(final.result.qualityState,'AWAITING_NEW_REVIEW');
const exported=await api(`/${id}/case-export`);assert.equal(verifyCaseExport(exported).valid,true);
await writeFile(`.runtime/cloudflare/${owner}-dossier.json`,JSON.stringify(exported),{mode:0o600});
assert.equal((await api(`/${id}/case`)).status.receiptHash,hash(revision));
await api(`/${id}/dissolve`,'POST',{});
assert.equal((await api(`/${id}/case`)).status.state,'CLOSED');
assert.equal(verifyCaseExport(await api(`/${id}/case-export`)).valid,true);
await api(`/${id}/case`,'POST',{receipt:revision},409);
const result={status:'PUBLIC_TASK_DOSSIER_VERIFIED',verifiedAt:new Date().toISOString(),endpoint:base,
 workspaceId:id,receiptHash:hash(revision),receiptKind:'OPERATOR_REVISION',citationState:'PASS',reviewState:'AWAITING_NEW_REVIEW',
 immutableReportVerified:true,notificationAcknowledgementPersisted:true,exportReverified:true,
 revisedReceiptWorkflowVerified:true,workflowJobId:job.id,duplicateVerificationPrevented:true,mismatchedReportJobRejected:true,
 closedWorkspacePreservesEvidence:true,closedWorkspaceWritesRejected:true,paidCalls:0,financialTransactions:0,
 independentOperatorsVerified:false,taskBoundTeeVerified:false,settlementExecuted:false};
await writeFile('evidence/cloudflare-case-upgrade.json',JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result));

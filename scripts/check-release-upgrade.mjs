import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {taskFixture} from '../test-support/task-flow.mjs';
import {validateReviewPackage,blankReview,signHumanReview} from '../src/review-package.mjs';
import {seal,hash} from '../src/protocol.mjs';
const [base,owner]=process.argv.slice(2);
if(!['http://127.0.0.1:43184','https://flashfirm-api.fluoridated-rhinoceros.workers.dev'].includes(base)||
 !/^flow-qa-[a-z0-9-]{1,20}$/.test(owner??''))throw Error('DISPOSABLE_SERVICE_AND_QA_OWNER_REQUIRED');
if(process.env.FLASHFIRM_USE_SYSTEM_PROXY==='1'){
 const {ProxyAgent,setGlobalDispatcher}=await import('../cloudflare/node_modules/undici/index.js');
 setGlobalDispatcher(new ProxyAgent('http://127.0.0.1:7897'));
}
const token=(await readFile(`.runtime/cloudflare/${owner}-token.txt`,'utf8')).trim(),f=taskFixture();
const api=async(path='',method='GET',input,expected=200,auth=token)=>{
 const r=await fetch(base+'/api/workspaces'+path,{method,redirect:'error',signal:AbortSignal.timeout(30000),
  headers:{Authorization:'Bearer '+auth,'Content-Type':'application/json'},
  ...(input===undefined?{}:{body:JSON.stringify(input)})});
 const result=await r.json();assert.equal(r.status,expected,result.error);return result;
};
await api('','GET',undefined,401,'invalid-qa-token');
const firm=await api('','POST',{title:'QA ONLY · blank reviewer handoff and release blockers'},201),path='/'+firm.id;
const empty=await api(path+'/flow/readiness');assert.equal(empty.next.id,'report');
await api(path+'/case','POST',{receipt:f.receipt},201);
await api(path+'/review','POST',{policy:f.review.commitment.policy,resultRoot:f.record.receiptHash},201);
await api(path+'/flow/plan','POST',f.plan);
const pkg=await api(path+'/flow/review-package');validateReviewPackage(pkg);
const before=await api(path+'/events'),checklist=await api(path+'/flow/readiness');
assert.equal(checklist.next.id,'identity');assert.equal(checklist.mainnetEscrowEnabled,false);
assert.equal((await api(path+'/events')).length,before.length);
const evaluations=[];
for(const [i,key]of f.reviewers.slice(0,2).entries()){
 const draft=blankReview(pkg,key.publicKey);assert.equal(draft.decision.verdict,null);
 draft.evaluation=structuredClone(f.evaluations[i].payload);
 for(const row of draft.evaluation.samples)row.notes='SYNTHETIC QA notes only; not actual independent human review or a paid model run.';
 draft.decision=structuredClone(f.review.decisions[i].payload);
 const result=signHumanReview(pkg,draft,key,seal);evaluations.push(result.evaluation);
 await api(path+'/decision','POST',result.decision);
}
await api(path+'/flow/quality','POST',{evaluations,contributions:f.contributions,certificates:[]});
const saved=await api(path+'/flow');assert.equal(saved.flow.quality.state,'ASSESSED');
assert.equal(saved.readiness.releaseReady,false);assert.equal(saved.status.taskSettlementComplete,false);
await api(path+'/flow/manifest','POST',{},400);
await api(path+'/flow/readiness','POST',{},405);
await api(path+'/dissolve','POST',{});
assert.equal((await api(path+'/flow/readiness')).next.id,'workspace');
assert.equal((await api(path+'/flow/review-package')).plan.payload.resultRoot,hash(f.receipt));
await api('/logout','POST',{});await api('','GET',undefined,401);
const evidence={version:'flashfirm-release-workflow-upgrade/1',at:new Date().toISOString(),endpoint:base,
 workspaceId:firm.id,network:base.startsWith('https:')?'PUBLIC_WORKERS_D1':'LOCAL_WORKERS_D1',
 exactReportBound:true,blankReviewHandoffValidated:true,twoSyntheticReviewerResponsesValidated:true,
 readonlyChecklistPreservesEvents:true,missingExternalIdentityBlocksRelease:true,
 mainnetDefaultOff:true,closedWorkspaceRetainsEvidence:true,testTokenRevokedAndRejected:true,
 syntheticIdentityAndReviewFixture:true,independentHumanReview:false,confidentialLiveInference:false,
 financialTransactions:0,paidCalls:0,taskSettlementComplete:false};
await writeFile(base.startsWith('https:')?'evidence/release-workflow-upgrade.json':'.runtime/release-workflow-local.json',
 JSON.stringify(evidence,null,2)+'\n');
console.log(JSON.stringify(evidence,null,2));

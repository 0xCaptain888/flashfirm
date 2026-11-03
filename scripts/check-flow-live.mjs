import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {taskFixture} from '../test-support/task-flow.mjs';
import {hash} from '../src/protocol.mjs';
if(process.env.FLASHFIRM_USE_SYSTEM_PROXY==='1'){
 const {ProxyAgent,setGlobalDispatcher}=await import('../cloudflare/node_modules/undici/index.js');
 setGlobalDispatcher(new ProxyAgent('http://127.0.0.1:7897'));
}
const owner=process.argv[2];
if(!/^flow-qa-[a-z0-9-]{1,20}$/.test(owner??''))throw Error('DISPOSABLE_QA_OWNER_REQUIRED');
const token=(await readFile(`.runtime/cloudflare/${owner}-token.txt`,'utf8')).trim(),
 base='https://flashfirm-api.fluoridated-rhinoceros.workers.dev',f=taskFixture();
async function api(path,method='GET',value,expected=200){
 const r=await fetch(base+'/api/workspaces'+path,{method,redirect:'error',signal:AbortSignal.timeout(30000),
  headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(value?{body:JSON.stringify(value)}:{})});
 const result=await r.json();assert.equal(r.status,expected,result.error);return result;
}
const firm=await api('','POST',{title:'QA ONLY · same-operator synthetic evaluation acceptance'},201),path='/'+firm.id;
await api(path+'/case','POST',{receipt:f.receipt},201);
await api(path+'/review','POST',{policy:f.review.commitment.policy,resultRoot:f.record.receiptHash},201);
for(const decision of f.review.decisions)await api(path+'/decision','POST',decision);
await api(path+'/flow/plan','POST',f.plan);
await api(path+'/flow/quality','POST',{evaluations:f.evaluations,contributions:f.contributions,certificates:[]});
const result=await api(path+'/flow');assert.equal(result.flow.quality.state,'ASSESSED');
assert.equal(result.flow.plan.payload.resultRoot,hash(f.receipt));
assert.equal(result.status.state,'AWAITING_QUALITY_AND_IDENTITY');
const blocked=await api(path+'/flow/manifest','POST',{},400);
assert.match(blocked.error,/REVIEW_AND_APPEAL_CLEARANCE_REQUIRED|EXTERNAL_IDENTITY_AUTHORITY_REQUIRED/);
await api(path+'/flow/plan','POST',{...f.plan,signature:'invalid'},400);
const ops=await api('/operations');assert.equal(ops.offsiteExportConfigured,true);
await api(path+'/dissolve','POST',{});
assert.equal((await api(path+'/flow')).flow.plan.payload.resultRoot,hash(f.receipt));
await api(path+'/flow/quality','POST',{evaluations:f.evaluations},409);
const evidence={version:'flashfirm-task-flow-public/1',checkedAt:new Date().toISOString(),endpoint:base,workspaceId:firm.id,
 exactReportBound:true,buyerPlanSignatureChecked:true,signedSyntheticEvaluationsPersisted:true,
 evaluatorSamples:result.samples.length,contributionConservationVerified:
  result.flow.quality.allocation.payouts.reduce((s,p)=>s+p.amount,result.flow.quality.allocation.fee)===1000000,
 manifestRejectedWithoutClearance:true,invalidPlanRejected:true,closedWorkspaceWritesRejected:true,
 dataKind:'QA_ONLY_SAME_OPERATOR_SYNTHETIC_JUDGMENTS_ON_RECORDED_PUBLIC_REPORT',
 realIndependentReview:false,taskSettlementExecuted:false,paidCalls:0,financialTransactions:0,
 testTokenRevokedAndRejected:false,
 offsiteExportConfigured:ops.offsiteExportConfigured,organizationLoginConfigured:ops.identityProviderConfigured,
 emailDeliveryConfigured:ops.emailConfigured,cloudPushConfigured:ops.cloudPushConfigured};
await writeFile('evidence/task-flow-public-upgrade.json',JSON.stringify(evidence,null,2)+'\n');
const digest=await import('node:crypto').then(({createHash})=>createHash('sha256').update(token).digest('hex'));
await writeFile(`.runtime/cloudflare/${owner}-revoke.sql`,`UPDATE tokens SET revoked=1 WHERE hash='${digest}';\n`,{mode:0o600});
console.log(JSON.stringify(evidence));

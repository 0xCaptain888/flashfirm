import {readFileSync} from 'node:fs';
import {hash,identity,seal} from '../src/protocol.mjs';
import {createCase} from '../src/task-case.mjs';
import {commitPolicy} from '../src/governance.mjs';
import {citationLocations} from '../src/report-revision.mjs';
import {qualitySamples} from '../src/task-quality.mjs';
export function taskFixture({settlementPolicy,privacyMode,privateTaskDigest}={}){
 const now=Date.now(),receipt=JSON.parse(readFileSync(new URL('../evidence/revised-live-receipt.json',import.meta.url),'utf8'));
 const record=createCase(receipt),workers=receipt.payload.workers.map(w=>({...identity(),id:w.worker.id})),
 buyer=identity(),reviewers=[identity(),identity(),identity()],authority=identity(),arbiter=identity();
 const policy={taskRoot:record.taskRoot,buyerKey:buyer.publicKey,appealKey:arbiter.publicKey,workerKeys:workers.map(w=>w.publicKey),
  reviewers:reviewers.map((r,i)=>({key:r.publicKey,operator:'unit-test-reviewer-'+i})),expiresAt:now+3600000,appealWindowMs:60000};
 const commitment=commitPolicy(policy),review={commitment,resultRoot:record.receiptHash,decisions:reviewers.slice(0,2).map(r=>seal({
  version:'flashfirm-decision/1',policyHash:commitment.digest,taskRoot:record.taskRoot,resultRoot:record.receiptHash,
  verdict:'APPROVE',reason:'Synthetic testing only; not a real independent reviewer.',issuedAt:now},r)),appeal:null,resolution:null};
 const plan=seal({version:'flashfirm-task-plan/1',taskRoot:record.taskRoot,resultRoot:record.receiptHash,buyerKey:buyer.publicKey,
  reviewPolicyHash:commitment.digest,reviewerKeys:reviewers.map(r=>r.publicKey),createdAt:now,expiresAt:now+3600000,
  budgetUnits:1000000,allocationAsset:'ARBITRUM_NATIVE_USDC',...(settlementPolicy?{settlementPolicy}:{}),
  ...(privacyMode?{privacyMode,privateTaskDigest}:{}),rubric:[{id:'source-support',weight:100}],
  workers:workers.map((w,i)=>({id:w.id,key:w.publicKey,subject:hash('worker-'+i),artifactHash:hash(receipt.payload.workers[i].analysis),recipient:'0x'+String(i+1).repeat(40)}))},buyer);
 const subjects=[...plan.payload.workers.map(w=>({key:w.key,subject:w.subject,role:'WORKER'})),
  ...reviewers.map((r,i)=>({key:r.publicKey,subject:hash('reviewer-'+i),role:'REVIEWER'})),{key:buyer.publicKey,subject:hash('buyer'),role:'BUYER'}];
 const certificates=subjects.map(s=>seal({version:'flashfirm-identity/1',taskRoot:record.taskRoot,...s,
  issuedAt:now-1000,expiresAt:now+3600000,evidenceHash:hash('synthetic authority fixture'),
  ...(s.role==='WORKER'?{authorshipReviewed:true,artifactHash:plan.payload.workers.find(w=>w.key===s.key).artifactHash}:{})},authority));
 const contributions=workers.map((w,i)=>seal({version:'flashfirm-contribution-claim/1',planHash:hash(plan),resultRoot:record.receiptHash,
  artifactHash:plan.payload.workers[i].artifactHash,subject:plan.payload.workers[i].subject,role:'AUTHOR',issuedAt:now+1},w));
 const evaluations=reviewers.slice(0,2).map(r=>seal({version:'flashfirm-quality-evaluation/1',planHash:hash(plan),resultRoot:record.receiptHash,
  issuedAt:now+1,method:'HUMAN_BLINDED',claims:citationLocations(receipt).map(c=>({workerId:c.workerId,claimIndex:c.claimIndex,
   claimHash:hash(c),verdict:'SUPPORTED',reason:'Synthetic signed semantic judgment for protocol tests only.',sourceContext:c.quote})),
  samples:qualitySamples(receipt).map((s,i)=>({sampleHash:s.sampleHash,criteria:[{id:'source-support',score:i===0?100:100-i*10}],traceHash:hash({fixture:i})}))},r));
 return {now,receipt,record,workers,buyer,reviewers,authority,review,plan,certificates,evaluations,contributions,
  flow:{plan,evaluations,certificates,contributions,invoices:[]}};
}

import test from 'node:test';
import assert from 'node:assert/strict';
import {taskFixture} from '../test-support/task-flow.mjs';
import {nativeFixture} from '../test-support/native-task.mjs';
import {taskReadiness} from '../src/task-readiness.mjs';
import {settlementManifest} from '../src/task-settlement.mjs';
import {hash,seal} from '../src/protocol.mjs';
import {assessTaskQuality} from '../src/task-quality.mjs';
import {createReviewPackage,blankReview,signHumanReview,validateReviewPackage,validateHumanEvaluation} from '../src/review-package.mjs';
test('readiness revalidates release evidence, distinguishes payments and preserves history after expiry',()=>{
 const f=nativeFixture(),security={authority:f.authority.publicKey};
 let result=taskReadiness({...f,security},f.nativeNow);
 assert.equal(result.releaseReady,true);assert.equal(result.settlementVerified,false);
 assert.equal(result.next.id,'settlement');
 result=taskReadiness({...f,security:{}},f.nativeNow);
 assert.equal(result.releaseReady,false);assert.equal(result.next.id,'identity');
 result=taskReadiness({...f,security,recoveryHold:true},f.nativeNow);
 assert.equal(result.next.id,'workspace');assert.equal(result.releaseReady,false);
 f.flow.nativeSettlement={authorization:f.authorization,evidence:{
  verified:true,authorizationHash:hash(f.authorization),manifestHash:hash(f.flow.manifest),
  taskRoot:f.record.taskRoot,resultRoot:f.record.receiptHash,network:'testnet',commonEscrowBudgetVerified:true}};
 result=taskReadiness({...f,security},f.plan.payload.expiresAt+1);
 assert.equal(result.releaseReady,false);assert.equal(result.settlementVerified,true);assert.equal(result.mainnetSettlementVerified,false);
 assert.equal(result.checks.find(c=>c.id==='plan').code,'TASK_PLAN_EXPIRED');
});
test('external reviewer package rejects rewritten source inputs and refuses confidential export',()=>{
 const f=taskFixture(),pkg=createReviewPackage(f.flow,f.record,f.review,f.now);
 assert.equal(validateReviewPackage(pkg,f.now).resultRoot,f.record.receiptHash);
 const changed=structuredClone(pkg);changed.samples[0].input[0].claims[0].statement='tampered';
 assert.throws(()=>validateReviewPackage(changed,f.now),/TAMPERED/);
 const source=structuredClone(pkg);source.claims[0].sourceExcerpt+='invented';
 assert.throws(()=>validateReviewPackage(source,f.now),/SOURCE_TAMPERED/);
 assert.throws(()=>createReviewPackage({...f.flow,plan:seal({...f.plan.payload,privacyMode:'CONFIDENTIAL_INFERENCE'},f.buyer)},
  f.record,f.review,f.now),/PRIVATE_REVIEW_PACKAGE/);
});
test('human reviewer tool starts blank, rejects automatic approvals and produces actual pinned schemas',()=>{
 const f=taskFixture(),pkg=createReviewPackage(f.flow,f.record,f.review,f.now);
 const responses=f.reviewers.slice(0,2).map((reviewer,index)=>{
  const draft=blankReview(pkg,reviewer.publicKey,f.now);
  assert.equal(draft.decision.verdict,null);assert(draft.evaluation.samples.every(s=>s.criteria.every(c=>c.score===null)));
  assert.throws(()=>signHumanReview(pkg,draft,reviewer,seal,f.now+5));
  draft.evaluation=structuredClone(f.evaluations[index].payload);
  for(const sample of draft.evaluation.samples)sample.notes='Synthetic fixture notes for each actually inspected sample; not a real human acceptance run.';
  draft.decision=structuredClone(f.review.decisions[index].payload);
  const response=signHumanReview(pkg,draft,reviewer,seal,f.now+5);
  assert.equal(validateHumanEvaluation(pkg,response.evaluation,f.now+5),true);
  assert.equal(response.independenceCertified,false);
  const challenged=structuredClone(draft);challenged.evaluation.claims[0].verdict='UNSUPPORTED';
  assert.throws(()=>signHumanReview(pkg,challenged,reviewer,seal,f.now+5),/CONTRADICTS/);
  return response;
 });
 assert.equal(assessTaskQuality(f.plan,f.receipt,responses.map(r=>r.evaluation)).state,'ASSESSED');
});
test('large criterion disagreements and opposite removal directions cannot silently become payments',()=>{
 const f=taskFixture(),p=structuredClone(f.evaluations[1].payload);
 p.samples[0].criteria[0].score=50;
 const changed=[f.evaluations[0],seal(p,f.reviewers[1])];
 const q=assessTaskQuality(f.plan,f.receipt,changed);
 assert.equal(q.state,'REVIEWER_DISAGREEMENT');assert(q.disagreements.some(d=>d.type==='CRITERION_SPREAD'));
 assert.throws(()=>settlementManifest({...f.flow,evaluations:changed},f.record,f.review,
  {authority:f.authority.publicKey},f.now+60001),/CHALLENGE/);
 p.samples[0].criteria[0].score=85;
 assert(assessTaskQuality(f.plan,f.receipt,[f.evaluations[0],seal(p,f.reviewers[1])]).disagreements.some(d=>d.type==='MARGINAL_DIRECTION'));
});

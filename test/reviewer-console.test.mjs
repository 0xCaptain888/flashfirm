import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {startReviewerConsole} from '../src/reviewer-console.mjs';
import {taskFixture} from '../test-support/task-flow.mjs';
import {createReviewPackage,blankReview,signHumanReview} from '../src/review-package.mjs';
import {assembleHumanReviews} from '../src/review-assembly.mjs';
import {hash,seal,validSeal} from '../src/protocol.mjs';

test('local reviewer console isolates its key, refuses foreign origins and blank signatures, and signs only the pinned package',async()=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'flashfirm-review-console-')),f=taskFixture();
 await writeFile(path.join(directory,'reviewer-key.json'),JSON.stringify(f.reviewers[0]),{mode:0o600});
 const app=await startReviewerConsole({directory});
 try{
  const session=await(await fetch(app.url+'/api/session')).json();
  assert.equal(session.independenceCertified,false);assert.equal(JSON.stringify(session).includes('privateKey'),false);
  const post=(route,input,extra={})=>fetch(app.url+'/api/'+route,{method:'POST',
   headers:{Origin:app.url,'Content-Type':'application/json','x-flashfirm-csrf':session.csrf,...extra},body:JSON.stringify(input)});
  assert.equal((await post('key',{confirm:'CREATE_MY_OWN_OFFCHAIN_REVIEW_KEY'})).status,400);
  assert.equal((await post('load',{}, {Origin:'https://attacker.example'})).status,403);
  assert.equal((await post('load',{}, {'x-flashfirm-csrf':'wrong'})).status,403);
  const pkg=createReviewPackage(f.flow,f.record,f.review),checks={expectedPlanHash:hash(pkg.plan),expectedBuyerFingerprint:hash(f.buyer.publicKey)};
  assert.equal((await post('load',{package:pkg,...checks,expectedPlanHash:'0'.repeat(64)})).status,400);
  const response=await post('load',{package:pkg,...checks});assert.equal(response.status,200);
  const {draft}=await response.json();assert.equal(draft.decision.verdict,null);
  assert.equal((await post('sign',{...checks,draft,confirm:'I_COMPLETED_THIS_REVIEW_INDEPENDENTLY'})).status,400);
  draft.evaluation=structuredClone(f.evaluations[0].payload);
  for(const sample of draft.evaluation.samples)sample.notes='Synthetic test notes; this test is not actual independent human review.';
  draft.decision=structuredClone(f.review.decisions[0].payload);
  const result=await(await post('sign',{...checks,draft,confirm:'I_COMPLETED_THIS_REVIEW_INDEPENDENTLY'})).json();
  assert(validSeal(result.evaluation,f.reviewers[0].publicKey));assert.equal(result.independenceCertified,false);
  assert(!JSON.stringify(result).includes(f.reviewers[0].privateKey));
  assert.equal(JSON.parse(await readFile(path.join(directory,'reviewer-key.json'),'utf8')).publicKey,f.reviewers[0].publicKey);
 }finally{await app.close();await rm(directory,{recursive:true,force:true});}
});
test('signed human responses assemble without changing signatures and still require external identity and release checks',()=>{
 const f=taskFixture(),pkg=createReviewPackage(f.flow,f.record,f.review);
 const responses=f.reviewers.slice(0,2).map((key,i)=>{
  const draft=blankReview(pkg,key.publicKey);draft.evaluation=structuredClone(f.evaluations[i].payload);
  draft.evaluation.samples.forEach(s=>s.notes='Synthetic notes for an isolated protocol test only.');
  draft.decision=structuredClone(f.review.decisions[i].payload);return signHumanReview(pkg,draft,key,seal);
 });
 const value=assembleHumanReviews(pkg,responses,{certificates:f.certificates,contributions:f.contributions});
 assert.equal(value.assessment.state,'ASSESSED');assert.equal(value.releaseReady,false);
 assert.deepEqual(value.actions[0].input,responses[0].decision);
 assert.throws(()=>assembleHumanReviews(pkg,[responses[0],responses[0]]),/TWO_DISTINCT/);
 const tampered=structuredClone(responses);tampered[0].evaluation.payload.samples[0].criteria[0].score=1;
 assert.throws(()=>assembleHumanReviews(pkg,tampered),/HUMAN_REVIEW/);
});

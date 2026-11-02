import test from 'node:test';
import assert from 'node:assert/strict';
import {identity,seal,hash} from '../src/protocol.mjs';
import {commitPolicy,assessReview,resolveAppeal,selectSignedOffers} from '../src/governance.mjs';
const setup=()=>{const buyer=identity(),worker=identity(),arbiter=identity(),reviewers=[identity(),identity(),identity()];const c=commitPolicy({taskRoot:'a'.repeat(64),buyerKey:buyer.publicKey,workerKeys:[worker.publicKey],appealKey:arbiter.publicKey,reviewers:reviewers.map((k,i)=>({key:k.publicKey,operator:`org-${i}`})),expiresAt:1000000,appealWindowMs:60000});const decision=(i,verdict='APPROVE',root='b'.repeat(64))=>seal({version:'flashfirm-decision/1',policyHash:c.digest,taskRoot:c.policy.taskRoot,resultRoot:root,verdict,issuedAt:100,reason:'Reviewed source evidence'},reviewers[i]);return {buyer,worker,arbiter,reviewers,c,decision};};
test('reviewer quorum, appeal delay, signed task and result bindings',()=>{
 const {c,decision}=setup();const root='b'.repeat(64);
 assert.equal(assessReview(c,root,[decision(0)],200).state,'AWAITING_QUORUM');
 assert.equal(assessReview(c,root,[decision(0),decision(1)],200).state,'APPROVED_PENDING_APPEAL');
 assert.equal(assessReview(c,root,[decision(0),decision(1)],60200).state,'RELEASE_ELIGIBLE');
 assert.throws(()=>assessReview(c,root,[decision(0),decision(0)],200));
 assert.throws(()=>assessReview(c,root,[decision(0,'APPROVE','c'.repeat(64))],200));
 assert.equal(assessReview(c,root,[decision(0),decision(1),decision(2,'CHALLENGE')],60200).state,'DISPUTED');
});
test('conflicted identity refused and policy cannot be changed after commitment',()=>{
 const {c}=setup();const p=structuredClone(c.policy);p.reviewers[0].key=p.buyerKey;assert.throws(()=>commitPolicy(p));
 const changed=structuredClone(c);changed.policy.appealWindowMs++;assert.throws(()=>assessReview(changed,'b'.repeat(64),[],200));
});
test('only pinned appeal identity can resolve a timely participant appeal',()=>{
 const {c,decision,buyer,arbiter}=setup(),assessment=assessReview(c,'b'.repeat(64),[decision(0),decision(1,'CHALLENGE')],200);
 const appeal=seal({version:'flashfirm-appeal/1',policyHash:c.digest,reviewHash:assessment.reviewHash,issuedAt:300,reason:'Incorrect quotation interpretation'},buyer);
 const payload={version:'flashfirm-resolution/1',appealHash:hash(appeal),reviewHash:assessment.reviewHash,issuedAt:400,verdict:'REWORK',reason:'Source does not support conclusion'};
 const decisions=[decision(0),decision(1,'CHALLENGE')];
 assert.throws(()=>resolveAppeal(c,'b'.repeat(64),decisions,appeal,seal(payload,buyer),500));
 assert.equal(resolveAppeal(c,'b'.repeat(64),decisions,appeal,seal(payload,arbiter),500).state,'REWORK_REQUIRED');
});
test('signed tender optimizes complete team, rejects stale and untrusted offers',()=>{
 const keys=[identity(),identity(),identity()],caps=[['research'],['review'],['research','review']],taskRoot='d'.repeat(64);
 const trustedProviders=keys.map((k,i)=>({key:k.publicKey,operator:`provider${i}`,capabilities:caps[i]}));
 const offers=keys.map((k,i)=>seal({version:'flashfirm-offer/1',taskRoot,capabilities:caps[i],priceMinor:[60,70,100][i],expiresAt:1000},k));
 const input={taskRoot,requirements:['research','review'],budget:120,offers,trustedProviders,now:1};
 const result=selectSignedOffers(input);assert.equal(result.cost,100);assert.equal(result.team.length,1);
 assert.throws(()=>selectSignedOffers({...input,now:1001}));assert.throws(()=>selectSignedOffers({...input,offers:[...offers,offers[0]]}));
 assert.throws(()=>selectSignedOffers({...input,trustedProviders:trustedProviders.slice(1)}));
});

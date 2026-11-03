import test from 'node:test';
import assert from 'node:assert/strict';
import {taskFixture} from '../test-support/task-flow.mjs';
import {evaluateTaskWithModel} from '../src/model-evaluation.mjs';
test('semantic/removal model runner recomputes all four samples without claiming independent or confidential inference',async()=>{
 const f=taskFixture(),calls=[],progress=[];
 const provider={async complete(messages,purpose){
  const input=JSON.parse(messages[1].content);calls.push({input,purpose});
  return {callId:'test-'+calls.length,model:'unit-test-only',result:{
   criteria:[{id:'source-support',score:input.materials.length*30}],
   claims:input.claims.map(c=>({workerId:c.workerId,claimIndex:c.claimIndex,verdict:'SUPPORTED',reason:'Synthetic testing response with enough explanation.'}))
  }};
 }};
 const r=await evaluateTaskWithModel('/unused',f.plan,f.receipt,{provider,preflight:async()=>{},onProgress:p=>progress.push(p.completed)});
 assert.deepEqual(calls.map(c=>c.input.materials.length),[3,2,2,2]);assert.deepEqual(progress,[1,2,3,4]);
 assert.equal(r.payload.claims.length,9);assert.equal(r.requiresPinnedReviewerSignature,true);
 assert.equal(r.independentOperator,false);assert.equal(r.confidentialInferenceVerified,false);
});
test('insufficient cumulative allowance blocks before a provider call, and paid interruptions never retry',async()=>{
 const f=taskFixture();let calls=0;
 const provider={async complete(){calls++;throw Error('PROVIDER_INTERRUPTED');}};
 await assert.rejects(evaluateTaskWithModel('/unused',f.plan,f.receipt,{provider,preflight:async()=>{throw Error('INSUFFICIENT_BUDGET');}}),/BUDGET/);
 assert.equal(calls,0);
 await assert.rejects(evaluateTaskWithModel('/unused',f.plan,f.receipt,{provider,preflight:async()=>{}}),/INTERRUPTED/);
 assert.equal(calls,1);
});
test('confidential task mode cannot release source material to a remote commercial model',async()=>{
 const f=taskFixture();let touched=false;
 const plan=structuredClone(f.plan);plan.payload.privacyMode='CONFIDENTIAL_QUOTATIONS';
 await assert.rejects(evaluateTaskWithModel('/unused',plan,f.receipt,{
  provider:{complete:async()=>{touched=true;}},preflight:async()=>{touched=true;}
 }),/PRIVATE_MATERIAL/);
 assert.equal(touched,false);
});
test('tampered or expired buyer plans are refused before touching the budget or provider',async()=>{
 const f=taskFixture();let touched=false;
 const plan=structuredClone(f.plan);plan.payload.budgetUnits++;
 await assert.rejects(evaluateTaskWithModel('/unused',plan,f.receipt,{
  provider:{complete:async()=>{touched=true;}},preflight:async()=>{touched=true;}
 }),/VALID_UNEXPIRED_BUYER_PLAN/);
 assert.equal(touched,false);
});

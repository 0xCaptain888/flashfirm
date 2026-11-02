import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {WorkspaceStore} from '../src/workspace-store.mjs';
import {identity} from '../src/protocol.mjs';
test('reviewer enrollment is owner-scoped, expiring and consumes each challenge once',async()=>{
  let now=1000000;const store=new WorkspaceStore(':memory:',randomBytes(32),()=>now);
  try{
    const challenge=store.reviewerChallenge('owner',{accountId:'review.testnet',reviewerKey:identity().publicKey,policyHash:'a'.repeat(64)},'https://service.example');
    const envelope={reviewerSeal:{payload:challenge}};
    const verifier=async()=>({verified:true,accountId:challenge.accountId,policyHash:challenge.policyHash,independentOperatorVerified:false});
    await assert.rejects(store.bindReviewer('other',envelope,verifier),/Unknown/);
    await assert.rejects(store.bindReviewer('owner',envelope,async()=>{throw Error('bad signature');}),/bad signature/);
    const results=await Promise.allSettled([store.bindReviewer('owner',envelope,verifier),store.bindReviewer('owner',envelope,verifier)]);
    assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
    assert.equal(store.reviewerBindings('owner').length,1);assert.equal(store.reviewerBindings('other').length,0);
    await assert.rejects(store.bindReviewer('owner',envelope,verifier));
    const expired=store.reviewerChallenge('owner',{accountId:'next.testnet',reviewerKey:identity().publicKey,policyHash:'a'.repeat(64)},'https://service.example');
    now+=300001;await assert.rejects(store.bindReviewer('owner',{reviewerSeal:{payload:expired}},verifier));
  }finally{store.close();}
});

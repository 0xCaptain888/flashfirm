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
test('reviewer revocation is owner-scoped and wins over an in-flight recheck',async()=>{
  const store=new WorkspaceStore(':memory:',randomBytes(32));
  try{
    const record={accountId:'review.testnet',policyHash:'a'.repeat(64),nearPublicKey:'public-test-key',verified:true};
    store.db.prepare('INSERT INTO reviewer_bindings VALUES(?,?,?,?)').run('owner',record.accountId,record.policyHash,JSON.stringify(record));
    const first=await store.recheckReviewer('owner',record,async()=>({accountKeyPresent:true}));
    assert.equal(first.accountKeyPresent,true);
    assert.throws(()=>store.revokeReviewer('other',{...record,reason:'conflict'}));
    await assert.rejects(store.recheckReviewer('owner',record,async()=>{store.revokeReviewer('owner',{...record,reason:'Conflict identified'});return {accountKeyPresent:true};}),/revoked/);
    await assert.rejects(store.recheckReviewer('owner',record,async()=>({accountKeyPresent:true})),/revoked/);
    assert.equal(store.reviewerBindings('owner')[0].revocationReason,'Conflict identified');
  }finally{store.close();}
});

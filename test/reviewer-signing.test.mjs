import test from 'node:test';
import assert from 'node:assert/strict';
import { createPublicKey } from 'node:crypto';
import { identity } from '../src/protocol.mjs';
import { base58 } from '../src/near-deployment.mjs';
import { signReviewerChallenge } from '../src/reviewer-signing.mjs';
import { verifyReviewerBinding } from '../src/reviewer-binding.mjs';
import { FlashFirmClient } from '../src/client.mjs';

function fixture() {
  const reviewer=identity(), account=identity(), now=1000000;
  const nearPublicKey='ed25519:'+base58(createPublicKey(account.publicKey).export({format:'der',type:'spki'}).subarray(-32));
  const expected={accountId:'review.testnet',audience:'https://flashfirm.example',policyHash:'b'.repeat(64),nearPublicKey};
  const challenge={accountId:expected.accountId,audience:expected.audience,policyHash:expected.policyHash,reviewerKey:reviewer.publicKey,version:'flashfirm-reviewer-binding/1',network:'testnet',nonce:'a'.repeat(64),issuedAt:now-100,expiresAt:now+100000};
  return {reviewer,account,now,expected,challenge};
}
test('offline signing produces a binding accepted by the server verifier',async()=>{
  const f=fixture(), envelope=signReviewerChallenge(f.challenge,f.expected,f.reviewer.privateKey,f.account.privateKey,f.now);
  const rpc=async method=>method==='status'?{chain_id:'testnet'}:method==='block'?{header:{hash:'block',timestamp_nanosec:String(BigInt(f.now)*1000000n)}}:{block_hash:'block',keys:[{public_key:f.expected.nearPublicKey,access_key:{permission:'FullAccess'}}]};
  const result=await verifyReviewerBinding(envelope,f.challenge,rpc,f.now);
  assert.equal(result.verified,true);
  assert.equal(result.independentOperatorVerified,false);
  assert.ok(!JSON.stringify(envelope).includes('PRIVATE KEY'));
});
test('offline signing refuses altered context, extra fields, expiry and wrong keys',()=>{
  const f=fixture(), run=(c=f.challenge,e=f.expected,r=f.reviewer.privateKey,a=f.account.privateKey)=>signReviewerChallenge(c,e,r,a,f.now);
  for(const patch of [{accountId:'attacker.testnet'},{audience:'https://evil.example'},{policyHash:'c'.repeat(64)},{network:'mainnet'},{expiresAt:f.now},{issuedAt:f.now+1},{transaction:{actions:[]}},{nonce:'bad'}])assert.throws(()=>run({...f.challenge,...patch}));
  assert.throws(()=>run(f.challenge,f.expected,identity().privateKey));
  assert.throws(()=>run(f.challenge,f.expected,f.reviewer.privateKey,identity().privateKey));
  assert.throws(()=>run(f.challenge,{...f.expected,nearPublicKey:'bad'}));
});
test('reviewer SDK preserves response errors without retrying uncertain writes',async()=>{
  const calls=[];
  const client=new FlashFirmClient({baseUrl:'https://flashfirm.example',token:'test',fetchImpl:async(url,options)=>{calls.push({url,options});return {ok:false,status:409,json:async()=>({error:'Already consumed'})};}});
  await assert.rejects(client.bindReviewer({reviewerSeal:{}}),error=>error.status===409);
  assert.equal(calls.length,1);
  assert.equal(calls[0].url,'https://flashfirm.example/api/workspaces/reviewer-bindings');
  assert.equal(calls[0].options.redirect,'error');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {verifyMainnetEvidence} from '../scripts/verify-mainnet-payment.mjs';

const evidence=JSON.parse(await readFile(new URL('../evidence/mainnet-native-payment.json',import.meta.url),'utf8'));
const copy=()=>structuredClone(evidence);

test('recorded real mainnet payment replays the signed order, exact source and final native-USDC delivery',async()=>{
  const result=await verifyMainnetEvidence(copy());
  assert.equal(result.verified,true);
  assert.equal(result.origin.amount,'500000000000000000000000');
  assert.equal(result.delivery.amount,'1861840');
  assert.equal(result.verificationMode,'RECORDED_RPC_SNAPSHOTS');
  assert.equal(result.automaticTaskPayout,false);
  assert.equal(result.testnetTreasuryLinked,false);
});

test('recorded payment rejects quote/source substitution, failed receipts and relay-only success',async()=>{
  for(const change of [
    p=>{p.quote.quote.minAmountOut='1';},
    p=>{p.sourceHash='3'.repeat(44);},
    p=>{p.sourceOutcome.transaction.actions[0].Transfer.deposit='1';},
    p=>{p.sourceOutcome.transaction.receiver_id='other.near';},
    p=>{p.sourceOutcome.receipts_outcome[0].outcome.status={Failure:{}};},
    p=>{p.relay.status='PENDING_DEPOSIT';},
    p=>{p.relay.swapDetails.originChainTxHashes=[];},
    p=>{p.relay.swapDetails.amountOut='1';},
    p=>{p.policy.maximumExtraNear='900000000000000000000000';},
    p=>{p.created=1;}
  ]){
    const proof=copy();change(proof);
    await assert.rejects(verifyMainnetEvidence(proof));
  }
});

test('a finalized unrelated, underpaid or redirected ERC-20 transaction cannot prove delivery',async()=>{
  const recipientLog=proof=>proof.destinationSnapshot.receipt.logs.find(l=>
    l.address.toLowerCase()===proof.policy.token&&
    l.topics[2]?.toLowerCase()==='0x'+'0'.repeat(24)+proof.policy.recipient.slice(2));
  for(const change of [
    p=>{p.destinationSnapshot.chainId='0x1';},
    p=>{p.destinationSnapshot.receipt.status='0x0';},
    p=>{p.destinationSnapshot.finalized.number='0x1';},
    p=>{p.destinationSnapshot.block.hash='0x'+'1'.repeat(64);},
    p=>{recipientLog(p).topics[2]='0x'+'0'.repeat(64);},
    p=>{recipientLog(p).data='0x'+'0'.repeat(63)+'1';},
    p=>{recipientLog(p).removed=true;}
  ]){
    const proof=copy();change(proof);
    await assert.rejects(verifyMainnetEvidence(proof));
  }
});

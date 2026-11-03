import test from 'node:test';
import assert from 'node:assert/strict';
import {nativePreflight,validateNativeOutcome} from '../src/native-payment.mjs';
import {paymentPolicy as policy} from '../src/mainnet-payment.mjs';
const now=Date.now(),deposit='1'.repeat(64),hash='2'.repeat(44);
const fixture=()=>({quote:{quote:{depositAddress:deposit,deadline:new Date(now+600000).toISOString()},
  quoteRequest:{deadline:new Date(now+600000).toISOString()}},sourceHash:hash});
function outcome(){
  return {final_execution_status:'FINAL',status:{SuccessValue:''},
    transaction:{hash,signer_id:policy.signer,receiver_id:deposit,actions:[{Transfer:{deposit:policy.amount}}]},
    transaction_outcome:{outcome:{tokens_burnt:'100'}},receipts_outcome:[{outcome:{tokens_burnt:'50',status:{SuccessValue:''}}}]};
}
test('native recovery requires the exact final source, amount and receiver; contract calls cannot masquerade as transfers',()=>{
  assert.equal(validateNativeOutcome(outcome(),fixture()).sourceFeeYocto,'150');
  for(const change of [
    x=>{x.transaction.signer_id='attacker.near';},
    x=>{x.transaction.receiver_id='attacker.near';},
    x=>{x.transaction.actions[0].Transfer.deposit='1';},
    x=>{x.transaction.actions.push({Transfer:{deposit:'1'}});},
    x=>{x.transaction.actions=[{FunctionCall:{method_name:'near_deposit'}}];},
    x=>{x.final_execution_status='EXECUTED_OPTIMISTIC';},
    x=>{x.receipts_outcome[0].outcome.status={Failure:{}};},
    x=>{x.transaction_outcome.outcome.tokens_burnt='-1';},
    x=>{delete x.transaction_outcome.outcome.tokens_burnt;},
    x=>{x.transaction_outcome.outcome.tokens_burnt=String(BigInt(policy.maximumExtraNear)+1n);}
  ]){
    const result=outcome();change(result);
    assert.throws(()=>validateNativeOutcome(result,fixture()));
  }
});
test('native preflight rejects repeat handoffs, stale deadlines and insufficient balance',async()=>{
  const j=fixture();j.sourceHash=null;
  const rpc=async(method)=>method==='status'?{chain_id:'mainnet'}:
    method==='block'?{header:{hash:'block',timestamp_nanosec:String(BigInt(now)*1000000n)}}:
      {block_hash:'block',amount:'2000000000000000000000000',storage_usage:182};
  const p=await nativePreflight(j,rpc,now);
  assert.equal(p.method,'sendMoney');assert.equal(p.amount,policy.amount);
  await assert.rejects(nativePreflight({...j,handoffAt:now},rpc,now),/HANDED/);
  await assert.rejects(nativePreflight(j,rpc,now+600000),/EXPIRED/);
  const malformed=structuredClone(j);malformed.quote.quote.deadline='invalid';
  await assert.rejects(nativePreflight(malformed,rpc,now),/EXPIRED/);
  await assert.rejects(nativePreflight(j,async m=>m==='query'?{block_hash:'block',amount:policy.amount,storage_usage:182}:rpc(m),now),/INSUFFICIENT/);
});

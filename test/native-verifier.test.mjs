import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {nativeFixture} from '../test-support/native-task.mjs';
import {validateNativeSettlement,verifyNativeTaskSettlement} from '../src/native-task-settlement.mjs';
import {executeNativeClaims} from '../src/native-claim-queue.mjs';
import {base58} from '../src/near-deployment.mjs';
const wasm=readFileSync(new URL('../artifacts/flashfirm_treasury.wasm',import.meta.url));
function fixture(){
 const f=nativeFixture(),v=validateNativeSettlement(f.authorization,f.flow,f.nativeNow);
 const status={version:'flashfirm-treasury/0.2',...v.plan.init,arbitration_deadline_ns:v.plan.arbitrationDeadlineNs,
  plan_hash:v.planHash,evidence_root:v.evidenceRoot,funded_yocto:v.budgetYocto,paid_yocto:v.budgetYocto,
  phase:'Closed',credits_yocto:v.amountsYocto.map(()=>'0'),pending_yocto:v.amountsYocto.map(()=>'0'),approvals:[true,true,false]};
 let count=1;const next=()=>base58(Buffer.alloc(32,++count)),transactions=new Map();
 const tx=(actor,method,args,deposit='0')=>{
  const hash=next(),receiptId='transfer-'+hash;
  transactions.set(hash,{final_execution_status:'FINAL',transaction:{hash,signer_id:actor,
   receiver_id:v.plan.contractId,actions:[{FunctionCall:{method_name:method,args:Buffer.from(JSON.stringify(args)).toString('base64'),
    gas:'100000000000000',deposit}}]},transaction_outcome:{block_hash:'final-block',outcome:{receipt_ids:[receiptId],status:{SuccessReceiptId:receiptId}}},
   receipts:method==='claim_for'?[{receipt_id:receiptId,predecessor_id:v.plan.contractId,receiver_id:args.recipient,
    receipt:{Action:{actions:[{Transfer:{deposit:v.amountsYocto[v.plan.init.recipients.indexOf(args.recipient)]}}]}}}]:[],
   receipts_outcome:[{id:receiptId,outcome:{executor_id:args.recipient??v.plan.contractId,receipt_ids:[],status:{SuccessValue:''}}}],
   status:{SuccessValue:method==='claim_for'?Buffer.from('true').toString('base64'):''}});
  return hash;
 };
 const proof={fund:tx(v.plan.init.buyer,'fund',{},v.budgetYocto),
  propose:tx(v.plan.init.buyer,'propose',{amounts_yocto:v.amountsYocto,evidence_root:v.evidenceRoot}),
  approvals:v.plan.init.evaluators.slice(0,2).map(accountId=>({accountId,hash:tx(accountId,'approve',{plan_hash:v.planHash})})),
  claims:v.plan.init.recipients.filter((r,i)=>v.amountsYocto[i]!=='0').map(recipient=>({recipient,hash:tx(v.relayer,'claim_for',{recipient})}))};
 const rpc=async(method,params)=>{
  if(method==='status')return {chain_id:'testnet'};
  if(method==='block')return {header:{hash:'final-block',height:100,timestamp_nanosec:String(BigInt(f.nativeNow+1)*1000000n)}};
  if(['tx','EXPERIMENTAL_tx_status'].includes(method))return transactions.get(params.tx_hash);
  if(params.request_type==='view_code')return {block_hash:'final-block',hash:base58(Buffer.from(f.nativePayload.wasmSha256,'hex')),code_base64:wasm.toString('base64')};
  return {block_hash:'final-block',result:[...Buffer.from(JSON.stringify(status))]};
 };
 return {...f,v,status,proof,transactions,rpc};
}
test('native verifier checks every final action and callback, exact code and the report-specific manifest',async()=>{
 const f=fixture(),proof=await verifyNativeTaskSettlement(f.authorization,f.flow,f.proof,f.rpc,f.nativeNow+2);
 assert.equal(proof.transactions.length,9);assert.equal(proof.mainnetPayment,false);
 assert.equal(proof.manifestHash,f.v.manifestHash);
 for(const mutate of [
  f=>f.transactions.get(f.proof.claims[0].hash).status.SuccessValue=Buffer.from('false').toString('base64'),
  f=>f.transactions.get(f.proof.claims[0].hash).transaction.actions[0].FunctionCall.args=Buffer.from('{"recipient":"thief.testnet"}').toString('base64'),
  f=>f.proof.approvals[1].accountId=f.proof.approvals[0].accountId,
  f=>f.status.paid_yocto='0',f=>f.proof.claims.pop()
  ,f=>f.transactions.get(f.proof.claims[0].hash).receipts[0].receipt.Action.actions[0].Transfer.deposit='1'
  ,f=>f.transactions.get(f.proof.claims[0].hash).receipts[0].receiver_id='thief.testnet'
  ,f=>f.transactions.get(f.proof.claims[0].hash).receipts=[]
  ,f=>f.transactions.get(f.proof.claims[0].hash).transaction_outcome.outcome.receipt_ids=[]
 ]){
  const x=fixture();mutate(x);
  await assert.rejects(verifyNativeTaskSettlement(x.authorization,x.flow,x.proof,x.rpc,x.nativeNow+2));
 }
 const codeForged=async(m,p)=>m==='query'&&p.request_type==='view_code'?{block_hash:'final-block',code_base64:'ZmFrZQ=='}:f.rpc(m,p);
 await assert.rejects(verifyNativeTaskSettlement(f.authorization,f.flow,f.proof,codeForged,f.nativeNow+2),/WASM/);
 const sandbox=async(m,p)=>m==='status'?{chain_id:'sandbox'}:f.rpc(m,p);
 await assert.rejects(verifyNativeTaskSettlement(f.authorization,f.flow,f.proof,sandbox,f.nativeNow+2),/TESTNET/);
});
test('native claim queue persists dispatch before send and refuses an ambiguous retry',async()=>{
 const f=fixture();
 f.status.phase='Approved';f.status.release_allowed=true;f.status.paid_yocto='0';
 f.status.credits_yocto=[...f.v.amountsYocto];
 f.flow.nativeSettlement={authorization:f.authorization};
 const intents=new Map(),events=[];
 const journal={reserve:async(id,entry)=>{if(intents.has(id))throw Error('EXCLUSIVE_INTENT_EXISTS');
  intents.set(id,entry);events.push('reserved');},record:async()=>events.push('recorded')};
 let sends=0;
 const send=async()=>{sends++;events.push('send');throw Error('CONNECTION_LOST_AFTER_DISPATCH');};
 const input={flow:f.flow,rpc:f.rpc,journal,send,now:()=>f.nativeNow};
 await assert.rejects(executeNativeClaims(input),/CONNECTION_LOST/);
 assert.deepEqual(events,['reserved','send']);assert.equal(sends,1);
 await assert.rejects(executeNativeClaims(input),/EXCLUSIVE_INTENT/);assert.equal(sends,1);
});

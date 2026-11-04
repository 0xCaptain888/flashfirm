import {taskFixture} from './task-flow.mjs';
import {settlementManifest} from '../src/task-settlement.mjs';
import {hash,seal} from '../src/protocol.mjs';
import {NATIVE_TREASURY_SHA256} from '../src/native-task-settlement.mjs';
export function nativeFixture(network='testnet'){
 const f=taskFixture({settlementPolicy:{version:'flashfirm-allocation-policy/2',spendUnits:800000,
  feeBps:200,feeRecipient:'0x'+'a'.repeat(40),refundRecipient:'0x'+'b'.repeat(40)}});
 f.flow.manifest=settlementManifest(f.flow,f.record,f.review,{authority:f.authority.publicKey},f.now+60001);
 const ids=['buyer.testnet','worker-a.testnet','worker-b.testnet','worker-c.testnet','fee.testnet'];
 const accounts=f.flow.manifest.obligations.map(o=>({obligationId:o.id,accountId:o.kind==='UNSPENT_REFUND'?ids[0]:
  o.kind==='PROTOCOL_FEE'?ids[4]:ids[f.flow.manifest.payouts.findIndex(w=>w.id===o.workerId)+1]}));
 const payload={version:'flashfirm-native-settlement/1',network:'testnet',taskRoot:f.record.taskRoot,
  resultRoot:f.record.receiptHash,manifestHash:hash(f.flow.manifest),wasmSha256:NATIVE_TREASURY_SHA256,
  relayer:'sponsor.testnet',nativeBudgetYocto:'1000000000000000000000',accounts,
  issuedAt:f.now+60002,expiresAt:f.now+1800000,config:{network:'testnet',contractId:'treasury.testnet',init:{
   buyer:ids[0],evaluators:['review-a.testnet','review-b.testnet','review-c.testnet'],recipients:ids,
   task_root:f.record.taskRoot,policy_hash:f.plan.payload.reviewPolicyHash,deadline_ns:String(BigInt(f.now+1800000)*1000000n),
   arbiter:'arbiter.testnet',appeal_window_ns:'60000000000',arbitration_window_ns:'60000000000'}}};
 if(network==='mainnet'){
  payload.version='flashfirm-native-settlement/2';payload.network='mainnet';payload.config.network='mainnet';
  payload.asset='NATIVE_NEAR';payload.requireLockedContract=true;payload.noFxConversion=true;payload.commonEscrowBudget=true;
  payload.relayer=payload.relayer.replace('.testnet','.near');
  payload.config.contractId=payload.config.contractId.replace('.testnet','.near');
  for(const field of ['buyer','arbiter'])payload.config.init[field]=payload.config.init[field].replace('.testnet','.near');
  for(const field of ['evaluators','recipients'])payload.config.init[field]=payload.config.init[field].map(v=>v.replace('.testnet','.near'));
  for(const row of payload.accounts)row.accountId=row.accountId.replace('.testnet','.near');
 }
 return {...f,nativePayload:payload,authorization:seal(payload,f.buyer),nativeNow:f.now+60002};
}

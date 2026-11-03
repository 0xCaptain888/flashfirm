import {createHash} from 'node:crypto';
import {hash} from './protocol.mjs';
import {validateNativeSettlement,nativeDispatchPreview,NATIVE_TREASURY_SHA256} from './native-task-settlement.mjs';
import {checkTransaction} from './treasury-policy.mjs';
// journal.reserve MUST be atomic and durable before send. Any uncertain result
// retains the reservation: a restart cannot silently replay a financial call.
export async function executeNativeClaims({flow,rpc,journal,send,now=Date.now}){
 const envelope=flow.nativeSettlement?.authorization;
 const v=validateNativeSettlement(envelope,flow,now()),completed=[];
 if((await rpc('status',[])).chain_id!=='testnet')throw Error('CLAIM_QUEUE_TESTNET_ONLY');
 for(const part of v.parts){
  const recipient=envelope.payload.accounts.find(a=>a.obligationId===part.obligationId).accountId;
  const head=await rpc('block',{finality:'final'}),block_id=head.header.hash;
  const code=await rpc('query',{request_type:'view_code',block_id,account_id:v.plan.contractId});
  if(code.block_hash!==block_id||createHash('sha256').update(Buffer.from(code.code_base64??'','base64')).digest('hex')!==NATIVE_TREASURY_SHA256)
   throw Error('CLAIM_QUEUE_UNPINNED_CODE');
  const response=await rpc('query',{request_type:'call_function',block_id,account_id:v.plan.contractId,method_name:'get_status',args_base64:'e30='});
  if(response.block_hash!==block_id)throw Error('CLAIM_QUEUE_BLOCK_MISMATCH');
  const status=JSON.parse(Buffer.from(response.result).toString());
  const candidates=nativeDispatchPreview(envelope,flow,status,BigInt(head.header.timestamp_nanosec),now());
  const action=candidates.find(a=>a.actions[0].params.args.recipient===recipient);
  if(!action)continue;
  const intentId=hash({authorization:v.authorizationHash,obligation:part.obligationId});
  // No automatic retry of a failed callback either. Reconciliation must inspect
  // the recorded hash and authorize a new attempt outside this queue.
  await journal.reserve(intentId,{authorizationHash:v.authorizationHash,obligationId:part.obligationId,
   recipient,amountYocto:part.amountYocto,action,state:'DISPATCH_RESERVED'});
  const outcome=await send(action);
  if(!outcome?.transaction?.hash)throw Error('CLAIM_OUTCOME_UNCERTAIN_RECONCILE');
  await journal.record(intentId,{hash:outcome.transaction.hash,state:'HASH_RECORDED'});
  checkTransaction(outcome,action);
  await journal.record(intentId,{hash:outcome.transaction.hash,state:'CALLBACK_CONFIRMED'});
  completed.push({obligationId:part.obligationId,recipient,hash:outcome.transaction.hash});
 }
 return {network:'testnet',completed,taskSettlementComplete:false,
  next:'Submit all funding, proposal, reviewer and claim hashes to flow/native-verify; queue dispatch alone is not settlement proof.'};
}

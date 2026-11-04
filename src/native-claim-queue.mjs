import {createHash} from 'node:crypto';
import {hash} from './protocol.mjs';
import {validateNativeSettlement,nativeDispatchPreview,NATIVE_TREASURY_SHA256,requireLockedNativeTreasury} from './native-task-settlement.mjs';
import {checkTransaction} from './treasury-policy.mjs';
// journal.reserve MUST be atomic and durable before send. Any uncertain result
// retains the reservation: a restart cannot silently replay a financial call.
export async function executeNativeClaims({flow,rpc,journal,send,executionPolicy,now=Date.now}){
 const envelope=flow.nativeSettlement?.authorization;
 const v=validateNativeSettlement(envelope,flow,now()),completed=[];
 if(v.network==='mainnet')validateEscrowExecutionPolicy(executionPolicy,v,now());
 if((await rpc('status',[])).chain_id!==v.network)throw Error('CLAIM_QUEUE_NETWORK_MISMATCH');
 for(const part of v.parts){
  if(v.network==='mainnet')validateEscrowExecutionPolicy(executionPolicy,v,now());
  const recipient=envelope.payload.accounts.find(a=>a.obligationId===part.obligationId).accountId;
  const head=await rpc('block',{finality:'final'}),block_id=head.header.hash;
  const code=await rpc('query',{request_type:'view_code',block_id,account_id:v.plan.contractId});
  if(code.block_hash!==block_id||createHash('sha256').update(Buffer.from(code.code_base64??'','base64')).digest('hex')!==NATIVE_TREASURY_SHA256)
   throw Error('CLAIM_QUEUE_UNPINNED_CODE');
  if(v.network==='mainnet')await requireLockedNativeTreasury(rpc,v.plan.contractId,block_id);
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
 return {network:v.network,completed,taskSettlementComplete:false,
  next:'Submit all funding, proposal, reviewer and claim hashes to flow/native-verify; queue dispatch alone is not settlement proof.'};
}
// Local operator configuration, never an HTTP body or permission inferred from
// the buyer's application signature. It sponsors gas only for this exact run.
export function validateEscrowExecutionPolicy(policy,v,now=Date.now()){
 if(policy?.version!=='flashfirm-escrow-execution/1'||policy.enabled!==true||
  policy.network!=='mainnet'||v.network!=='mainnet'||policy.authorizationHash!==v.authorizationHash||
  policy.contractId!==v.plan.contractId||policy.relayer!==v.relayer||
  policy.wasmSha256!==NATIVE_TREASURY_SHA256||policy.nativeBudgetYocto!==v.budgetYocto||
  policy.maximumCalls!==v.parts.length||policy.gasPerCall!=='100000000000000'||
  !Number.isSafeInteger(policy.expiresAt)||policy.expiresAt<=now||policy.expiresAt>v.expiresAt)
  throw Error('EXACT_LOCAL_MAINNET_EXECUTION_APPROVAL_REQUIRED');
 return policy;
}

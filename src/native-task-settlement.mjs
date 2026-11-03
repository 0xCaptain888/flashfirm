import {createHash} from 'node:crypto';
import {hash,validSeal} from './protocol.mjs';
import {prepareTestnet,pinnedMismatches,checkTransaction,treasuryAction} from './treasury-policy.mjs';
import {base58} from './near-deployment.mjs';
const positive=v=>typeof v==='string'&&/^[1-9]\d{0,24}$/.test(v);
const named=v=>typeof v==='string'&&v.length<=64&&/^(?:[a-z0-9]+(?:[-_][a-z0-9]+)*\.)+testnet$/.test(v);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
// Operator-pinned artifact tested by the existing treasury sandbox suite.
// A buyer cannot substitute a different contract that merely reports "paid".
export const NATIVE_TREASURY_SHA256='369c28bab8da8c4ee32222f179c746072e307a4a12c56bcc730b3911553491dd';
export function nativeAllocation(manifest,amount){
  if(manifest.version!=='flashfirm-settlement-manifest/2'||!manifest.obligations?.length||
    !positive(amount)||BigInt(amount)>10n**22n)throw Error('BOUNDED_V2_NATIVE_ALLOCATION_REQUIRED');
  const total=manifest.obligations.reduce((n,o)=>n+o.amount,0);
  if(total!==manifest.budgetUnits||total<1)throw Error('OBLIGATION_BUDGET_NOT_CONSERVED');
  const parts=manifest.obligations.map(o=>({obligationId:o.id,
    amount:BigInt(amount)*BigInt(o.amount)/BigInt(total),
    remainder:BigInt(amount)*BigInt(o.amount)%BigInt(total)}));
  let left=BigInt(amount)-parts.reduce((n,o)=>n+o.amount,0n);
  const order=[...parts].sort((a,b)=>a.remainder===b.remainder?a.obligationId.localeCompare(b.obligationId):a.remainder>b.remainder?-1:1);
  for(const p of order)if(left-->0n)p.amount++;
  if(parts.some(p=>p.amount===0n))throw Error('NATIVE_BUDGET_TOO_SMALL_FOR_EACH_OBLIGATION');
  return parts.map(({obligationId,amount})=>({obligationId,amountYocto:String(amount)}));
}
// A separate buyer signature approves actual NEAR amounts. USDC allocation
// weights do not constitute a market FX quote or mainnet payment.
export function validateNativeSettlement(envelope,flow,now=Date.now()){
  const p=envelope?.payload,m=flow.manifest;
  if(!m||!validSeal(envelope,flow.plan.payload.buyerKey)||p?.version!=='flashfirm-native-settlement/1'||
    p.network!=='testnet'||p.manifestHash!==hash(m)||p.taskRoot!==m.taskRoot||p.resultRoot!==m.resultRoot||
    p.wasmSha256!==NATIVE_TREASURY_SHA256||!named(p.relayer)||
    !Number.isSafeInteger(p.issuedAt)||p.issuedAt>now||p.issuedAt<flow.plan.payload.createdAt||
    !Number.isSafeInteger(p.expiresAt)||p.expiresAt<=now||p.expiresAt>flow.plan.payload.expiresAt)
    throw Error('EXACT_BUYER_NATIVE_AUTHORIZATION_REQUIRED');
  const plan=prepareTestnet(p.config,BigInt(p.issuedAt)*1000000n);
  if(plan.init.task_root!==m.taskRoot||plan.init.policy_hash!==flow.plan.payload.reviewPolicyHash||
    BigInt(plan.init.deadline_ns)<BigInt(p.expiresAt)*1000000n||
    !Array.isArray(p.accounts)||p.accounts.length!==m.obligations.length||
    new Set(p.accounts.map(a=>a.obligationId)).size!==p.accounts.length)
    throw Error('NATIVE_TASK_OR_ROLE_BINDING_MISMATCH');
  const parts=nativeAllocation(m,p.nativeBudgetYocto);
  const amounts=plan.init.recipients.map(()=>0n);
  for(const o of m.obligations){
    const row=p.accounts.find(a=>a.obligationId===o.id),index=plan.init.recipients.indexOf(row?.accountId);
    if(index<0||!named(row.accountId)||(o.kind==='UNSPENT_REFUND'&&row.accountId!==plan.init.buyer)||
      (o.kind!=='UNSPENT_REFUND'&&row.accountId===plan.init.buyer))
      throw Error('EXACT_NATIVE_RECIPIENT_MAPPING_REQUIRED');
    if(amounts[index]!==0n)throw Error('DISTINCT_NATIVE_OBLIGATION_RECIPIENTS_REQUIRED');
    amounts[index]=BigInt(parts.find(a=>a.obligationId===o.id).amountYocto);
  }
  const evidenceRoot=hash({domain:'flashfirm-native-task-evidence/1',manifestHash:hash(m),authorizationHash:hash(envelope)});
  // Rust serializes u64 integers exactly. JSON Number would round nanoseconds.
  // Keep the original decimal values in that commitment.
  const encoded='["flashfirm-treasury/0.2",'+JSON.stringify(plan.contractId)+','+
    JSON.stringify(plan.init.task_root)+','+JSON.stringify(plan.init.recipients)+','+
    JSON.stringify(amounts.map(String))+','+JSON.stringify(evidenceRoot)+','+
    JSON.stringify(plan.init.policy_hash)+','+JSON.stringify(plan.init.arbiter)+','+
    plan.init.appeal_window_ns+','+plan.arbitrationDeadlineNs+']';
  return {plan,authorizationHash:hash(envelope),manifestHash:hash(m),amountsYocto:amounts.map(String),
    parts,evidenceRoot,planHash:sha(encoded),
    budgetYocto:p.nativeBudgetYocto,relayer:p.relayer,expiresAt:p.expiresAt,
    scope:'Buyer-approved native NEAR testnet budget allocated by signed contribution weights; no USDC conversion or cross-chain payment claim.'};
}
export function nativeDispatchPreview(envelope,flow,status,nowNs,now=Date.now()){
  const v=validateNativeSettlement(envelope,flow,now);
  if(pinnedMismatches(v.plan,status).length||status.plan_hash!==v.planHash||
    status.evidence_root!==v.evidenceRoot||status.funded_yocto!==v.budgetYocto)
    throw Error('PINNED_NATIVE_TREASURY_MISMATCH');
  if(!Array.isArray(status.pending_yocto)||status.pending_yocto.length!==v.amountsYocto.length||
    !Array.isArray(status.credits_yocto)||status.credits_yocto.length!==v.amountsYocto.length||
    status.pending_yocto.some(n=>n!=='0'))throw Error('NATIVE_TRANSFER_ALREADY_PENDING');
  return status.recipients.flatMap((recipient,i)=>status.credits_yocto[i]==='0'?[]:[
    treasuryAction(v.plan,status,v.relayer,'claim_for',{recipient},nowNs)
  ]);
}
export async function verifyNativeTaskSettlement(envelope,flow,proof,rpc,now=Date.now()){
  const v=validateNativeSettlement(envelope,flow,Math.min(now,envelope.payload.expiresAt-1));
  if((await rpc('status',[])).chain_id!=='testnet')throw Error('NATIVE_TASK_TESTNET_ONLY');
  const head=await rpc('block',{finality:'final'}),blockId=head.header.hash;
  const [code,view]=await Promise.all([
    rpc('query',{request_type:'view_code',block_id:blockId,account_id:v.plan.contractId}),
    rpc('query',{request_type:'call_function',block_id:blockId,account_id:v.plan.contractId,
      method_name:'get_status',args_base64:'e30='})
  ]);
  const wasm=Buffer.from(code.code_base64??'','base64');
  if(!wasm.length||code.block_hash!==blockId||view.block_hash!==blockId||
    sha(wasm)!==envelope.payload.wasmSha256||code.hash!==base58(Buffer.from(sha(wasm),'hex')))
    throw Error('PINNED_NATIVE_WASM_REQUIRED');
  const status=JSON.parse(Buffer.from(view.result).toString('utf8'));
  if(pinnedMismatches(v.plan,status).length||status.plan_hash!==v.planHash||
    status.evidence_root!==v.evidenceRoot||status.funded_yocto!==v.budgetYocto||
    status.phase!=='Closed'||status.paid_yocto!==v.budgetYocto||
    !Array.isArray(status.credits_yocto)||status.credits_yocto.length!==v.amountsYocto.length||
    status.credits_yocto.some(n=>n!=='0')||status.pending_yocto?.length!==v.amountsYocto.length||
    status.pending_yocto.some(n=>n!=='0')||!Array.isArray(status.approvals)||status.approvals.length!==3)
    throw Error('NATIVE_TASK_NOT_FULLY_PAID');
  const expected=[
    {label:'fund',hash:proof?.fund,actor:v.plan.init.buyer,method:'fund',args:{},deposit:v.budgetYocto},
    {label:'propose',hash:proof?.propose,actor:v.plan.init.buyer,method:'propose',
      args:{amounts_yocto:v.amountsYocto,evidence_root:v.evidenceRoot},deposit:'0'}
  ];
  if(!Array.isArray(proof?.approvals)||proof.approvals.length!==2||
    new Set(proof.approvals.map(p=>p.accountId)).size!==2)throw Error('TWO_NATIVE_REVIEW_TRANSACTIONS_REQUIRED');
  for(const a of proof.approvals){
    const i=v.plan.init.evaluators.indexOf(a.accountId);
    if(i<0||status.approvals[i]!==true)throw Error('UNPINNED_NATIVE_REVIEWER');
    expected.push({label:'approve',hash:a.hash,actor:a.accountId,method:'approve',args:{plan_hash:v.planHash},deposit:'0'});
  }
  const recipients=v.plan.init.recipients.filter((r,i)=>v.amountsYocto[i]!=='0');
  if(!Array.isArray(proof.claims)||proof.claims.length!==recipients.length||
    new Set(proof.claims.map(c=>c.recipient)).size!==recipients.length)throw Error('ALL_NATIVE_CLAIMS_REQUIRED');
  for(const r of recipients){
    const claim=proof.claims.find(c=>c.recipient===r);
    expected.push({label:'claim',hash:claim?.hash,actor:v.relayer,method:'claim_for',args:{recipient:r},deposit:'0'});
  }
  if(expected.some(e=>!/^[1-9A-HJ-NP-Za-km-z]{40,44}$/.test(e.hash??''))||
    new Set(expected.map(e=>e.hash)).size!==expected.length)throw Error('DISTINCT_NATIVE_TRANSACTION_HASHES_REQUIRED');
  const transactions=[];
  for(const e of expected){
    const outcome=await rpc('tx',{tx_hash:e.hash,sender_account_id:e.actor,wait_until:'FINAL'});
    if(outcome.transaction?.hash!==e.hash)throw Error('NATIVE_TRANSACTION_HASH_MISMATCH');
    checkTransaction(outcome,{signerId:e.actor,receiverId:v.plan.contractId,actions:[{type:'FunctionCall',params:{
      methodName:e.method,args:e.args,gas:'100000000000000',deposit:e.deposit}}]});
    const block=await rpc('block',{block_id:outcome.transaction_outcome.block_hash});
    if(block.header.hash!==outcome.transaction_outcome.block_hash||
      BigInt(block.header.height)>BigInt(head.header.height)||
      BigInt(block.header.timestamp_nanosec)<BigInt(envelope.payload.issuedAt)*1000000n||
      (e.label!=='claim'&&BigInt(block.header.timestamp_nanosec)>=BigInt(envelope.payload.expiresAt)*1000000n))
      throw Error('HISTORICAL_OR_UNFINALIZED_NATIVE_TRANSACTION');
    const historicalCode=await rpc('query',{request_type:'view_code',
      block_id:block.header.hash,account_id:v.plan.contractId});
    if(historicalCode.block_hash!==block.header.hash||
      sha(Buffer.from(historicalCode.code_base64??'','base64'))!==NATIVE_TREASURY_SHA256)
      throw Error('UNPINNED_EXECUTED_NATIVE_CODE');
    transactions.push({label:e.label,hash:e.hash,actor:e.actor,args:e.args});
  }
  return {version:'flashfirm-native-settlement-proof/1',verified:true,network:'testnet',
    taskRoot:flow.manifest.taskRoot,resultRoot:flow.manifest.resultRoot,manifestHash:hash(flow.manifest),
    authorizationHash:hash(envelope),contractId:v.plan.contractId,blockHash:blockId,blockHeight:head.header.height,
    budgetYocto:v.budgetYocto,allocations:v.parts,transactions,phase:status.phase,
    workerPaymentVerified:true,protocolFeePaymentVerified:true,unspentRefundVerified:true,
    mainnetPayment:false,independentOperatorsCertifiedByChain:false,
    scope:'Pinned tested contract, exact funding/proposal/reviewer calls and successful transfer callbacks for every native obligation. Independence comes from the separate identity roster.'};
}

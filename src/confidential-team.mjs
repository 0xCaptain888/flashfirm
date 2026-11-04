import {hash,canonical} from './protocol.mjs';
import {validateAciRelease,ACI_ORIGIN} from './aci-policy.mjs';
import {providerLimits} from './provider-limits.mjs';

// Whole-team preflight before the first private release/model POST. Uses the
// original cumulative ledger and tariff, never a per-task replacement budget.
export function preflightConfidentialTeam(input,{policy,original,ledger,releaseAuthority,inferenceAuthority,apiKeyPresent},now=Date.now()){
 if(!releaseAuthority||!inferenceAuthority||releaseAuthority===inferenceAuthority||!apiKeyPresent)
  throw Error('CONFIGURED_ACI_KEY_AND_SEPARATE_AUTHORITIES_REQUIRED');
 if(policy?.enabled!==true||policy.capFen!==2000||policy.origin!==ACI_ORIGIN||
  !Number.isSafeInteger(policy.reservationFen)||policy.reservationFen<1||policy.reservationFen>2000||
  original?.enabled!==true||original.capFen!==2000)throw Error('APPROVED_SHARED_ACI_TARIFF_REQUIRED');
 if(ledger?.capFen!==2000||!Number.isSafeInteger(ledger.reservedFen)||ledger.reservedFen<0||
  !Array.isArray(ledger.calls)||ledger.calls.some(c=>!Number.isSafeInteger(c.reserveFen)||c.reserveFen<0)||
  ledger.calls.reduce((n,c)=>n+c.reserveFen,0)!==ledger.reservedFen)throw Error('INVALID_SHARED_BUDGET_LEDGER');
 if(!/^[a-f0-9]{64}$/.test(input?.taskRoot??'')||!input.task||!Array.isArray(input.workers)||
  input.workers.length<1||input.workers.length>8||new Set(input.workers.map(w=>w.workerId)).size!==input.workers.length)
  throw Error('BOUNDED_CONFIDENTIAL_TEAM_REQUIRED');
 const taskDigest=hash(input.task),approvals=input.workers.map(w=>{
  const p=validateAciRelease(w.approval,releaseAuthority,{taskRoot:input.taskRoot,taskDigest,model:w.model,workerId:w.workerId},now);
  if(Buffer.byteLength(canonical(input.task))>p.maxInputBytes)throw Error('PRIVATE_INPUT_LIMIT_EXCEEDED');
  if(p.reservationFen!==policy.reservationFen)throw Error('EXACT_APPROVED_ACI_TARIFF_REQUIRED');
  if(ledger.calls.some(c=>c.purpose==='CONFIDENTIAL_ACI'&&c.approvalHash===hash(w.approval)))
   throw Error('ACI_DISPATCH_ALREADY_RESERVED_RECONCILE');
  return hash(w.approval);
 });
 if(new Set(approvals).size!==approvals.length)throw Error('DISTINCT_WORKER_RELEASE_APPROVALS_REQUIRED');
 const maxCalls=providerLimits(original).maxCalls,reserve=policy.reservationFen*input.workers.length;
 if(ledger.calls.length+input.workers.length>maxCalls||ledger.reservedFen+reserve>2000)
  throw Error('INSUFFICIENT_SHARED_BUDGET_FOR_CONFIDENTIAL_TEAM');
 return {version:'flashfirm-confidential-team-preflight/1',taskRoot:input.taskRoot,taskDigest,
  callsRequired:input.workers.length,maximumReservationFen:reserve,remainingCalls:maxCalls-ledger.calls.length,
  remainingFen:2000-ledger.reservedFen,dispatchPreflightPassed:true,
  liveAttestationVerified:false,privateInferenceVerified:false,paidCalls:0,
  next:'Fresh official hardware/channel verification and independent OS/KMS/model appraisal are required separately for every worker before private release.'};
}

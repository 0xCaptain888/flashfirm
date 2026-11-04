import {hash,validSeal} from './protocol.mjs';
import {verifyReport} from './report-revision.mjs';
import {verifyRoster,assessTaskQuality} from './task-quality.mjs';
import {assessReview,resolveAppeal} from './governance.mjs';
import {settlementManifest,taskFlowStatus} from './task-settlement.mjs';
import {acceptInferenceCertificates} from './aci-policy.mjs';

// Read-only diagnostics: rerun the actual release predicates rather than infer
// readiness from presence of uploaded JSON or previously stored "PASS" flags.
// No provider, wallet, notifications or chain calls are made by this module.
export function taskReadiness({record,review,flow,security={},active=true,recoveryHold=false},now=Date.now()){
 const checks=[];
 const check=(id,title,fn,next)=>{
  try{const detail=fn();checks.push({id,title,state:'PASS',detail:detail??null,next:null});}
  catch(e){checks.push({id,title,state:'BLOCKED',code:/^[A-Z][A-Z0-9_]+$/.test(e.message)?e.message:'VALIDATION_REQUIRED',next});}
 };
 const need=(ok,code)=>{if(!ok)throw Error(code);};
 const p=flow?.plan?.payload,status=taskFlowStatus(flow);
 check('workspace','Active workspace',()=>need(active&&!recoveryHold,recoveryHold?'RECOVERY_RECONCILIATION_REQUIRED':'WORKSPACE_CLOSED'),
  recoveryHold?'Reconcile the restored task and retained payment reservations.':'Create an active workspace.');
 check('report','Exact signed report and quotations',()=>{
  need(record,'REPORT_REQUIRED');const verified=verifyReport(record.receipt);
  need(verified.valid&&verified.citationState==='PASS','VALID_REPORT_AND_QUOTES_REQUIRED');
  need(verified.receiptHash===record.receiptHash&&verified.taskRoot===record.taskRoot,'EXACT_REPORT_REQUIRED');
  return {taskRoot:record.taskRoot,resultRoot:record.receiptHash};
 },'Import a signed report; correct rejected quotations and start a new review for the revision.');
 check('plan','Buyer-signed evaluation plan',()=>{
  need(p&&validSeal(flow.plan,p.buyerKey),'VALID_BUYER_PLAN_REQUIRED');
  // The creation-time freshness check belongs to plan insertion, not readback.
  need(p.createdAt<=now&&p.expiresAt>now,'TASK_PLAN_EXPIRED');
  need(p.taskRoot===record?.taskRoot&&p.resultRoot===record?.receiptHash,'EXACT_REPORT_REQUIRED');
  return {expiresAt:p.expiresAt,planHash:hash(flow.plan)};
 },'Pin the review policy and upload the buyer-signed plan for this exact report.');
 check('identity','Externally certified participants',()=>{
  need(p,'TASK_PLAN_REQUIRED');
  const roster=verifyRoster(p,flow.certificates,security.authority,security.revokedSubjects??[],now);
  return {members:roster.subjects.length,trust:roster.scope};
 },'Enroll actual participants with an independent authority. Distinct keys and operator labels do not establish independence.');
 check('review','Quorum, conflicts and appeal window',()=>{
  need(review?.commitment&&p&&review.commitment.digest===p.reviewPolicyHash&&review.resultRoot===p.resultRoot,
   'EXACT_REVIEW_REQUIRED');
  let result=assessReview(review.commitment,review.resultRoot,review.decisions,now);
  if(review.appeal)result=review.resolution?resolveAppeal(review.commitment,review.resultRoot,review.decisions,review.appeal,review.resolution,now):{state:'APPEAL_PENDING'};
  need(result.state==='RELEASE_ELIGIBLE',result.state);
  return {state:result.state};
 },'Obtain pinned reviewers’ decisions; resolve challenges and appeals, then wait for the release window.');
 check('quality','Semantic support and removal study',()=>{
  need(p&&record,'TASK_PLAN_AND_REPORT_REQUIRED');
  const quality=assessTaskQuality(flow.plan,record.receipt,flow.evaluations);
  need(quality.state==='ASSESSED',quality.state);
  return {state:quality.state,methods:quality.methods,scope:quality.scope};
 },'Export a reviewer package. Two pinned reviewers must evaluate source support and every full/removal sample; disagreements block release.');
 check('privacy','Task-bound privacy requirement',()=>{
  need(p,'TASK_PLAN_REQUIRED');
  if(p.privacyMode==='CONFIDENTIAL_INFERENCE')
   return acceptInferenceCertificates(flow,flow.inferenceProof,security,now);
  if(p.privacyMode==='CONFIDENTIAL_QUOTATIONS'){
   need(flow.privacy?.privateQuotationVerified===true&&flow.privacy.authority===security.releaseAuthority&&
    flow.privacy.taskRoot===p.taskRoot&&flow.privacy.resultRoot===p.resultRoot&&flow.privacy.taskDigest===p.privateTaskDigest,
   'TASK_BOUND_PRIVACY_PROOF_REQUIRED');
   return {mode:p.privacyMode,privateQuotationVerified:true,confidentialInferenceVerified:false};
  }
  return {mode:'PUBLIC_SOURCES',confidentialInferenceVerified:false,required:false};
 },'Supply exact worker artifact certificates and independent release/runtime appraisal. Historical public TEE evidence cannot satisfy this task.');
 check('manifest','Current release evidence and allocation',()=>{
  need(flow?.manifest,'MANIFEST_REQUIRED');
  const current=settlementManifest(flow,record,review,security,now);
  need(hash(current)===hash(flow.manifest),'MANIFEST_BINDING_CHANGED');
  return {manifestHash:hash(current),obligations:current.obligations?.length??current.payouts.length};
 },'Resolve the blocked release checks, supply worker authorship signatures and lock the conserved allocation.');
 // Financial receipts remain historical facts even if an identity/plan later
 // expires. Expiry must not erase a paid transaction or enable a second path.
 check('settlement','Actual payment evidence',()=>{
  need(status.taskSettlementComplete||status.nativeTestnetSettlementVerified,'ACTUAL_SETTLEMENT_NOT_VERIFIED');
  return {network:status.nativeTestnetSettlementVerified?'testnet':'mainnet',
   crossChain:status.crossChainSettlementVerified,commonEscrow:status.commonEscrowBudgetVerified};
 },'Authorize one payment route, execute with the wallet, then verify every worker, fee and refund receipt from the pinned RPC.');
 const beforePayment=checks.filter(c=>c.id!=='settlement');
 return {version:'flashfirm-task-readiness/1',checkedAt:now,checks,
  next:checks.find(c=>c.state!=='PASS')??null,
  releaseReady:beforePayment.every(c=>c.state==='PASS'),
  settlementVerified:status.taskSettlementComplete||status.nativeTestnetSettlementVerified,
  mainnetSettlementVerified:status.taskSettlementComplete,
  mainnetEscrowEnabled:security.nativeMainnetEnabled===true,
  fundsMoved:false,paidCalls:0,
  scope:'Current release validation and separately retained financial facts. Does not certify real-world independence or production readiness.'};
}

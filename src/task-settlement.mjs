import {hash,validSeal} from './protocol.mjs';
import {assessTaskQuality, verifyRoster,allocationPolicy} from './task-quality.mjs';
import {assessReview,resolveAppeal} from './governance.mjs';
import {acceptInferenceCertificates} from './aci-policy.mjs';

export function settlementManifest(flow,record,review,{authority,releaseAuthority,inferenceAuthority,revokedSubjects=[]}={},now=Date.now()) {
  const p=flow.plan.payload;
  if (now>=p.expiresAt || p.resultRoot!==record.receiptHash || p.taskRoot!==record.taskRoot ||
    review?.commitment?.digest!==p.reviewPolicyHash || review.resultRoot!==p.resultRoot) throw Error('TASK_BINDING_EXPIRED_OR_CHANGED');
  let decision=assessReview(review.commitment,review.resultRoot,review.decisions,now);
  if(review.appeal) decision=review.resolution?
    {...decision,...resolveAppeal(review.commitment,review.resultRoot,review.decisions,review.appeal,review.resolution,now)}:{state:'APPEAL_PENDING'};
  if(decision.state!=='RELEASE_ELIGIBLE')throw Error('REVIEW_AND_APPEAL_CLEARANCE_REQUIRED');
  const roster=verifyRoster(p,flow.certificates,authority,revokedSubjects,now);
  if(!Array.isArray(flow.contributions)||flow.contributions.length!==p.workers.length)throw Error('SIGNED_WORKER_CONTRIBUTIONS_REQUIRED');
  for(const w of p.workers){
    const contribution=flow.contributions.find(c=>c.publicKey===w.key),v=contribution?.payload;
    if(!validSeal(contribution,w.key)||v?.version!=='flashfirm-contribution-claim/1'||v.planHash!==hash(flow.plan)||
      v.resultRoot!==p.resultRoot||v.artifactHash!==w.artifactHash||v.subject!==w.subject||
      v.role!=='AUTHOR'||!Number.isSafeInteger(v.issuedAt)||v.issuedAt<p.createdAt||v.issuedAt>now)
      throw Error('WORKER_ARTIFACT_SIGNATURE_REQUIRED');
  }
  const quality=assessTaskQuality(flow.plan,record.receipt,flow.evaluations);
  if(quality.state!=='ASSESSED')throw Error('SEMANTIC_CHALLENGE_BLOCKS_PAYMENT');
  if(p.privacyMode==='CONFIDENTIAL_QUOTATIONS'&&(!flow.privacy?.privateQuotationVerified||
    flow.privacy.authority!==releaseAuthority||flow.privacy.taskRoot!==p.taskRoot||flow.privacy.resultRoot!==p.resultRoot||flow.privacy.taskDigest!==p.privateTaskDigest))
    throw Error('TASK_BOUND_PRIVACY_PROOF_REQUIRED');
  if(p.privacyMode==='CONFIDENTIAL_INFERENCE'&&(!flow.inference?.confidentialInferenceVerified||
    flow.inference.authority!==inferenceAuthority||flow.inference.releaseAuthority!==releaseAuthority||
    flow.inference.taskRoot!==p.taskRoot||flow.inference.resultRoot!==p.resultRoot||
    flow.inference.taskDigest!==p.privateTaskDigest||
    p.workers.some(w=>!flow.inference.artifactHashes?.includes(w.artifactHash))))
    throw Error('ALL_TASK_ARTIFACTS_REQUIRE_INFERENCE_PROOF');
  if(p.privacyMode==='CONFIDENTIAL_INFERENCE'&&
    acceptInferenceCertificates(flow,flow.inferenceProof,{releaseAuthority,inferenceAuthority},now).proofHash!==flow.inference.proofHash)
    throw Error('INFERENCE_PROOF_REVALIDATION_FAILED');
  const payouts=quality.allocation.payouts.filter(a=>a.amount>0).map(a=>({...a,recipient:p.workers.find(w=>w.id===a.id).recipient}));
  const policy=allocationPolicy(p);
  if(!payouts.length&&!policy)throw Error('NO_PAYABLE_CONTRIBUTIONS');
  const manifest={version:policy?'flashfirm-settlement-manifest/2':'flashfirm-settlement-manifest/1',taskRoot:p.taskRoot,resultRoot:p.resultRoot,
    planHash:hash(flow.plan),reviewHash:hash(review),qualityHash:quality.qualityHash,rosterHash:hash(flow.certificates),
    contributionHash:hash(flow.contributions),privacyProofHash:flow.privacy?hash(flow.privacy):null,
    ...(flow.inference?{inferenceProofHash:hash(flow.inference)}:{}),
    allocationAsset:p.allocationAsset,budgetUnits:p.budgetUnits,feeUnits:quality.allocation.fee,
    refundUnits:quality.allocation.refund,payouts,identityAuthority:roster.authority};
  if(policy){
    const obligation=(kind,recipient,amount,workerId=null)=>({
      id:hash({planHash:manifest.planHash,kind,workerId}),kind,workerId,recipient,amount
    });
    manifest.obligations=[...payouts.map(w=>obligation('WORKER',w.recipient,w.amount,w.id)),
      ...(manifest.feeUnits?[obligation('PROTOCOL_FEE',policy.feeRecipient,manifest.feeUnits)]:[]),
      ...(manifest.refundUnits?[obligation('UNSPENT_REFUND',policy.refundRecipient,manifest.refundUnits)]:[])];
    if(manifest.obligations.reduce((n,o)=>n+o.amount,0)!==manifest.budgetUnits)throw Error('OBLIGATION_BUDGET_NOT_CONSERVED');
  }
  return manifest;
}
export function authorizeInvoice(envelope,manifest,flow,now=Date.now()) {
  const p=envelope?.payload,v2=manifest.version==='flashfirm-settlement-manifest/2';
  const worker=v2?manifest.obligations.find(o=>o.id===p?.obligationId):manifest.payouts.find(w=>w.id===p?.workerId);
  if(!p||!worker||!validSeal(envelope,flow.plan.payload.buyerKey)||p.version!==(v2?'flashfirm-task-invoice/2':'flashfirm-task-invoice/1')||
    (v2&&(p.kind!==worker.kind||p.workerId!==worker.workerId))||
    p.manifestHash!==hash(manifest)||p.recipient!==worker.recipient||p.minimumUsdcUnits!==String(worker.amount)||
    !/^[a-f0-9]{64}$/.test(p.nonce??'')||!Number.isSafeInteger(p.issuedAt)||p.issuedAt>now||p.issuedAt<now-300000||
    !Number.isSafeInteger(p.expiresAt)||p.expiresAt<=now||p.expiresAt>flow.plan.payload.expiresAt||
    !/^[1-9]\d{0,29}$/.test(p.originAmountYocto??'')||
    !/^[1-9]\d{0,29}$/.test(p.maximumFeeYocto??'')||
    !/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(p.sourceAccount??'')||p.sourceAccount.length>64||
    p.sourceAccount.endsWith('.testnet'))throw Error('EXACT_BUYER_SIGNED_INVOICE_REQUIRED');
  return {invoiceHash:hash(envelope),manifestHash:p.manifestHash,workerId:v2?worker.workerId:worker.id,recipient:p.recipient,
    ...(v2?{obligationId:worker.id,kind:worker.kind}:{}),
    minimumUsdcUnits:p.minimumUsdcUnits,sourceAccount:p.sourceAccount,originAmountYocto:p.originAmountYocto,
    maximumFeeYocto:p.maximumFeeYocto,createdAt:now,expiresAt:p.expiresAt,state:'AUTHORIZED_NOT_FUNDED'};
}
export function taskFlowStatus(flow) {
  if(!flow)return {state:'NO_PLAN',fundsMoved:false,next:'Pin a buyer-signed post-delivery evaluation plan.'};
  const invoices=flow.invoices??[];
  const obligations=flow.manifest?.obligations;
  const paid=o=>invoices.some(i=>i.obligationId===o.id&&i.state==='VERIFIED'&&i.evidence?.paymentVerified===true);
  const invoiceComplete=!!obligations?.length&&obligations.every(paid);
  const proof=flow.nativeSettlement?.evidence,authorization=flow.nativeSettlement?.authorization;
  const nativeBound=!!authorization&&proof?.verified===true&&proof.authorizationHash===hash(authorization)&&
    proof.manifestHash===hash(flow.manifest)&&proof.taskRoot===flow.manifest?.taskRoot&&
    proof.resultRoot===flow.manifest?.resultRoot&&proof.network===authorization.payload.network&&
    proof.commonEscrowBudgetVerified===true;
  const native=nativeBound&&proof.network==='testnet';
  const mainnetNative=nativeBound&&proof.network==='mainnet'&&proof.mainnetPayment===true&&proof.lockedContractVerified===true;
  const complete=invoiceComplete||mainnetNative;
  return {planHash:hash(flow.plan),state:!flow.manifest?'AWAITING_QUALITY_AND_IDENTITY':
    native?'NATIVE_TESTNET_SETTLED':mainnetNative?'NATIVE_MAINNET_ESCROW_SETTLED':complete?'ALL_TASK_PAYMENTS_VERIFIED':
    flow.manifest.payouts.length>0&&flow.manifest.payouts.every(p=>invoices.some(i=>i.workerId===p.id&&i.state==='VERIFIED'))?'WORKER_PAYOUTS_VERIFIED':
    invoices.some(i=>i.state==='REFUNDED')?'REFUND_REVIEW_REQUIRED':'AWAITING_PAYMENT',
    invoices:invoices.map(({quote,...i})=>i),manifest:flow.manifest??null,
    commitmentTiming:'POST_DELIVERY_PRE_EVALUATION',confidentialInferenceVerified:flow.inference?.confidentialInferenceVerified===true,
    protocolFeePaymentVerified:mainnetNative||!!obligations&&obligations.filter(o=>o.kind==='PROTOCOL_FEE').every(paid),
    refundPaymentVerified:mainnetNative||!!obligations&&obligations.filter(o=>o.kind==='UNSPENT_REFUND').every(paid),
    taskSettlementComplete:complete,nativeTestnetSettlementVerified:native,
    nativeMainnetSettlementVerified:mainnetNative,commonEscrowBudgetVerified:mainnetNative,
    crossChainSettlementVerified:invoiceComplete,
    nativeSettlement:flow.nativeSettlement??null,
    crossChainLinkageTrust:'Both chains via pinned RPC plus signed 1Click quote and relay mapping'};
}

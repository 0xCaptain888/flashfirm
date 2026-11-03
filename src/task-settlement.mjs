import {hash,validSeal} from './protocol.mjs';
import {assessTaskQuality, verifyRoster} from './task-quality.mjs';
import {assessReview,resolveAppeal} from './governance.mjs';

export function settlementManifest(flow,record,review,{authority,releaseAuthority,revokedSubjects=[]}={},now=Date.now()) {
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
  const payouts=quality.allocation.payouts.filter(a=>a.amount>0).map(a=>({...a,recipient:p.workers.find(w=>w.id===a.id).recipient}));
  if(!payouts.length)throw Error('NO_PAYABLE_CONTRIBUTIONS');
  return {version:'flashfirm-settlement-manifest/1',taskRoot:p.taskRoot,resultRoot:p.resultRoot,
    planHash:hash(flow.plan),reviewHash:hash(review),qualityHash:quality.qualityHash,rosterHash:hash(flow.certificates),
    contributionHash:hash(flow.contributions),privacyProofHash:flow.privacy?hash(flow.privacy):null,
    allocationAsset:p.allocationAsset,budgetUnits:p.budgetUnits,feeUnits:quality.allocation.fee,
    refundUnits:quality.allocation.refund,payouts,identityAuthority:roster.authority};
}
export function authorizeInvoice(envelope,manifest,flow,now=Date.now()) {
  const p=envelope?.payload,worker=manifest.payouts.find(w=>w.id===p?.workerId);
  if(!p||!worker||!validSeal(envelope,flow.plan.payload.buyerKey)||p.version!=='flashfirm-task-invoice/1'||
    p.manifestHash!==hash(manifest)||p.recipient!==worker.recipient||p.minimumUsdcUnits!==String(worker.amount)||
    !/^[a-f0-9]{64}$/.test(p.nonce??'')||!Number.isSafeInteger(p.issuedAt)||p.issuedAt>now||p.issuedAt<now-300000||
    !Number.isSafeInteger(p.expiresAt)||p.expiresAt<=now||p.expiresAt>flow.plan.payload.expiresAt||
    !/^[1-9]\d{0,29}$/.test(p.originAmountYocto??'')||
    !/^[1-9]\d{0,29}$/.test(p.maximumFeeYocto??'')||
    !/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(p.sourceAccount??'')||p.sourceAccount.length>64||
    p.sourceAccount.endsWith('.testnet'))throw Error('EXACT_BUYER_SIGNED_INVOICE_REQUIRED');
  return {invoiceHash:hash(envelope),manifestHash:p.manifestHash,workerId:worker.id,recipient:p.recipient,
    minimumUsdcUnits:p.minimumUsdcUnits,sourceAccount:p.sourceAccount,originAmountYocto:p.originAmountYocto,
    maximumFeeYocto:p.maximumFeeYocto,createdAt:now,expiresAt:p.expiresAt,state:'AUTHORIZED_NOT_FUNDED'};
}
export function taskFlowStatus(flow) {
  if(!flow)return {state:'NO_PLAN',fundsMoved:false,next:'Pin a buyer-signed post-delivery evaluation plan.'};
  const invoices=flow.invoices??[];
  return {planHash:hash(flow.plan),state:!flow.manifest?'AWAITING_QUALITY_AND_IDENTITY':
    flow.manifest.payouts.every(p=>invoices.some(i=>i.workerId===p.id&&i.state==='VERIFIED'))?'WORKER_PAYOUTS_VERIFIED':
    invoices.some(i=>i.state==='REFUNDED')?'REFUND_REVIEW_REQUIRED':'AWAITING_PAYMENT',
    invoices:invoices.map(({quote,...i})=>i),manifest:flow.manifest??null,
    commitmentTiming:'POST_DELIVERY_PRE_EVALUATION',confidentialInferenceVerified:false,
    protocolFeePaymentVerified:false,refundPaymentVerified:false,taskSettlementComplete:false,
    crossChainLinkageTrust:'Both chains via pinned RPC plus signed 1Click quote and relay mapping'};
}

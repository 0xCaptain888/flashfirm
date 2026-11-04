import {hash,validSeal} from './protocol.mjs';
import {qualitySamples} from './task-quality.mjs';
import {citationLocations,verifyReport} from './report-revision.mjs';
import {assessReview} from './governance.mjs';

// Transport for actual external reviewers; no identity creation, prefilled
// scores, approval verdicts, reviewer signatures or payment authority.
export function createReviewPackage(flow,record,review,now=Date.now()){
 const p=flow?.plan?.payload;
 if(!p||!validSeal(flow.plan,p.buyerKey)||p.expiresAt<=now||p.createdAt>now||
  p.taskRoot!==record?.taskRoot||p.resultRoot!==record?.receiptHash||
  hash(record?.receipt)!==p.resultRoot||review?.resultRoot!==p.resultRoot||
  review?.commitment?.digest!==p.reviewPolicyHash)throw Error('EXACT_ACTIVE_TASK_REVIEW_PACKAGE_REQUIRED');
 if(['CONFIDENTIAL_INFERENCE','CONFIDENTIAL_QUOTATIONS'].includes(p.privacyMode))
  throw Error('PRIVATE_REVIEW_PACKAGE_EXPORT_REQUIRES_SECURE_CHANNEL');
 if(!verifyReport(record.receipt).valid)throw Error('INVALID_REPORT');
 const sources=(record.receipt.payload.parentReceipt??record.receipt).payload.sources;
 return {version:'flashfirm-review-package/1',createdAt:now,plan:flow.plan,receipt:record.receipt,
  reviewCommitment:review.commitment,
  claims:citationLocations(record.receipt).map(c=>({...c,claimHash:hash(c),
   sourceExcerpt:sources.find(s=>s.id===c.sourceId)?.excerpt})),
  samples:structuredClone(qualitySamples(record.receipt)),
  scope:'Public-source reviewer handoff. Human judgments must be completed and signed by a pre-pinned reviewer. This package itself is not independent review.'};
}
export function validateReviewPackage(pkg,now=Date.now()){
 const p=pkg?.plan?.payload,checked=verifyReport(pkg?.receipt);
 if(pkg?.version!=='flashfirm-review-package/1'||!p||!validSeal(pkg.plan,p.buyerKey)||!checked.valid||
  p.expiresAt<=now||p.createdAt>now||checked.receiptHash!==p.resultRoot||checked.taskRoot!==p.taskRoot||
  !Array.isArray(p.reviewerKeys)||p.reviewerKeys.length!==3||new Set(p.reviewerKeys).size!==3||
  p.reviewPolicyHash!==pkg.reviewCommitment?.digest||
  hash(p.reviewerKeys)!==hash(pkg.reviewCommitment.policy.reviewers.map(r=>r.key))||
  p.buyerKey!==pkg.reviewCommitment.policy.buyerKey||p.taskRoot!==pkg.reviewCommitment.policy.taskRoot||
  !['PUBLIC_SOURCES',undefined].includes(p.privacyMode))throw Error('INVALID_OR_EXPIRED_REVIEW_PACKAGE');
 assessReview(pkg.reviewCommitment,p.resultRoot,[],now);
 if(hash(pkg.samples)!==hash(qualitySamples(pkg.receipt))||
  hash(pkg.claims.map(({sourceExcerpt,claimHash,...c})=>c))!==hash(citationLocations(pkg.receipt)))
  throw Error('REVIEW_PACKAGE_INPUT_TAMPERED');
 const sources=(pkg.receipt.payload.parentReceipt??pkg.receipt).payload.sources;
 if(pkg.claims.some(c=>c.claimHash!==hash(Object.fromEntries(Object.entries(c).filter(([k])=>!['claimHash','sourceExcerpt'].includes(k))))||
   c.sourceExcerpt!==sources.find(s=>s.id===c.sourceId)?.excerpt))throw Error('REVIEW_PACKAGE_SOURCE_TAMPERED');
 return p;
}
export function blankReview(pkg,reviewerKey,now=Date.now()){
 const p=validateReviewPackage(pkg,now);
 if(!p.reviewerKeys.includes(reviewerKey))throw Error('PINNED_REVIEWER_KEY_REQUIRED');
 return {version:'flashfirm-human-review-draft/1',packageHash:hash(pkg),reviewerKey,
  evaluation:{version:'flashfirm-quality-evaluation/1',planHash:hash(pkg.plan),resultRoot:p.resultRoot,
   issuedAt:null,method:'HUMAN_BLINDED',
   claims:pkg.claims.map(c=>({workerId:c.workerId,claimIndex:c.claimIndex,claimHash:c.claimHash,
    verdict:null,reason:'',sourceContext:c.quote})),
   samples:pkg.samples.map(s=>({sampleHash:s.sampleHash,criteria:p.rubric.map(r=>({id:r.id,score:null})),
    traceHash:null,notes:''}))},
  decision:{version:'flashfirm-decision/1',policyHash:p.reviewPolicyHash,taskRoot:p.taskRoot,
   resultRoot:p.resultRoot,verdict:null,reason:'',issuedAt:null},
  instructions:'Inspect exact source context and all samples independently. Fill every verdict/reason/score/sample notes and decision. Nothing is pre-approved. Keep original notes; a notes hash is not a proof of human effort.'};
}
export function signHumanReview(pkg,draft,key,sign,now=Date.now()){
 const p=validateReviewPackage(pkg,now);
 if(draft?.version!=='flashfirm-human-review-draft/1'||draft.packageHash!==hash(pkg)||
  draft.reviewerKey!==key.publicKey||!p.reviewerKeys.includes(key.publicKey))
  throw Error('REVIEWER_PACKAGE_BINDING_REQUIRED');
 const evaluation=structuredClone(draft.evaluation),decision=structuredClone(draft.decision);
 if(evaluation?.method!=='HUMAN_BLINDED'||evaluation.samples?.some(s=>
  typeof s.notes!=='string'||s.notes.trim().length<20||s.notes.length>4000))
  throw Error('ACTUAL_SAMPLE_NOTES_REQUIRED');
 evaluation.issuedAt=now;decision.issuedAt=now;
 for(const sample of evaluation.samples)sample.traceHash=hash({packageHash:hash(pkg),reviewer:key.publicKey,
  sampleHash:sample.sampleHash,criteria:sample.criteria,notes:sample.notes});
 const envelope=sign(evaluation,key),verdict=sign(decision,key);
 // Reuse production schemas for a single reviewer without pretending there
 // are two people. A second distinct reviewer is required by the live API.
 validateHumanEvaluation(pkg,envelope,now);
 assessReview(pkg.reviewCommitment,p.resultRoot,[verdict],now);
 if(decision.verdict==='APPROVE'&&evaluation.claims.some(c=>c.verdict!=='SUPPORTED'))
  throw Error('APPROVAL_CONTRADICTS_SEMANTIC_CHALLENGE');
 return {version:'flashfirm-human-review-response/1',packageHash:hash(pkg),evaluation:envelope,
  decision:verdict,independenceCertified:false,requiresExternalIdentityCertificate:true};
}
export function validateHumanEvaluation(pkg,envelope,now=Date.now()){
 const p=validateReviewPackage(pkg,now),e=envelope?.payload;
 if(!p.reviewerKeys.includes(envelope?.publicKey)||!validSeal(envelope,envelope.publicKey)||
  e?.version!=='flashfirm-quality-evaluation/1'||e.planHash!==hash(pkg.plan)||e.resultRoot!==p.resultRoot||
  e.method!=='HUMAN_BLINDED'||!Number.isSafeInteger(e.issuedAt)||e.issuedAt<p.createdAt||e.issuedAt>now||e.issuedAt>=p.expiresAt||
  !Array.isArray(e.claims)||e.claims.length!==pkg.claims.length||
  new Set(e.claims.map(c=>`${c.workerId}:${c.claimIndex}`)).size!==e.claims.length||
  !Array.isArray(e.samples)||e.samples.length!==pkg.samples.length||
  new Set(e.samples.map(s=>s.sampleHash)).size!==e.samples.length)throw Error('INCOMPLETE_HUMAN_REVIEW');
 for(const c of pkg.claims){
  const v=e.claims.find(v=>v.workerId===c.workerId&&v.claimIndex===c.claimIndex);
  if(!v||v.claimHash!==c.claimHash||!['SUPPORTED','UNSUPPORTED','CONTRADICTED','INFERENCE'].includes(v.verdict)||
   typeof v.reason!=='string'||v.reason.trim().length<20||v.reason.length>2000||
   typeof v.sourceContext!=='string'||!v.sourceContext.includes(c.quote)||!c.sourceExcerpt.includes(v.sourceContext))
   throw Error('CLAIM_CONTEXT_AND_REASON_REQUIRED');
 }
 for(const s of pkg.samples){
  const row=e.samples.find(v=>v.sampleHash===s.sampleHash);
  if(!row||!Array.isArray(row.criteria)||row.criteria.length!==p.rubric.length||
   new Set(row.criteria.map(c=>c.id)).size!==row.criteria.length||
   row.criteria.some(c=>!p.rubric.some(r=>r.id===c.id)||!Number.isInteger(c.score)||c.score<0||c.score>100)||
   !/^[a-f0-9]{64}$/.test(row.traceHash??''))throw Error('INCOMPLETE_ABLATION_EVALUATION');
 }
 return true;
}

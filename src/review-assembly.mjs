import {hash} from './protocol.mjs';
import {validateReviewPackage,validateHumanEvaluation} from './review-package.mjs';
import {assessReview} from './governance.mjs';
import {assessTaskQuality} from './task-quality.mjs';

export function assembleHumanReviews(pkg,responses,{certificates=[],contributions=[]}={},now=Date.now()){
 const plan=validateReviewPackage(pkg,now);
 if(!Array.isArray(responses)||responses.length<2||responses.length>3||
   new Set(responses.map(r=>r.evaluation?.publicKey)).size!==responses.length)throw Error('TWO_DISTINCT_ACTUAL_REVIEW_RESPONSES_REQUIRED');
 for(const r of responses){
  if(r.version!=='flashfirm-human-review-response/1'||r.packageHash!==hash(pkg)||
    r.evaluation?.publicKey!==r.decision?.publicKey)throw Error('EXACT_REVIEW_RESPONSE_REQUIRED');
  validateHumanEvaluation(pkg,r.evaluation,now);
  assessReview(pkg.reviewCommitment,plan.resultRoot,[r.decision],now);
  if(r.decision.payload.verdict==='APPROVE'&&r.evaluation.payload.claims.some(c=>c.verdict!=='SUPPORTED'))
   throw Error('APPROVAL_CONTRADICTS_SEMANTIC_CHALLENGE');
 }
 const qualityInput={evaluations:responses.map(r=>r.evaluation),certificates,contributions};
 const quality=assessTaskQuality(pkg.plan,pkg.receipt,qualityInput.evaluations);
 return {version:'flashfirm-human-review-import/1',planHash:hash(pkg.plan),resultRoot:plan.resultRoot,
  actions:[...responses.map(r=>({operation:'decision',input:r.decision})),{operation:'quality',input:qualityInput}],
  assessment:quality,identityCertificateCount:certificates.length,workerContributionCount:contributions.length,
  externalIdentityStillRequiresVerification:true,releaseReady:false,financialTransactions:0,
  next:'Submit each signed decision, then the quality input. The backend still checks identity, authorship, appeals and privacy before creating a manifest.'};
}

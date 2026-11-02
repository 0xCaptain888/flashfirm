import { hash, validSeal } from './protocol.mjs';
const hex=s=>typeof s==='string'&&/^[a-f0-9]{64}$/.test(s);
const integer=n=>Number.isSafeInteger(n)&&n>=0;
const fail=message=>{throw Error(message);};

// Keys are supplied by the buyer BEFORE work. Distinct key/operator labels alone
// do not establish real-world independence; onboarding must establish that trust.
export function commitPolicy(policy) {
  if(!policy||!hex(policy.taskRoot)||!Array.isArray(policy.reviewers)||policy.reviewers.length!==3||!policy.buyerKey||!policy.appealKey||!Array.isArray(policy.workerKeys)||!policy.workerKeys.length||!integer(policy.expiresAt)||!integer(policy.appealWindowMs)||policy.appealWindowMs<60000)fail('Invalid review policy');
  const keys=[policy.buyerKey,policy.appealKey,...policy.workerKeys,...policy.reviewers.map(r=>r.key)];
  if(keys.some(k=>typeof k!=='string'||!k.includes('PUBLIC KEY'))||new Set(keys).size!==keys.length)fail('Reviewer, worker, buyer and appeal keys must be distinct');
  if(new Set(policy.reviewers.map(r=>r.operator)).size!==3||policy.reviewers.some(r=>typeof r.operator!=='string'||!r.operator.trim()))fail('Reviewer operator labels must be distinct');
  return {policy:structuredClone(policy),digest:hash(policy)};
}
export function assessReview(commitment,resultRoot,decisions,now) {
  const {policy,digest}=commitPolicy(commitment.policy);
  if(commitment.digest!==digest||!hex(resultRoot)||!integer(now)||!Array.isArray(decisions)||decisions.length>3)fail('Invalid review commitment');
  const seen=new Set();let approved=0,challenged=0,last=0;
  for(const d of decisions){
    const p=d?.payload,reviewer=policy.reviewers.find(r=>r.key===d?.publicKey);
    if(!reviewer||!validSeal(d,reviewer.key)||seen.has(reviewer.key))fail('Invalid or duplicate reviewer signature');
    if(p?.version!=='flashfirm-decision/1'||p.policyHash!==digest||p.taskRoot!==policy.taskRoot||p.resultRoot!==resultRoot||!['APPROVE','CHALLENGE'].includes(p.verdict)||!integer(p.issuedAt)||p.issuedAt>now||p.issuedAt>=policy.expiresAt||typeof p.reason!=='string'||!p.reason.trim()||p.reason.length>4000)fail('Decision binding or validity failed');
    seen.add(reviewer.key);last=Math.max(last,p.issuedAt);if(p.verdict==='APPROVE')approved++;else challenged++;
  }
  const reviewHash=hash({policyHash:digest,resultRoot,decisions:decisions.map(d=>hash(d)).sort()});
  const appealUntil=last+policy.appealWindowMs;
  let state=challenged?'DISPUTED':approved>=2?'APPROVED_PENDING_APPEAL':'AWAITING_QUORUM';
  if(now>=policy.expiresAt&&approved<2&&!challenged)state='EXPIRED';
  if(approved>=2&&!challenged&&now>=appealUntil)state='RELEASE_ELIGIBLE';
  return {state,approved,challenged,reviewHash,reviewedAt:last,appealUntil,resultRoot,policyHash:digest};
}
export function validateAppeal(commitment,resultRoot,decisions,appeal,now) {
  const assessment=assessReview(commitment,resultRoot,decisions,now);
  const {policy,digest}=commitPolicy(commitment.policy),a=appeal?.payload;
  if(commitment.digest!==digest||assessment.policyHash!==digest||!hex(assessment.reviewHash)||!integer(now))fail('Invalid policy or assessment');
  const participants=[policy.buyerKey,...policy.workerKeys];
  if(assessment.approved+assessment.challenged<2||!participants.includes(appeal?.publicKey)||!validSeal(appeal,appeal.publicKey)||a?.version!=='flashfirm-appeal/1'||a.reviewHash!==assessment.reviewHash||a.policyHash!==digest||!integer(a.issuedAt)||a.issuedAt<assessment.reviewedAt||a.issuedAt>now||a.issuedAt>=assessment.appealUntil||typeof a.reason!=='string'||!a.reason.trim())fail('Invalid or late appeal');
  return {assessment,appealHash:hash(appeal)};
}
export function resolveAppeal(commitment,resultRoot,decisions,appeal,resolution,now) {
  const {assessment}=validateAppeal(commitment,resultRoot,decisions,appeal,now);
  const policy=commitment.policy,a=appeal.payload,r=resolution?.payload;
  if(!validSeal(resolution,policy.appealKey)||r?.version!=='flashfirm-resolution/1'||r.appealHash!==hash(appeal)||r.reviewHash!==assessment.reviewHash||!['UPHOLD','REWORK'].includes(r.verdict)||!integer(r.issuedAt)||r.issuedAt<a.issuedAt||r.issuedAt>now||typeof r.reason!=='string'||!r.reason.trim())fail('Invalid independent appeal resolution');
  return {state:r.verdict==='REWORK'?'REWORK_REQUIRED':now>=assessment.appealUntil?'RELEASE_ELIGIBLE':'APPROVED_PENDING_APPEAL',appealHash:hash(appeal),resolutionHash:hash(resolution),trust:'Key-authenticated decision; real-world independence must be established externally'};
}

export function selectSignedOffers({taskRoot,requirements,budget,offers,trustedProviders,now}) {
  if(!hex(taskRoot)||!integer(budget)||budget>100000000||!integer(now)||!Array.isArray(requirements)||requirements.length<1||requirements.length>8||new Set(requirements).size!==requirements.length||!Array.isArray(offers)||offers.length>32)fail('Invalid tender');
  const seen=new Set();
  const candidates=offers.map(envelope=>{
    const p=envelope?.payload,t=trustedProviders.find(x=>x.key===envelope?.publicKey);
    if(!t||!t.operator||!validSeal(envelope,t.key)||p?.version!=='flashfirm-offer/1'||p.taskRoot!==taskRoot||!integer(p.priceMinor)||p.priceMinor>budget||!integer(p.expiresAt)||p.expiresAt<=now||!Array.isArray(p.capabilities)||!p.capabilities.length||p.capabilities.some(c=>!t.capabilities.includes(c))||seen.has(t.key))fail('Untrusted, expired, duplicate or invalid offer');
    seen.add(t.key);return {key:t.key,operator:t.operator,price:p.priceMinor,capabilities:p.capabilities,offerHash:hash(envelope)};
  });
  // DP over the requested capability mask. Each provider can be hired once.
  const full=(1<<requirements.length)-1,dp=new Map([[0,{cost:0,team:[]}]]);
  for(const c of candidates){const mask=requirements.reduce((m,r,i)=>m|(c.capabilities.includes(r)?1<<i:0),0);
    for(const [m,state] of [...dp]){const next=m|mask,cost=state.cost+c.price;if(cost>budget)continue;
      const old=dp.get(next),team=[...state.team,c];
      if(!old||cost<old.cost||(cost===old.cost&&team.length<old.team.length))dp.set(next,{cost,team});
    }
  }
  const selected=dp.get(full);if(!selected)fail('No complete coalition within budget');
  return {...selected,taskRoot,unspent:budget-selected.cost,independentOperators:new Set(selected.team.map(t=>t.operator)).size,trust:'Signed registered-provider offers, not proof of supplier independence or delivery quality'};
}

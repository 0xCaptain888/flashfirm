import {hash, validSeal, allocate} from './protocol.mjs';
import {verifyReport, citationLocations} from './report-revision.mjs';

const hex = v => /^[a-f0-9]{64}$/.test(v ?? '');
const unique = rows => new Set(rows).size === rows.length;
export function reportWorkers(receipt) {
  if (!verifyReport(receipt).valid) throw Error('INVALID_REPORT');
  return receipt.payload.workers.map(w => ({id:w.worker.id, artifact:w.analysis}));
}
// Identity labels and distinct keys alone never count as independent people.
// Certificates must come from an operator-configured authority, outside the team.
export function verifyRoster(plan, certificates, authority, revokedSubjects = [], now = Date.now()) {
  if (!authority || [plan.buyerKey, ...plan.reviewerKeys, ...plan.workers.map(w=>w.key)].includes(authority))
    throw Error('EXTERNAL_IDENTITY_AUTHORITY_REQUIRED');
  const members=[...plan.workers.map(w=>({key:w.key,role:'WORKER',subject:w.subject})),
    ...plan.reviewerKeys.map(key=>({key,role:'REVIEWER'})),{key:plan.buyerKey,role:'BUYER'}];
  if (!Array.isArray(certificates) || certificates.length !== members.length) throw Error('COMPLETE_IDENTITY_ROSTER_REQUIRED');
  const subjects=[];
  for (const member of members) {
    const cert=certificates.find(c=>c.payload?.key===member.key),p=cert?.payload;
    if (!validSeal(cert,authority) || p?.version!=='flashfirm-identity/1' || p.taskRoot!==plan.taskRoot ||
      p.role!==member.role || !hex(p.subject) || (member.subject&&member.subject!==p.subject) ||
      revokedSubjects.includes(p.subject) || !hex(p.evidenceHash) ||
      !Number.isSafeInteger(p.issuedAt) || p.issuedAt>plan.createdAt || p.issuedAt>now ||
      !Number.isSafeInteger(p.expiresAt) || p.expiresAt<=now) throw Error('INVALID_OR_REVOKED_IDENTITY');
    if(member.role==='WORKER'){
      const worker=plan.workers.find(w=>w.key===member.key);
      if(p.artifactHash!==worker.artifactHash||p.authorshipReviewed!==true)throw Error('WORKER_AUTHORSHIP_ATTESTATION_REQUIRED');
    }
    subjects.push(p.subject);
  }
  if (!unique(subjects)) throw Error('SHARED_OPERATOR_OR_SYBIL_IDENTITY');
  return {verified:true,authority,subjects,scope:'External authority certificates; identity quality and collusion still depend on that authority.'};
}
export function validatePlan(envelope, record, review, now=Date.now()) {
  const p=envelope?.payload;
  if (!p || p.version!=='flashfirm-task-plan/1' || !validSeal(envelope,p.buyerKey) ||
    !record || p.taskRoot!==record.taskRoot || p.resultRoot!==record.receiptHash ||
    review?.commitment?.digest!==p.reviewPolicyHash || review.commitment.policy.buyerKey!==p.buyerKey ||
    hash(review.commitment.policy.reviewers.map(r=>r.key))!==hash(p.reviewerKeys) ||
    !unique(p.reviewerKeys) || p.reviewerKeys.length!==3 ||
    !Number.isSafeInteger(p.createdAt) || p.createdAt>now || p.createdAt<now-300000 ||
    !Number.isSafeInteger(p.expiresAt) || p.expiresAt<=now || p.expiresAt>now+7*86400000 ||
    !Number.isSafeInteger(p.budgetUnits) || p.budgetUnits<1 || p.budgetUnits>100000000 ||
    p.allocationAsset!=='ARBITRUM_NATIVE_USDC' || !Array.isArray(p.rubric) ||
    !p.rubric.length || p.rubric.length>32 || !unique(p.rubric.map(r=>r.id)) ||
    p.rubric.some(r=>!/^[-a-z0-9_]{1,64}$/.test(r.id)||!Number.isInteger(r.weight)||r.weight<1) ||
    p.rubric.reduce((s,r)=>s+r.weight,0)!==100 ||
    (p.privacyMode!==undefined&&!['PUBLIC_SOURCES','CONFIDENTIAL_QUOTATIONS'].includes(p.privacyMode)) ||
    (p.privacyMode==='CONFIDENTIAL_QUOTATIONS'&&!hex(p.privateTaskDigest))) throw Error('INVALID_TASK_PLAN');
  const workers=reportWorkers(record.receipt);
  if (!Array.isArray(p.workers) || p.workers.length!==workers.length ||
    !unique(p.workers.map(w=>w.id)) || !unique(p.workers.map(w=>w.key)) ||
    p.workers.some(w=>!workers.some(a=>a.id===w.id&&hash(a.artifact)===w.artifactHash) || !review.commitment.policy.workerKeys.includes(w.key) ||
      p.reviewerKeys.includes(w.key) || w.key===p.buyerKey || !hex(w.subject) ||
      !/^0x[a-f0-9]{40}$/.test(w.recipient??'') || /^0x0{40}$/.test(w.recipient))) throw Error('INVALID_WORKER_ROSTER');
  return {planHash:hash(envelope),plan:p,commitmentTiming:'POST_DELIVERY_PRE_EVALUATION',fundsMoved:false};
}
export function qualitySamples(receipt) {
  const workers=reportWorkers(receipt);
  // Neutral variant identifiers prevent explicit "removed worker" labels in the
  // evaluator prompt. Content may still identify its author; this is not anonymity.
  return [workers,...workers.map(w=>workers.filter(x=>x.id!==w.id))].map(rows=>{
    const input=rows.map(w=>w.artifact);
    return {sampleHash:hash(input),input};
  });
}
export async function runAblation(receipt, rubric, evaluate) {
  const samples=qualitySamples(receipt),results=[];
  for (const sample of samples) {
    // Caller owns provider budget reservation. This helper never retries or
    // invokes a provider itself; each coalition is actually evaluated separately.
    const result=await evaluate(structuredClone(sample.input),structuredClone(rubric));
    if (!result || !Array.isArray(result.criteria) || !hex(result.traceHash)) throw Error('EVALUATION_TRACE_REQUIRED');
    results.push({sampleHash:sample.sampleHash,...result});
  }
  return results;
}
function qualityScore(sample,rubric) {
  if (!sample || !Array.isArray(sample.criteria) || sample.criteria.length!==rubric.length ||
    !unique(sample.criteria.map(c=>c.id)) || !hex(sample.traceHash) ||
    sample.criteria.some(c=>!rubric.some(r=>r.id===c.id)||!Number.isInteger(c.score)||c.score<0||c.score>100)) throw Error('INCOMPLETE_ABLATION_EVALUATION');
  return rubric.reduce((s,r)=>s+r.weight*sample.criteria.find(c=>c.id===r.id).score,0);
}
export function assessTaskQuality(planEnvelope, receipt, evaluations) {
  const p=planEnvelope.payload,planHash=hash(planEnvelope),checked=verifyReport(receipt);
  if (!validSeal(planEnvelope,p.buyerKey) || !checked.valid || checked.receiptHash!==p.resultRoot || checked.taskRoot!==p.taskRoot ||
    checked.citationState!=='PASS' || !Array.isArray(evaluations) || evaluations.length<2 ||
    evaluations.length>3) throw Error('EXACT_REPORT_AND_TWO_EVALUATORS_REQUIRED');
  const claims=citationLocations(receipt),samples=qualitySamples(receipt),workers=reportWorkers(receipt);
  const seen=new Set(),scored=[];
  for (const envelope of evaluations) {
    const e=envelope?.payload,key=envelope?.publicKey;
    if (!p.reviewerKeys.includes(key) || !validSeal(envelope,key) || seen.has(key) ||
      e?.version!=='flashfirm-quality-evaluation/1' || e.planHash!==planHash ||
      e.resultRoot!==p.resultRoot || !['HUMAN_BLINDED','MODEL_REEXECUTED'].includes(e.method) ||
      !Number.isSafeInteger(e.issuedAt) || e.issuedAt<p.createdAt || e.issuedAt>=p.expiresAt ||
      !Array.isArray(e.claims) || e.claims.length!==claims.length ||
      !unique(e.claims.map(c=>`${c.workerId}:${c.claimIndex}`)) ||
      !Array.isArray(e.samples) || e.samples.length!==samples.length ||
      !unique(e.samples.map(s=>s.sampleHash))) throw Error('INVALID_QUALITY_EVALUATION');
    seen.add(key);
    for (const c of claims) {
      const v=e.claims.find(v=>v.workerId===c.workerId&&v.claimIndex===c.claimIndex);
      if (!v || v.claimHash!==hash(c) || !['SUPPORTED','UNSUPPORTED','CONTRADICTED','INFERENCE'].includes(v.verdict) ||
        typeof v.reason!=='string' || v.reason.trim().length<20 || v.reason.length>2000 ||
        typeof v.sourceContext!=='string' || !v.sourceContext.includes(c.quote) ||
        !(receipt.payload.parentReceipt??receipt).payload.sources.find(s=>s.id===c.sourceId)?.excerpt.includes(v.sourceContext))
        throw Error('CLAIM_CONTEXT_AND_REASON_REQUIRED');
    }
    scored.push(samples.map(s=>qualityScore(e.samples.find(x=>x.sampleHash===s.sampleHash),p.rubric)));
  }
  // Normalizing prose catches simple formatting/case-copying. Paraphrase and
  // collusion remain challenges for external identity and independent reviewers.
  const fingerprints=workers.map(w=>hash(w.artifact.claims.map(c=>(c.statement+' '+c.quote).normalize('NFKC').toLowerCase().replace(/\s+/g,' ').trim()).sort()));
  const score=s=>Math.round(scored.reduce((n,row)=>n+row[s],0)/scored.length);
  const rows=workers.map((w,i)=>{
    const duplicate=fingerprints.filter(f=>f===fingerprints[i]).length>1;
    const marginal=score(0)-score(i+1);
    return {id:w.id,duplicate,full:score(0),without:score(i+1),marginal,score:duplicate?0:Math.max(0,marginal),eligible:!duplicate&&marginal>0};
  });
  const issues=claims.filter(c=>evaluations.some(e=>e.payload.claims.find(v=>v.workerId===c.workerId&&v.claimIndex===c.claimIndex)?.verdict!=='SUPPORTED'));
  return {planHash,resultRoot:p.resultRoot,qualityHash:hash(evaluations),state:issues.length?'CHALLENGED':'ASSESSED',
    issues:issues.map(c=>({workerId:c.workerId,claimIndex:c.claimIndex})),scores:rows,
    allocation:allocate(p.budgetUnits,rows),methods:[...new Set(evaluations.map(e=>e.payload.method))],
    scope:'Signed semantic judgments and separately evaluated full/removal samples. Not objective truth or exact Shapley value.'};
}

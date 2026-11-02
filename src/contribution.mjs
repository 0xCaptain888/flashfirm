import { hash, validSeal, allocate } from './protocol.mjs';

// Counterfactual over a precommitted, reviewer-assessed rubric; not semantic AI
// truth, exact Shapley value, or a defense against colluding identity operators.
export function scoreContributions({taskRoot,resultRoot,rubric,workers,assessments,reviewerKeys,budget}) {
 if(!/^[a-f0-9]{64}$/.test(taskRoot)||!/^[a-f0-9]{64}$/.test(resultRoot)||!Array.isArray(rubric)||!rubric.length||rubric.length>32||new Set(rubric.map(r=>r.id)).size!==rubric.length||rubric.some(r=>typeof r.id!=='string'||!r.id||!Number.isSafeInteger(r.weight)||r.weight<=0)||rubric.reduce((s,r)=>s+r.weight,0)!==100)throw Error('Rubric weights must total 100');
 if(!Array.isArray(workers)||!workers.length||workers.length>32||new Set(workers.map(w=>w.id)).size!==workers.length||new Set(workers.map(w=>w.key)).size!==workers.length||workers.some(w=>!w.id||!w.key||!w.operator||!w.artifact))throw Error('Unique workers and keys required');
 if(!Array.isArray(reviewerKeys)||reviewerKeys.length!==3||new Set(reviewerKeys).size!==3||workers.some(w=>reviewerKeys.includes(w.key)))throw Error('Three disjoint pinned reviewer keys required');
 if(!Array.isArray(assessments)||assessments.length>3)throw Error('Invalid assessment count');
 const rubricHash=hash(rubric),seen=new Set(),votes=new Map();
 for(const envelope of assessments){
  const p=envelope?.payload,key=envelope?.publicKey;
  if(!reviewerKeys.includes(key)||!validSeal(envelope,key)||seen.has(key)||p?.version!=='flashfirm-contribution-review/1'||p.taskRoot!==taskRoot||p.resultRoot!==resultRoot||p.rubricHash!==rubricHash||!Array.isArray(p.coverage))throw Error('Invalid signed rubric assessment');
  seen.add(key);const pairs=new Set();
  for(const c of p.coverage){const w=workers.find(w=>w.id===c.workerId),r=rubric.find(r=>r.id===c.criterionId),pair=`${c.workerId}:${c.criterionId}`;
   if(!w||!r||c.artifactHash!==hash(w.artifact)||pairs.has(pair))throw Error('Invalid or repeated coverage claim');
   pairs.add(pair);votes.set(pair,(votes.get(pair)??0)+1);
  }
 }
 if(seen.size<2)throw Error('At least two authenticated rubric assessments required');
 // Duplicate artifacts share an evidence identity, regardless of worker label.
 const artifactGroups=new Map();for(const w of workers){const digest=hash(w.artifact),group=artifactGroups.get(digest)??[];group.push(w.id);artifactGroups.set(digest,group);}
 const accepted=workers.map(w=>({...w,criteria:rubric.filter(r=>(votes.get(`${w.id}:${r.id}`)??0)>=2).map(r=>r.id)}));
 const quality=rows=>rubric.reduce((sum,r)=>sum+(rows.some(w=>w.criteria.includes(r.id))?r.weight:0),0),full=quality(accepted);
 const scores=accepted.map(w=>{const duplicate=artifactGroups.get(hash(w.artifact)).length>1,without=quality(accepted.filter(x=>x.id!==w.id));return {id:w.id,eligible:!duplicate&&w.criteria.length>0,score:duplicate?0:(full-without)*100,marginal:full-without,duplicate,coverage:w.criteria};});
 return {taskRoot,resultRoot,rubricHash,quality:full,scores,allocation:allocate(budget,scores),scope:'Leave-one-worker-out coverage under signed rubric assessments. Duplicate artifacts receive no payout; overlapping useful work may have zero marginal value. Not an objective fairness proof.'};
}

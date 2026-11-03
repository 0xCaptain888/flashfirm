import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {identity, hash, seal} from '../src/protocol.mjs';
import {verifyReport, reviseReport} from '../src/report-revision.mjs';
import {createCase, caseStatus, exportCase, verifyCaseExport} from '../src/task-case.mjs';
import {WorkspaceStore} from '../src/workspace-store.mjs';
const parent=JSON.parse(readFileSync(new URL('../evidence/queued-live-receipt.json',import.meta.url),'utf8'));
const revision=JSON.parse(readFileSync(new URL('../evidence/revised-live-receipt.json',import.meta.url),'utf8'));
function setup() {
  let now=Date.now();
  const key=randomBytes(32),store=new WorkspaceStore(':memory:',key,()=>now),firm=store.create('alice','Real source report');
  return {store,firm,key,get now(){return now;},tick(ms){now+=ms;}};
}
function reviewPolicy(taskRoot,now) {
  const buyer=identity(),arbiter=identity(),worker=identity(),reviewers=[identity(),identity(),identity()];
  return {reviewers,policy:{taskRoot,buyerKey:buyer.publicKey,appealKey:arbiter.publicKey,workerKeys:[worker.publicKey],
    reviewers:reviewers.map((r,i)=>({key:r.publicKey,operator:'development-'+i})),expiresAt:now+600000,appealWindowMs:60000}};
}
test('editorial revision keeps original signature and quotes; no inherited approval',()=>{
  const original=verifyReport(parent),checked=verifyReport(revision);
  assert.equal(original.citationState,'CHALLENGED');assert.equal(checked.valid,true);
  assert.equal(checked.citationState,'PASS');assert.equal(checked.qualityState,'AWAITING_NEW_REVIEW');
  assert.equal(checked.modelReviewApplies,false);assert.equal(revision.payload.parentHash,hash(parent));
  assert.deepEqual(revision.payload.parentReceipt,parent);
  assert.equal(revision.payload.workers[0].analysis.claims[0].statement,parent.payload.workers[0].analysis.claims[0].statement);
  const tampered=structuredClone(revision);tampered.payload.state='REVIEWED';
  assert.equal(verifyReport(tampered).valid,false);
});
test('revision replay rejects changed statements, wrong parent and invented replacement even with a new editor signature',()=>{
  const editor=identity();
  for(const mutate of [
    p=>p.workers[0].analysis.claims[0].statement='A malicious changed statement.',
    p=>p.parentHash='0'.repeat(64),
    p=>p.edits[0].quote='This invented quotation never appeared in the source.'
  ]) {
    const p=structuredClone(revision.payload);p.editorKey=editor.publicKey;mutate(p);
    assert.equal(verifyReport(seal(p,editor)).valid,false);
  }
  assert.throws(()=>reviseReport(parent,[{workerId:'sentinel-live',claimIndex:0,operation:'RETRACT_CLAIM',reason:'x'},
    {workerId:'sentinel-live',claimIndex:0,operation:'RETRACT_CLAIM',reason:'x'}],editor),/INVALID_EDIT/);
});
test('immutable encrypted case enforces owner isolation and exact review/report linkage',()=>{
  const f=setup();
  try {
    const result=f.store.attachCase('alice',f.firm.id,revision);
    assert.equal(result.status.state,'AWAITING_REVIEW');
    assert.equal(f.store.attachCase('alice',f.firm.id,revision).status.receiptHash,hash(revision));
    assert.throws(()=>f.store.attachCase('alice',f.firm.id,parent),/immutable/);
    assert.throws(()=>f.store.enqueue('alice',f.firm.id,'wrong-report',{kind:'VERIFY_RECEIPT',receipt:parent}),/CASE_REPORT_MISMATCH/);
    assert.equal(f.store.enqueue('alice',f.firm.id,'exact-report',{kind:'VERIFY_RECEIPT',receipt:revision}).state,'QUEUED');
    assert.throws(()=>f.store.case('bob',f.firm.id),/not found/);
    const {policy}=reviewPolicy(result.status.taskRoot,f.now);
    assert.throws(()=>f.store.pinReview('alice',f.firm.id,policy,hash(parent)),/EXACT_CASE_REPORT/);
    const report=JSON.stringify(revision);
    assert.ok(!f.store.db.prepare('SELECT blob FROM task_cases').get().blob.includes(report.slice(0,100)));
    f.store.pinReview('alice',f.firm.id,policy,hash(revision));
    assert.equal(f.store.case('alice',f.firm.id).status.review.state,'AWAITING_QUORUM');
  } finally {f.store.close();}
});
test('even key-quorum eligibility never imports unrelated TEE, payment or reviewer independence',()=>{
  const f=setup();
  try {
    const record=f.store.attachCase('alice',f.firm.id,revision);
    const {policy,reviewers}=reviewPolicy(record.status.taskRoot,f.now);
    const round=f.store.pinReview('alice',f.firm.id,policy,hash(revision));
    for(const reviewer of reviewers.slice(0,2)) f.store.decide('alice',f.firm.id,seal({
      version:'flashfirm-decision/1',policyHash:round.commitment.digest,taskRoot:policy.taskRoot,resultRoot:hash(revision),
      verdict:'APPROVE',reason:'Development signature integration test',issuedAt:f.now
    },reviewer));
    f.tick(60001);
    const status=f.store.case('alice',f.firm.id).status;
    assert.equal(status.review.state,'RELEASE_ELIGIBLE');assert.equal(status.settlementExecuted,false);
    assert.equal(status.independentOperatorsVerified,false);
    assert.equal(status.gates.find(g=>g.id==='privacy').state,'NO_TASK_BOUND_TEE_PROOF');
    assert.equal(status.gates.find(g=>g.id==='settlement').state,'NOT_EXECUTED');
    const dossier=f.store.exportCase('alice',f.firm.id);
    assert.equal(verifyCaseExport(dossier).valid,true);
    dossier.payload.review.resultRoot=hash(parent);
    dossier.digest=hash(dossier.payload);
    assert.equal(verifyCaseExport(dossier).valid,false);
  } finally {f.store.close();}
});
test('challenged quality survives quorum; inbox acknowledgements persist and closure preserves public evidence only',()=>{
  const f=setup();
  try {
    f.store.attachCase('alice',f.firm.id,parent);
    assert.equal(f.store.case('alice',f.firm.id).status.state,'REWORK_REQUIRED');
    const inbox=f.store.notifications('alice',f.firm.id);assert.equal(inbox.unread,1);
    f.store.acknowledge('alice',f.firm.id,inbox.items[0].id);
    assert.equal(f.store.notifications('alice',f.firm.id).unread,0);
    assert.throws(()=>f.store.acknowledge('bob',f.firm.id,inbox.items[0].id),/not found/);
    assert.throws(()=>f.store.acknowledge('alice',f.firm.id,'a'.repeat(64)),/Unknown/);
    f.store.dissolve('alice',f.firm.id);
    assert.equal(f.store.case('alice',f.firm.id).status.state,'CLOSED');
    assert.equal(verifyCaseExport(f.store.exportCase('alice',f.firm.id)).valid,true);
    assert.throws(()=>f.store.attachCase('alice',f.firm.id,parent),/closed/);
  } finally {f.store.close();}
});
test('a prior policy cannot be silently rebound by importing a different task report',()=>{
  const f=setup();
  try{
    const {policy}=reviewPolicy('c'.repeat(64),f.now);
    f.store.pinReview('alice',f.firm.id,policy,'d'.repeat(64));
    assert.throws(()=>f.store.attachCase('alice',f.firm.id,revision),/EXACT_CASE_REPORT/);
    assert.equal(f.store.case('alice',f.firm.id).status.attached,false);
  }finally{f.store.close();}
});

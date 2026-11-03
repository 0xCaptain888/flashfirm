import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {taskFixture} from '../test-support/task-flow.mjs';
import {hash,seal,identity} from '../src/protocol.mjs';
import {validatePlan,assessTaskQuality,verifyRoster,runAblation,qualitySamples} from '../src/task-quality.mjs';
import {settlementManifest,authorizeInvoice} from '../src/task-settlement.mjs';
import {sqliteAdapter} from '../src/sqlite-adapter.mjs';
import {taskFlowOperation} from '../src/task-flow-store.mjs';
test('semantic support requires exact claims, source context, separate signed evaluations and complete ablations',async()=>{
 const f=taskFixture();
 assert.equal(validatePlan(f.plan,f.record,f.review,f.now).commitmentTiming,'POST_DELIVERY_PRE_EVALUATION');
 const quality=assessTaskQuality(f.plan,f.receipt,f.evaluations);
 assert.equal(quality.state,'ASSESSED');assert.deepEqual(quality.scores.map(s=>s.marginal),[1000,2000,3000]);
 assert.equal(quality.allocation.payouts.reduce((s,r)=>s+r.amount,quality.allocation.fee),1000000);
 const changed=structuredClone(f.evaluations[0].payload);changed.claims[0].verdict='UNSUPPORTED';
 assert.equal(assessTaskQuality(f.plan,f.receipt,[seal(changed,f.reviewers[0]),f.evaluations[1]]).state,'CHALLENGED');
 changed.claims[0].claimHash='a'.repeat(64);
 assert.throws(()=>assessTaskQuality(f.plan,f.receipt,[seal(changed,f.reviewers[0]),f.evaluations[1]]),/CONTEXT/);
 const missing=structuredClone(f.evaluations[0].payload);missing.samples.pop();
 assert.throws(()=>assessTaskQuality(f.plan,f.receipt,[seal(missing,f.reviewers[0]),f.evaluations[1]]),/EVALUATION/);
 assert.throws(()=>assessTaskQuality(f.plan,f.receipt,[f.evaluations[0],f.evaluations[0]]),/EVALUATION/);
 const inputs=[];const samples=await runAblation(f.receipt,f.plan.payload.rubric,async(input)=>{
  inputs.push(input);return {criteria:[{id:'source-support',score:input.length*30}],traceHash:hash(input)};
 });
 assert.equal(inputs.length,4);assert.deepEqual(inputs.map(i=>i.length),[3,2,2,2]);
 assert.equal(samples[0].sampleHash,qualitySamples(f.receipt)[0].sampleHash);
});
test('one person controlling different keys, expired or self-issued authority identities cannot release funds',()=>{
 const f=taskFixture(),p=f.plan.payload;
 assert.equal(verifyRoster(p,f.certificates,f.authority.publicKey,[],f.now).verified,true);
 assert.throws(()=>verifyRoster(p,f.certificates,f.buyer.publicKey,[],f.now),/EXTERNAL/);
 assert.throws(()=>verifyRoster(p,f.certificates,f.authority.publicKey,[p.workers[0].subject],f.now),/REVOKED/);
 const certs=structuredClone(f.certificates),changed=certs.at(-1).payload;
 changed.subject=certs.at(-2).payload.subject;certs[certs.length-1]=seal(changed,f.authority);
 assert.throws(()=>verifyRoster(p,certs,f.authority.publicKey,[],f.now),/SYBIL/);
 assert.throws(()=>settlementManifest(f.flow,f.record,f.review,{},f.now+60001),/AUTHORITY/);
 const manifest=settlementManifest(f.flow,f.record,f.review,{authority:f.authority.publicKey},f.now+60001);
 assert.equal(manifest.payouts.length,3);
 assert.throws(()=>settlementManifest(f.flow,f.record,f.review,{authority:f.authority.publicKey},f.now+1000),/CLEARANCE/);
 const worker=manifest.payouts[0],invoice=seal({version:'flashfirm-task-invoice/1',manifestHash:hash(manifest),
  workerId:worker.id,recipient:worker.recipient,minimumUsdcUnits:String(worker.amount),nonce:'a'.repeat(64),
  sourceAccount:'payer.near',originAmountYocto:'100000000000000000000000',maximumFeeYocto:'10000000000000000000000',
  issuedAt:f.now+60001,expiresAt:f.now+1800000},f.buyer);
 assert.equal(authorizeInvoice(invoice,manifest,f.flow,f.now+60001).state,'AUTHORIZED_NOT_FUNDED');
 const forged=structuredClone(invoice.payload);forged.recipient='0x'+'9'.repeat(40);
 assert.throws(()=>authorizeInvoice(seal(forged,f.buyer),manifest,f.flow,f.now+60001),/SIGNED_INVOICE/);
});
test('durable task flow locks one plan, conserves allocation and rejects closed, restored and cross-owner writes',async()=>{
 const f=taskFixture(),db=new DatabaseSync(':memory:');
 for(const file of ['0001_workspace.sql','0002_task_cases.sql','0003_task_flow.sql'])db.exec(readFileSync(new URL('../cloudflare/migrations/'+file,import.meta.url),'utf8'));
 const firm={id:'unit-firm',owner:'alice',state:'ACTIVE'};
 db.prepare('INSERT INTO firms VALUES(?,?,?,?,?)').run(firm.id,firm.owner,'Task',firm.state,f.now);
 const adapter={db:sqliteAdapter(db),access:async(o,id,active)=>{
  if(o!==firm.owner||id!==firm.id)throw Error('NOT_FOUND');
  if(active&&firm.state!=='ACTIVE')throw Error('CLOSED');return firm;
 },context:async()=>({record:f.record,review:f.review}),encrypt:async(f,v)=>JSON.stringify(v),
 decrypt:async(f,b)=>JSON.parse(b),security:{authority:f.authority.publicKey}};
 try{
  const call=(op,input={},time=f.now)=>taskFlowOperation(adapter,'alice',firm.id,op,input,time);
  assert.equal((await call('status')).status.state,'NO_PLAN');
  await call('plan',f.plan);await call('plan',f.plan);
  assert.equal(db.prepare("SELECT count(*) n FROM events WHERE kind='TASK_FLOW_PLAN'").get().n,1);
  await call('quality',{evaluations:f.evaluations,certificates:f.certificates,contributions:f.contributions});
  const locked=await call('manifest',{},f.now+60001);assert.equal(locked.status.manifest.payouts.length,3);
  await assert.rejects(call('quality',{evaluations:f.evaluations}),/LOCKED/);
  await assert.rejects(taskFlowOperation(adapter,'bob',firm.id,'status'),/NOT_FOUND/);
  assert.equal(db.prepare('SELECT count(*) n FROM task_payment_claims').get().n,2);
  db.prepare('INSERT INTO recovery_holds VALUES(?)').run(firm.id);
  await assert.rejects(call('manifest',{},f.now+60001),/RECONCILIATION/);
  firm.state='CLOSED';await assert.rejects(call('quality',{}),/CLOSED/);
  assert.equal((await call('status')).status.state,'AWAITING_PAYMENT');
 }finally{db.close();}
});

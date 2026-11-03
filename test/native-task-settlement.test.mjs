import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {nativeFixture} from '../test-support/native-task.mjs';
import {hash,seal} from '../src/protocol.mjs';
import {assessTaskQuality,validatePlan} from '../src/task-quality.mjs';
import {authorizeInvoice,taskFlowStatus} from '../src/task-settlement.mjs';
import {nativeAllocation,validateNativeSettlement,NATIVE_TREASURY_SHA256} from '../src/native-task-settlement.mjs';
import {taskFixture} from '../test-support/task-flow.mjs';
import {settlementManifest} from '../src/task-settlement.mjs';
import {DatabaseSync} from 'node:sqlite';
import {sqliteAdapter} from '../src/sqlite-adapter.mjs';
import {taskFlowOperation} from '../src/task-flow-store.mjs';
test('signed spend cap conserves workers, fee and unused budget; every obligation needs real payment evidence',()=>{
 const f=nativeFixture(),m=f.flow.manifest;
 validatePlan(f.plan,f.record,f.review,f.now);
 const a=assessTaskQuality(f.plan,f.receipt,f.evaluations).allocation;
 assert.equal(a.fee,16000);assert.equal(a.refund,200000);
 assert.equal(a.payouts.reduce((n,w)=>n+w.amount,a.fee+a.refund),1000000);
 assert.equal(m.obligations.length,5);
 for(const o of m.obligations){
  const envelope=seal({version:'flashfirm-task-invoice/2',manifestHash:hash(m),obligationId:o.id,kind:o.kind,workerId:o.workerId,
   recipient:o.recipient,minimumUsdcUnits:String(o.amount),nonce:hash(o.id),sourceAccount:'buyer.near',
   originAmountYocto:'1000000000000000000000',maximumFeeYocto:'100000000000000000000',issuedAt:f.nativeNow,expiresAt:f.now+1800000},f.buyer);
  const invoice=authorizeInvoice(envelope,m,f.flow,f.nativeNow);
  f.flow.invoices.push({...invoice,state:'VERIFIED',evidence:{paymentVerified:true}});
  if(o.kind==='WORKER')assert.equal(taskFlowStatus(f.flow).taskSettlementComplete,false);
 }
 assert.equal(taskFlowStatus(f.flow).state,'ALL_TASK_PAYMENTS_VERIFIED');
 f.flow.invoices.at(-1).evidence={paymentVerified:false};
 assert.equal(taskFlowStatus(f.flow).taskSettlementComplete,false);
});
test('zero authorized spend returns the full budget with no fee or worker payment',()=>{
 const f=taskFixture({settlementPolicy:{version:'flashfirm-allocation-policy/2',spendUnits:0,feeBps:200,
  feeRecipient:'0x'+'a'.repeat(40),refundRecipient:'0x'+'b'.repeat(40)}});
 const manifest=settlementManifest(f.flow,f.record,f.review,{authority:f.authority.publicKey},f.now+60001);
 assert.equal(manifest.payouts.length,0);assert.equal(manifest.feeUnits,0);
 assert.equal(manifest.obligations.length,1);assert.equal(manifest.obligations[0].amount,1000000);
});
test('durable native authorization fences competing payment paths and cross-task treasury reuse',async()=>{
 const f=nativeFixture(),db=new DatabaseSync(':memory:');
 for(const name of ['0001_workspace.sql','0002_task_cases.sql','0003_task_flow.sql'])
  db.exec(readFileSync(new URL('../cloudflare/migrations/'+name,import.meta.url),'utf8'));
 const adapter={db:sqliteAdapter(db),access:async(o,id)=>({id,owner:o,state:'ACTIVE'}),
  context:async()=>({record:f.record,review:f.review}),encrypt:async(id,v)=>JSON.stringify(v),
  decrypt:async(id,v)=>JSON.parse(v),security:{authority:f.authority.publicKey}};
 try{
  const call=(id,op,input={},now=f.now)=>taskFlowOperation(adapter,'alice',id,op,input,now);
  for(const id of ['task-a','task-b']){
   db.prepare('INSERT INTO firms VALUES(?,?,?,?,?)').run(id,'alice','Native test','ACTIVE',f.now);
   await call(id,'plan',f.plan);
   await call(id,'quality',{evaluations:f.evaluations,certificates:f.certificates,contributions:f.contributions});
   await call(id,'manifest',{},f.now+60001);
  }
  await call('task-a','native',f.authorization,f.nativeNow);
  await call('task-a','native',f.authorization,f.nativeNow);
  await assert.rejects(call('task-a','invoice',{},f.nativeNow),/PATH_ALREADY_LOCKED/);
  await assert.rejects(call('task-b','native',f.authorization,f.nativeNow),/constraint/i);
  assert.equal(db.prepare("SELECT count(*) n FROM task_payment_claims WHERE chain='native-treasury:testnet'").get().n,1);
  assert.equal((await call('task-b','status')).flow.nativeSettlement,undefined);
 }finally{db.close();}
});
test('native budget, each recipient and tested bytecode are separately buyer authorized',()=>{
 const f=nativeFixture(),v=validateNativeSettlement(f.authorization,f.flow,f.nativeNow);
 assert.equal(v.parts.reduce((n,o)=>n+BigInt(o.amountYocto),0n),BigInt(v.budgetYocto));
 assert.equal(v.planHash.length,64);
 const alter=change=>{const p=structuredClone(f.nativePayload);change(p);return seal(p,f.buyer);};
 for(const bad of [
  alter(p=>p.wasmSha256='0'.repeat(64)),alter(p=>p.nativeBudgetYocto='10000000000000000000001'),
  alter(p=>p.resultRoot='0'.repeat(64)),alter(p=>p.accounts.at(-1).accountId='fee.testnet'),
  alter(p=>p.accounts[0].accountId='buyer.testnet'),alter(p=>p.config.init.policy_hash='a'.repeat(64))
 ])assert.throws(()=>validateNativeSettlement(bad,f.flow,f.nativeNow));
 assert.throws(()=>nativeAllocation(f.flow.manifest,'1'),/SMALL/);
 const wasm=readFileSync(new URL('../artifacts/flashfirm_treasury.wasm',import.meta.url));
 assert.equal(createHash('sha256').update(wasm).digest('hex'),NATIVE_TREASURY_SHA256);
 assert.equal(taskFlowStatus({...f.flow,nativeSettlement:{evidence:{verified:true}}}).taskSettlementComplete,false);
});

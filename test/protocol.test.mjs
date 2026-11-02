import test from 'node:test';
import assert from 'node:assert/strict';
import { Engine, createTask, transition } from '../src/engine.mjs';
import { allocate, verifyReceipt, seal } from '../src/protocol.mjs';

function complete(fault = true) { const engine = new Engine(); const task = createTask({fault}); for(let i=0;i<8;i++)engine.advance(task);return {engine, task}; }
test('failed specialist is replaced without additional funding; proof replays', () => {
  const {task} = complete();assert.equal(task.state,'PLANNED');assert.equal(task.work.length,4);assert.equal(task.work.filter(w=>!w.accepted).length,1);
  assert.equal(task.receipt.payload.allocation.payouts.find(p=>p.id.startsWith('signal:')).amount,0);
  assert.equal(verifyReceipt(task.receipt).valid,true);assert.equal(task.receipt.payload.settlement.status,'NOT_EXECUTED');
});
test('success path requires no replacement', () => {const {task}=complete(false);assert.equal(task.work.length,3);assert.equal(verifyReceipt(task.receipt).valid,true);});
test('completed task is idempotent', () => {const {task,engine}=complete();const before=JSON.stringify(task);engine.advance(task);assert.equal(JSON.stringify(task),before);});
test('cannot jump from draft to accepted',()=>assert.throws(()=>transition(createTask(),'ACCEPTED')));
test('allocation conserves all integer budgets across randomized cases',()=>{
  let seed=12345;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed;};
  for(let i=0;i<3000;i++){const budget=random()%100000001;const rows=Array.from({length:random()%12},(_,j)=>({id:String(j),score:random()%10001,eligible:random()%3!==0}));const p=allocate(budget,rows);assert.equal(p.payouts.reduce((s,r)=>s+r.amount,0)+p.fee+p.refund,budget);for(const row of rows.filter(r=>!r.eligible))assert.equal(p.payouts.find(p=>p.id===row.id).amount,0);}
});
test('all ineligible means full refund with zero fee',()=>assert.deepEqual(allocate(1000,[{id:'bad',score:9000,eligible:false}]),{budget:1000,fee:0,refund:1000,payouts:[{id:'bad',amount:0}]}));
test('duplicate recipients and invalid numbers rejected',()=>{assert.throws(()=>allocate(10,[{id:'a',score:1,eligible:true},{id:'a',score:2,eligible:true}]));assert.throws(()=>allocate(NaN,[]));assert.throws(()=>allocate(10,[{id:'x',score:Infinity,eligible:true}]));});
test('tampered payout fails even with a fresh coordinator signature',()=>{const {task,engine}=complete();task.receipt.payload.allocation.payouts[0].amount++;const forged=seal(task.receipt.payload,engine.keys.coordinator);assert.equal(verifyReceipt(forged).valid,false);});
test('forged citation acceptance fails even with a fresh coordinator signature',()=>{const {task,engine}=complete();task.receipt.payload.work.find(w=>!w.accepted).accepted=true;assert.equal(verifyReceipt(seal(task.receipt.payload,engine.keys.coordinator)).valid,false);});
test('tampered signatures fail',()=>{const {task}=complete();task.receipt.signature='invalid';assert.equal(verifyReceipt(task.receipt).valid,false);});
test('cross-task work replay fails after resigning coordinator envelope',()=>{const {task,engine}=complete();task.receipt.payload.taskId='other-task';assert.equal(verifyReceipt(seal(task.receipt.payload,engine.keys.coordinator)).valid,false);});
test('malformed receipt fails closed',()=>{for(const value of [null,{},[],{payload:{}}])assert.equal(verifyReceipt(value).valid,false);});
test('empty coalition cannot masquerade as a complete receipt',()=>{const {task,engine}=complete();task.receipt.payload.work=[];assert.equal(verifyReceipt(seal(task.receipt.payload,engine.keys.coordinator)).valid,false);});

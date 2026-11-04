import test from 'node:test';
import assert from 'node:assert/strict';
import {taskFixture} from '../test-support/task-flow.mjs';
import {settlementManifest,authorizeInvoice} from '../src/task-settlement.mjs';
import {taskPaymentHandoff} from '../src/task-payment-handoff.mjs';
import {hash,seal} from '../src/protocol.mjs';
test('task handoff conserves exact per-source totals, keeps missing obligations visible and prevents double-payment previews',()=>{
 const f=taskFixture({settlementPolicy:{version:'flashfirm-allocation-policy/2',spendUnits:800000,feeBps:200,
  feeRecipient:'0x'+'a'.repeat(40),refundRecipient:'0x'+'b'.repeat(40)}});
 const now=f.now+60001;f.flow.manifest=settlementManifest(f.flow,f.record,f.review,{authority:f.authority.publicKey},now);
 const o=f.flow.manifest.obligations[0],authorization=seal({version:'flashfirm-task-invoice/2',
  obligationId:o.id,kind:o.kind,workerId:o.workerId,manifestHash:hash(f.flow.manifest),recipient:o.recipient,
  minimumUsdcUnits:String(o.amount),sourceAccount:'payer.near',originAmountYocto:'500000000000000000000000',
  maximumFeeYocto:'1000000000000000000000',nonce:hash('handoff-test'),issuedAt:now,expiresAt:f.plan.payload.expiresAt},f.buyer);
 const invoice={...authorizeInvoice(authorization,f.flow.manifest,f.flow,now),authorization};
 f.flow.invoices=[invoice];
 const result=taskPaymentHandoff(f.flow,{},now);
 assert.equal(result.rows[0].blocker,'CURRENT_RELEASE_CHECKS_NOT_CLEAR');
 assert.equal(result.sourceBudgets[0].maximumTotalYocto,'501000000000000000000000');
 assert.equal(result.missingObligations.length,f.flow.manifest.obligations.length-1);
 assert.equal(taskPaymentHandoff(f.flow,{releaseReady:true},now).rows[0].blocker,'OFFICIAL_SIGNED_QUOTE_REQUIRED');
 invoice.sourceHash='1'.repeat(44);
 assert.equal(taskPaymentHandoff(f.flow,{releaseReady:true},now).rows[0].preview,null);
 assert.match(taskPaymentHandoff(f.flow,{releaseReady:true},now).rows[0].blocker,/ALREADY_SUBMITTED/);
 invoice.recipient='0x'+'c'.repeat(40);
 assert.throws(()=>taskPaymentHandoff(f.flow,{},now),/BINDING_CHANGED/);
});

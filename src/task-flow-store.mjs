import {hash} from './protocol.mjs';
import {validatePlan,assessTaskQuality,qualitySamples} from './task-quality.mjs';
import {citationLocations} from './report-revision.mjs';
import {settlementManifest,authorizeInvoice,taskFlowStatus} from './task-settlement.mjs';
import {bindTaskQuote,verifyTaskPayment,verifyNativeRefund} from './settlement-proof.mjs';
import {verifyTaskPrivacy} from './task-privacy.mjs';
const q=(db,sql,...args)=>db.prepare(sql).bind(...args);
// The adapter supplies authenticated access, encryption and operator-pinned
// verifier functions. None of those trust roots can come from an HTTP payload.
export async function taskFlowOperation(adapter,owner,firmId,operation,input={},now=Date.now()){
  const {db}=adapter;
  const firm=await adapter.access(owner,firmId,operation!=='status');
  const {record,review}=await adapter.context(firm);
  const row=await q(db,'SELECT * FROM task_flows WHERE firm=?',firmId).first();
  let flow=row?await adapter.decrypt(firmId,row.blob):null;
  if(operation==='status')return {flow,record,status:taskFlowStatus(flow),
    samples:record?qualitySamples(record.receipt):[],
    claims:record?citationLocations(record.receipt).map(c=>({...c,claimHash:hash(c)})):[],
    identityAuthorityConfigured:!!adapter.security?.authority};
  if(!['verify','refund'].includes(operation)&&await q(db,'SELECT 1 FROM recovery_holds WHERE firm=?',firmId).first())
    throw Error('RESTORED_TASK_REQUIRES_OPERATOR_RECONCILIATION');
  if(!record)throw Error('REPORT_REQUIRED');
  if(operation==='plan'){
    validatePlan(input,record,review,now);
    if(flow){if(hash(flow.plan)!==hash(input))throw Error('IMMUTABLE_TASK_PLAN');return {status:taskFlowStatus(flow)};}
    flow={version:'flashfirm-task-flow/1',plan:input,evaluations:[],certificates:[],invoices:[]};
    const blob=await adapter.encrypt(firmId,flow);
    await db.batch([
      q(db,'INSERT INTO task_flows(firm,blob) VALUES(?,?)',firmId,blob),
      q(db,'INSERT INTO events(firm,kind,data,created) VALUES(?,?,?,?)',firmId,'TASK_FLOW_PLAN',
        JSON.stringify({planHash:hash(input),manifestHash:null}),now)
    ]);
    return {status:taskFlowStatus(flow)};
  }
  if(!flow)throw Error('TASK_PLAN_REQUIRED');
  const p=flow.plan.payload;
  if(operation!=='verify'&&operation!=='refund'&&now>=p.expiresAt)throw Error('TASK_PLAN_EXPIRED');
  const claims=[];
  if(operation==='quality'){
    if(flow.manifest)throw Error('MANIFEST_ALREADY_LOCKED');
    const quality=assessTaskQuality(flow.plan,record.receipt,input.evaluations);
    flow.evaluations=input.evaluations;flow.certificates=input.certificates??[];flow.contributions=input.contributions??[];
    flow.quality=quality;
  }else if(operation==='privacy'){
    if(flow.manifest)throw Error('MANIFEST_ALREADY_LOCKED');
    flow.privacy=await verifyTaskPrivacy(flow,input,adapter.security?.releaseAuthority,adapter.fetcher??fetch,now);
    flow.privacyProof=input;
  }else if(operation==='manifest'){
    if(flow.manifest)return {status:taskFlowStatus(flow)};
    flow.manifest=settlementManifest(flow,record,review,adapter.security,now);
  }else if(operation==='invoice'){
    if(!flow.manifest)throw Error('MANIFEST_REQUIRED');
    if(hash(flow.manifest)!==hash(settlementManifest(flow,record,review,adapter.security,now)))throw Error('MANIFEST_BINDING_CHANGED');
    const invoice=authorizeInvoice(input,flow.manifest,flow,now);
    const old=flow.invoices.find(i=>i.workerId===invoice.workerId);
    if(old){if(old.invoiceHash!==invoice.invoiceHash)throw Error('ONE_INVOICE_PER_WORKER_RECONCILE_BEFORE_RETRY');return {status:taskFlowStatus(flow)};}
    flow.invoices.push({...invoice,authorization:input});
  }else if(['quote','verify','refund'].includes(operation)){
    const invoice=flow.invoices.find(i=>i.invoiceHash===input.invoiceHash);
    if(!invoice)throw Error('INVOICE_REQUIRED');
    if(operation==='quote'){
      if(invoice.quote){if(hash(invoice.quote)!==hash(input.quote))throw Error('QUOTE_ALREADY_BOUND');return {status:taskFlowStatus(flow)};}
      Object.assign(invoice,bindTaskQuote(invoice,input.quote,now));
      claims.push(['deposit',invoice.quote.quote.depositAddress,invoice.invoiceHash]);
    }else{
      if(invoice.state==='VERIFIED'||invoice.state==='REFUNDED')return {status:taskFlowStatus(flow)};
      if(!adapter.verifiers)throw Error('PINNED_MAINNET_VERIFIERS_NOT_CONFIGURED');
      if(!/^[1-9A-HJ-NP-Za-km-z]{40,44}$/.test(input.hash??''))throw Error('INVALID_NEAR_TRANSACTION_HASH');
      if(invoice.sourceHash&&operation==='verify'&&invoice.sourceHash!==input.hash)throw Error('SOURCE_TRANSACTION_ALREADY_BOUND');
      const evidence=operation==='verify'?await verifyTaskPayment(invoice,input.hash,adapter.verifiers):
        await verifyNativeRefund(invoice,input.hash,adapter.verifiers);
      if(operation==='refund'&&invoice.state!=='REFUND_PENDING')throw Error('REFUND_NOT_PENDING');
      if(operation==='verify'){invoice.sourceHash=input.hash;claims.push(['near',input.hash,invoice.invoiceHash]);}
      if(evidence.delivery)claims.push(['0xa4b1',evidence.delivery.transactionHash,invoice.invoiceHash]);
      if(evidence.refundHash)claims.push(['near',evidence.refundHash,invoice.invoiceHash]);
      invoice.state=evidence.state;invoice.evidence=evidence;
    }
  }else throw Error('UNKNOWN_TASK_FLOW_OPERATION');
  // Check again after external verification. Batch/CAS fences close races,
  // duplicate chain transactions and simultaneous updates across instances.
  await adapter.access(owner,firmId,true);
  const blob=await adapter.encrypt(firmId,flow);
  const statements=claims.map(([chain,tx,invoice])=>q(db,`INSERT INTO task_payment_claims VALUES(?,?,?,?)
    ON CONFLICT(chain,hash) DO UPDATE SET invoice=CASE WHEN task_payment_claims.firm=excluded.firm AND task_payment_claims.invoice=excluded.invoice THEN excluded.invoice ELSE NULL END`,chain,tx,firmId,invoice));
  // A failed CAS must roll back claim insertion too. A guard uses NOT NULL
  // revision to make that failure abort the whole batch instead of returning 0.
  statements.push(q(db,`UPDATE task_flows SET blob=?,revision=CASE WHEN revision=? THEN revision+1 ELSE NULL END WHERE firm=?`,blob,row.revision,firmId));
  statements.push(q(db,'INSERT INTO events(firm,kind,data,created) VALUES(?,?,?,?)',firmId,'TASK_FLOW_'+operation.toUpperCase(),
    JSON.stringify({planHash:hash(flow.plan),manifestHash:flow.manifest?hash(flow.manifest):null}),now));
  await db.batch(statements);
  return {status:taskFlowStatus(flow),quality:flow.quality??null,fundsMoved:false};
}

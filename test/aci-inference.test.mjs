import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,createPublicKey,sign} from 'node:crypto';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {identity,hash,seal,canonical} from '../src/protocol.mjs';
import {runConfidentialInference} from '../src/aci-inference.mjs';
import {requireAciPass,acceptInferenceCertificates} from '../src/aci-policy.mjs';
import {reserveAciSpend} from '../src/aci-budget.mjs';
import {computeSessionId,receiptTranscript,hashBody} from '@phala/aci-verifier';
import {taskFixture} from '../test-support/task-flow.mjs';
import {settlementManifest} from '../src/task-settlement.mjs';
const pass=ids=>({verdict:{verified:true},lines:ids.map(id=>({id,status:'pass'}))});
async function fixture(){
 const now=Date.now(),authority=identity(),task={instruction:'Analyze supplied private fixture',document:'Synthetic confidential input only.'},
  taskRoot=hash('unit-task'),model='test-model',workerId='source-review';
 const evidenceBytes=Buffer.from('synthetic upstream fixture, no real hardware evidence');
 const evidence={digest:'sha256:'+createHash('sha256').update(evidenceBytes).digest('hex'),
  data:'data:application/json;base64,'+evidenceBytes.toString('base64')};
 const session={api_version:'aci/1',established_at:Math.floor(now/1000)-1,expires_at:Math.floor(now/1000)+1000,evidence},
  sessionId=await computeSessionId(session);
 const verifiedIdentity={expiresAt:now+900000,composeHash:hash('reviewed-test-compose'),
  workloadKeysetDigest:hash('test-keyset'),report:{attestation:{evidence:{quote:'SYNTHETIC'}}},
  transcript:pass(['id-1','id-2','id-3','id-4','id-6'])};
 const approval=seal({version:'flashfirm-aci-release/1',origin:'https://inference.phala.com',taskRoot,taskDigest:hash(task),
  model,workerId,privateInferenceAllowed:true,issuedAt:now-1000,expiresAt:now+900000,
  composeHashes:[verifiedIdentity.composeHash],sessionIds:[sessionId],maxInputBytes:20000,maxOutputTokens:1000,reservationFen:100},authority);
 const runtimeAudit=seal({version:'flashfirm-aci-runtime-audit/1',origin:'https://inference.phala.com',model,
  composeHash:verifiedIdentity.composeHash,workloadKeysetDigest:verifiedIdentity.workloadKeysetDigest,
  gatewayEvidenceHash:hash(verifiedIdentity.report.attestation.evidence),sessionId,sessionEvidenceHash:hash(evidence),
  modelMeasurement:hash('test-model-measurement'),runtimeMeasurement:hash('test-runtime'),
  productionOsVerified:true,kmsCustodyVerified:true,debugDisabled:true,upstreamEvidenceAppraised:true,weightsAndRuntimeVerified:true,
  issuedAt:now-1000,expiresAt:now+900000},authority);
 const output={analysis:'Synthetic output'},receipt={model,method:'POST',endpoint:'/v1/chat/completions',event_log:[{type:'upstream.verified',session_id:sessionId,required:true,result:'verified'}]};
 const stats={sent:0,reserved:0,closed:0};
 const connection={identity:verifiedIdentity,close:async()=>stats.closed++,
  fetch:async(url,init)=>{
   if(url.includes('/aci/sessions/'))return new Response(JSON.stringify(session));
   stats.sent++;assert.equal(JSON.parse(init.body).messages[1].content,canonical(task));
   return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(output)}}]}));
  },receipts:()=>[{receiptId:'unit-receipt',method:'POST',path:'/v1/chat/completions',status:200,responseComplete:true}],
  verifyReceipt:async()=>({receiptId:'unit-receipt',receipt,transcript:pass(['receipt-1','receipt-2','receipt-3','receipt-4','upstream-1','upstream-2'])})};
 const input={taskRoot,task,model,workerId,approval,releaseAuthority:authority.publicKey,runtimeAudit,
  apiKey:'unit-test-key',now:()=>now,reserveSpend:async()=>{stats.reserved++;return {callId:'unit-only'};}};
 return {now,input,connection,stats,authority,receipt,output};
}
test('private material is withheld until release, SDK checks, upstream session and external runtime audit pass',async()=>{
 const f=await fixture();
 const result=await runConfidentialInference(f.input,{connect:async options=>{
  assert.equal(options.serving.requireReceipt,true);assert.equal(options.serving.requireVerified,true);return f.connection;
 }});
 assert.equal(result.proof.artifactHash,hash(f.output));assert.equal(f.stats.sent,1);
 assert.equal(f.stats.reserved,1);assert.equal(f.stats.closed,1);
 assert(!JSON.stringify(result.proof).includes(f.input.task.document));
 for(const failure of ['release','hardware-skip','audit','budget','receipt-skip','wrong-model','wrong-session','identity-rotation']){
  const x=await fixture();
  if(failure==='release')x.input.approval.signature='invalid';
  if(failure==='hardware-skip')x.connection.identity.transcript.lines[0].status='skip';
  if(failure==='audit')x.input.runtimeAudit.payload.debugDisabled=false;
  if(failure==='budget')x.input.reserveSpend=async()=>{throw Error('APPROVED_BUDGET_EXHAUSTED');};
  if(failure==='receipt-skip')x.connection.verifyReceipt=async()=>({receiptId:'unit-receipt',receipt:x.receipt,
   transcript:pass(['receipt-1','receipt-2','receipt-3','upstream-1','upstream-2'])});
  if(failure==='wrong-model')x.receipt.model='other-model';
  if(failure==='wrong-session')x.receipt.event_log[0].session_id=hash('other-session');
  if(failure==='identity-rotation'){
   const verify=x.connection.verifyReceipt;
   x.connection.verifyReceipt=async()=>{x.connection.identity.workloadKeysetDigest=hash('rotated-keyset');return verify();};
  }
  await assert.rejects(runConfidentialInference(x.input,{connect:async()=>x.connection}));
  if(!['receipt-skip','wrong-model','wrong-session','identity-rotation'].includes(failure))assert.equal(x.stats.sent,0,failure);
 }
});
test('official receipt verifier rejects changed wire bodies, signature, session and skipped mandatory checks',async()=>{
 const signer=identity(),publicBytes=createPublicKey(signer.publicKey).export({type:'spki',format:'der'}).subarray(-32);
 const keyset={not_after:2000000000,receipt_signing_keys:[{key_id:'test',algo:'ed25519',public_key:publicBytes.toString('hex')}]};
 const f=await fixture(),session=JSON.parse(await(await f.connection.fetch('/aci/sessions/test')).text());
 const payload={api_version:'aci/1',key_id:'test',receipt_id:'test',workload_keyset_digest:hash(keyset),
  served_at:Math.floor(f.now/1000),event_log:[
   {type:'request.received',body_hash:await hashBody('request')},{type:'response.returned',body_hash:await hashBody('response')},
   {type:'upstream.verified',session_id:await computeSessionId(session),result:'verified',required:true}]};
 const receipt={...payload,signature:sign(null,Buffer.from(canonical(payload)),signer.privateKey).toString('hex')};
 const check=(r,body='response')=>receiptTranscript(r,keyset,hash(keyset),'request',body,
  {session,pinnedSessions:[payload.event_log[2].session_id],requiresVerified:true,serving:'aggregator'});
 requireAciPass(await check(receipt),['receipt-1','receipt-2','receipt-3','receipt-4','upstream-1','upstream-2']);
 assert.equal((await check(receipt,'changed')).verdict.verified,false);
 assert.equal((await check({...receipt,signature:'00'.repeat(64)})).verdict.verified,false);
 session.evidence.data='data:application/json;base64,Zm9yZ2Vk';
 assert.equal((await check(receipt)).verdict.verified,false);
 assert.throws(()=>requireAciPass(pass(['receipt-1']),['receipt-1','receipt-2']),/SKIPPED/);
 assert.throws(()=>acceptInferenceCertificates({plan:{payload:{workers:[],reviewerKeys:[]}}},{proofs:[]}),/VERIFIER/);
});
test('ACI shares the existing cumulative ledger, fences duplicate dispatch and cannot reset exhausted spend',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'flashfirm-aci-test-'));
 try{
  await writeFile(path.join(dir,'aci-spend-policy.json'),JSON.stringify({enabled:true,capFen:2000,origin:'https://inference.phala.com',reservationFen:100}));
  await writeFile(path.join(dir,'provider-policy.json'),JSON.stringify({maxCalls:12,maxTokens:1000}));
  const ledger={capFen:2000,reservedFen:1900,calls:[{reserveFen:1900}]};
  await writeFile(path.join(dir,'provider-budget.json'),JSON.stringify(ledger));
  await reserveAciSpend(dir,{reservationFen:100,approvalHash:hash('approval')});
  const saved=JSON.parse(await readFile(path.join(dir,'provider-budget.json'),'utf8'));
  assert.equal(saved.reservedFen,2000);assert.equal(saved.calls.length,2);
  await assert.rejects(reserveAciSpend(dir,{reservationFen:100,approvalHash:hash('next')}),/EXHAUSTED/);
  saved.reservedFen=100;saved.calls=[{reserveFen:100,purpose:'CONFIDENTIAL_ACI',approvalHash:hash('approval')}];
  await writeFile(path.join(dir,'provider-budget.json'),JSON.stringify(saved));
  await assert.rejects(reserveAciSpend(dir,{reservationFen:100,approvalHash:hash('approval')}),/RECONCILE/);
 }finally{await rm(dir,{recursive:true});}
});
test('confidential manifest needs exact certificates for all artifacts and separate configured verification authority',()=>{
 const digest=hash('private-fixture'),f=taskFixture({privacyMode:'CONFIDENTIAL_INFERENCE',privateTaskDigest:digest});
 const release=identity(),verifier=identity(),security={authority:f.authority.publicKey,
  releaseAuthority:release.publicKey,inferenceAuthority:verifier.publicKey},time=f.now+60001;
 const proofs=f.plan.payload.workers.map(w=>{
  const approval=seal({version:'flashfirm-aci-release/1',origin:'https://inference.phala.com',
   taskRoot:f.record.taskRoot,taskDigest:digest,model:'test-only',workerId:w.id,privateInferenceAllowed:true,
   issuedAt:f.now,expiresAt:f.now+300000,composeHashes:[hash('test-compose')],sessionIds:[hash('test-session')],
   maxInputBytes:20000,maxOutputTokens:1000,reservationFen:100},release);
  return {approval,certificate:seal({version:'flashfirm-aci-task-proof/1',taskRoot:f.record.taskRoot,taskDigest:digest,
   model:'test-only',workerId:w.id,artifactHash:w.artifactHash,approvalHash:hash(approval),
   composeHash:hash('test-compose'),sessionId:hash('test-session'),receiptHash:hash('test-receipt'),
   runtimeAuditHash:hash('test-audit'),requestHash:hash('test-request'),responseHash:hash('test-response'),
   gatewayAndReceiptVerified:true,externalRuntimeAuditVerified:true,verifiedAt:f.now+1},verifier)};
 });
 assert.throws(()=>settlementManifest(f.flow,f.record,f.review,security,time),/INFERENCE_PROOF/);
 f.flow.inferenceProof={proofs};f.flow.inference=acceptInferenceCertificates(f.flow,{proofs},security,time);
 assert.equal(settlementManifest(f.flow,f.record,f.review,security,time).inferenceProofHash,hash(f.flow.inference));
 assert.throws(()=>acceptInferenceCertificates(f.flow,{proofs:proofs.slice(1)},security,time),/VERIFIER/);
 const changed=structuredClone(proofs);changed[0].certificate.payload.artifactHash=hash('wrong-artifact');
 assert.throws(()=>acceptInferenceCertificates(f.flow,{proofs:changed},security,time),/EXACT_TASK/);
 assert.throws(()=>settlementManifest(f.flow,f.record,f.review,security,f.now+300001),/APPROVAL/);
});

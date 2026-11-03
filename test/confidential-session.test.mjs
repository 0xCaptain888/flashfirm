import test from 'node:test';
import assert from 'node:assert/strict';
import {identity,seal,hash} from '../src/protocol.mjs';
import {digest,createWorker,requestReportData} from '../tee/phala-worker.mjs';
import {parseTdxQuote} from '../src/phala-attestation.mjs';
import {createHash} from 'node:crypto';
import {confidentialQuotationSession} from '../src/confidential-session.mjs';
import {verifyTaskPrivacy} from '../src/task-privacy.mjs';
function syntheticEvidence(context){
 const compose=JSON.stringify({docker_compose_file:'test compose',public_logs:false,public_sysinfo:false});
 const events=[{imr:3,event_type:0x08000001,event:'app-id',event_payload:'ab'.repeat(20)},
  {imr:3,event_type:0x08000001,event:'compose-hash',event_payload:digest(compose)}];
 let r=Buffer.alloc(48);
 for(const e of events){
  const t=Buffer.alloc(4);t.writeUInt32LE(e.event_type);
  const h=createHash('sha384').update(Buffer.concat([t,Buffer.from(':'+e.event+':'),Buffer.from(e.event_payload,'hex')])).digest();
  e.digest=h.toString('hex');r=createHash('sha384').update(Buffer.concat([r,h])).digest();
 }
 const bytes=Buffer.alloc(637);bytes.writeUInt16LE(4);bytes.writeUInt16LE(2,2);bytes.writeUInt32LE(0x81,4);bytes.writeUInt32LE(1,632);
 r.copy(bytes,520);Buffer.from(requestReportData(context),'hex').copy(bytes,568);
 return {context,attestation:{quote:bytes.toString('hex'),event_log:JSON.stringify(events)},info:{tcb_info:{app_compose:compose}}};
}
test('confidential client validates official hardware and governance before encrypted delivery; single use and task-bound result',async()=>{
 const now=Date.now(),authority=identity(),text='Private fixture source used only in a synthetic verifier test.';
 const task={version:'flashfirm-quotation-task/v1',sources:[{id:'private',text,sha256:digest(text)}],claims:[{id:'one',sourceId:'private',quote:text}]};
 const policy={version:'flashfirm-secret-release/1',endpoint:'https://test-worker.invalid',taskRoot:hash('task'),reportHash:hash('report'),
  taskDigest:digest(task),auditHash:hash('synthetic test audit'),issuedAt:now-1,expiresAt:now+120000,
  dockerCompose:'test compose',appId:'ab'.repeat(20),measurements:Object.fromEntries(['mrtd','rtmr0','rtmr1','rtmr2'].map(k=>[k,'0'.repeat(96)])),
  modelInferenceAllowed:false,privateQuotationAllowed:true};
 const worker=createWorker({now:()=>now,rpc:async()=>({})}),approval=seal(policy,authority);let bundle,runCalls=0,hardwareOk=true;
 const fetcher=async(url,options={})=>{
  assert(!String(options.body??'').includes(text),'plaintext must never leave the client');
  if(url.endsWith('/attest')){
   const attestation=await worker.attest(JSON.parse(options.body));bundle=syntheticEvidence(attestation.context);return Response.json(bundle);
  }
  if(url.endsWith('/verify')){
   const p=parseTdxQuote(bundle.attestation.quote);
   return Response.json({success:hardwareOk,checksum:p.checksum,quote:{verified:hardwareOk,header:{version:4,tee_type:'TEE_TDX'},body:p.body}});
  }
  if(url.includes('/attestations/raw/'))return new Response(Buffer.from(bundle.attestation.quote,'hex'));
  if(url.endsWith('/run')){runCalls++;return Response.json(worker.run(JSON.parse(options.body)));}
  throw Error('UNEXPECTED_EGRESS');
 };
 const input={task,taskRoot:policy.taskRoot,reportHash:policy.reportHash,endpoint:policy.endpoint,approval,releaseAuthority:authority.publicKey,fetcher,now:()=>now};
 const session=await confidentialQuotationSession(input);
 const result=await session.execute();assert.equal(result.signedResult.result.status,'PASS');
 assert.equal(result.confidentialInferenceVerified,false);assert.equal(runCalls,1);
 const flow={plan:{payload:{taskRoot:policy.taskRoot,resultRoot:policy.reportHash,privacyMode:'CONFIDENTIAL_QUOTATIONS',
  privateTaskDigest:policy.taskDigest,buyerKey:identity().publicKey,reviewerKeys:[],workers:[]}}};
 const checked=await verifyTaskPrivacy(flow,{proof:result,approval},authority.publicKey,fetcher,now);
 assert.equal(checked.privateQuotationVerified,true);assert.equal(checked.confidentialInferenceVerified,false);
 await assert.rejects(verifyTaskPrivacy(flow,{proof:result,approval},undefined,fetcher,now),/APPROVAL/);
 await assert.rejects(session.execute(),/USED/);
 hardwareOk=false;
 await assert.rejects(confidentialQuotationSession(input),/HARDWARE/);assert.equal(runCalls,1);
 await assert.rejects(confidentialQuotationSession({...input,releaseAuthority:identity().publicKey}),/APPROVAL/);
});

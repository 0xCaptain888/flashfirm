import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createWorker,digest} from '../tee/phala-worker.mjs';
import {parseTdxQuote} from '../src/phala-attestation.mjs';
import {privateQuotationPreflight,runPrivateQuotation} from '../src/private-quotation-runner.mjs';
import {taskFixture} from '../test-support/task-flow.mjs';
import {hash,seal} from '../src/protocol.mjs';

// Unsigned synthetic TDX bytes and a simulated official response exercise policy
// only. None of these fixtures may be used as live hardware or human evidence.
function syntheticQuote(reportData,compose){
 const config=JSON.stringify({docker_compose_file:compose,public_logs:false,public_sysinfo:false});
 const events=[
  {imr:3,event_type:0x08000001,event:'app-id',event_payload:'ab'.repeat(20)},
  {imr:3,event_type:0x08000001,event:'compose-hash',event_payload:digest(config)}
 ];
 let extended=Buffer.alloc(48);
 for(const event of events){
  const type=Buffer.alloc(4);type.writeUInt32LE(event.event_type);
  const bytes=Buffer.concat([type,Buffer.from(':'+event.event+':'),Buffer.from(event.event_payload,'hex')]);
  const value=createHash('sha384').update(bytes).digest();
  event.digest=value.toString('hex');extended=createHash('sha384').update(Buffer.concat([extended,value])).digest();
 }
 const raw=Buffer.alloc(637);raw.writeUInt16LE(4);raw.writeUInt16LE(2,2);raw.writeUInt32LE(0x81,4);raw.writeUInt32LE(1,632);
 extended.copy(raw,520);Buffer.from(reportData,'hex').copy(raw,568);
 return {raw,events,config};
}
function fixture(){
 const text='Private synthetic source material for isolated encryption-policy tests only.';
 const task={version:'flashfirm-quotation-task/v1',sources:[{id:'private',text,sha256:digest(text)}],
  claims:[{id:'one',sourceId:'private',quote:text}]};
 const f=taskFixture({privacyMode:'CONFIDENTIAL_QUOTATIONS',privateTaskDigest:hash(task)});
 const compose='synthetic measured private worker',issuedAt=f.now;
 const approval=seal({version:'flashfirm-secret-release/1',taskRoot:f.plan.payload.taskRoot,
  reportHash:f.plan.payload.resultRoot,taskDigest:hash(task),privateQuotationAllowed:true,
  modelInferenceAllowed:false,issuedAt,expiresAt:issuedAt+600000,auditHash:hash('synthetic audit'),
  appId:'ab'.repeat(20),dockerCompose:compose,
  measurements:Object.fromEntries(['mrtd','rtmr0','rtmr1','rtmr2'].map(k=>[k,'00'.repeat(48)]))},f.authority);
 let quote,runCalls=0;const requests=[],checkpoints=[],fences=new Set();
 const worker=createWorker({now:()=>f.now,rpc:async(method,args)=>{
  if(method==='GetQuote'){quote=syntheticQuote(args.report_data,compose);return {quote:quote.raw.toString('hex'),event_log:JSON.stringify(quote.events)};}
  if(method==='Info')return {tcb_info:JSON.stringify({app_compose:quote.config})};
  throw Error('UNEXPECTED_FIXTURE_RPC');
 }});
 const fetcher=async(url,options={})=>{
  const u=new URL(url),body=options.body?JSON.parse(options.body):null;requests.push({url:String(url),body});
  if(u.hostname==='synthetic.phala.network'&&u.pathname==='/attest')return Response.json(await worker.attest(body));
  if(u.hostname==='synthetic.phala.network'&&u.pathname==='/run'){runCalls++;return Response.json(worker.run(body));}
  if(u.hostname==='cloud-api.phala.com'&&u.pathname.endsWith('/verify')){
   const parsed=parseTdxQuote(quote.raw.toString('hex'));
   return Response.json({success:true,checksum:parsed.checksum,quote:{verified:true,header:{version:4,tee_type:'TEE_TDX'},body:parsed.body}});
  }
  if(u.hostname==='cloud-api.phala.com'&&u.pathname.includes('/raw/'))return new Response(quote.raw);
  throw Error('UNEXPECTED_FIXTURE_REQUEST');
 };
 return {...f,text,input:{endpoint:'https://synthetic.phala.network/',flow:f.flow,task,approval},
  get runCalls(){return runCalls;},requests,checkpoints,
  options:{authority:f.authority.publicKey,fetcher,now:()=>f.now,
   checkpoint:async(name,value)=>checkpoints.push({name,value}),
   reserveRelease:async id=>{if(fences.has(id))throw Error('RELEASE_ALREADY_RESERVED');fences.add(id);}}};
}
test('private quotation runner verifies exact platform before one encrypted release and retains a task-bound signed result',async()=>{
 const f=fixture(),value=await runPrivateQuotation(f.input,f.options);
 assert.equal(value.state,'PRIVATE_QUOTATION_VERIFIED');assert.equal(value.privateQuotationVerified,true);
 assert.equal(value.confidentialInferenceVerified,false);assert.equal(value.paidCalls,0);assert.equal(f.runCalls,1);
 assert.equal(value.acceptance.taskDigest,hash(f.input.task));
 assert(!JSON.stringify(f.requests).includes(f.text),'plaintext must never enter attestation, official API or encrypted task requests');
 assert.deepEqual(f.checkpoints.map(c=>c.name),['attestation','pre-release-verification','release-intent','encrypted-response','task-proof']);
 await assert.rejects(runPrivateQuotation(f.input,f.options),/RELEASE_ALREADY_RESERVED/);
 assert.equal(f.runCalls,1);
});
test('unapproved measurements, wrong application, revoked approval and failed hardware check prevent private release',async()=>{
 for(const changed of ['measurement','app','approval','hardware']){
  const f=fixture();
  if(changed==='measurement'){f.input.approval.payload.measurements.mrtd='ff'.repeat(48);f.input.approval=seal(f.input.approval.payload,f.authority);}
  if(changed==='app'){f.input.approval.payload.appId='cd'.repeat(20);f.input.approval=seal(f.input.approval.payload,f.authority);}
  if(changed==='approval')f.input.approval.payload.auditHash='01'.repeat(32);
  if(changed==='hardware'){
   const base=f.options.fetcher;f.options.fetcher=(url,o)=>String(url).endsWith('/verify')?Promise.resolve(Response.json({success:false,checksum:'00'.repeat(32)})):base(url,o);
  }
  await assert.rejects(runPrivateQuotation(f.input,f.options));
  assert.equal(f.runCalls,0);assert(!JSON.stringify(f.requests).includes(f.text));
 }
});
test('only a separate authority and bounded exact private quotation task can pass preflight',()=>{
 const f=fixture();
 assert.equal(privateQuotationPreflight(f.input,f.authority.publicKey,f.now).privateTaskReleased,false);
 assert.throws(()=>privateQuotationPreflight(f.input,f.buyer.publicKey,f.now),/EXACT_EXTERNAL/);
 const changed=structuredClone(f.input);changed.task.sources[0].text+=' changed';
 assert.throws(()=>privateQuotationPreflight(changed,f.authority.publicKey,f.now),/EXACT_EXTERNAL/);
 for(const endpoint of ['http://synthetic.phala.network/','https://synthetic.phala.network/other','https://synthetic.phala.network/?redirect=1','https://phala.network.attacker.example/'])
  assert.throws(()=>privateQuotationPreflight({...f.input,endpoint},f.authority.publicKey,f.now),/PINNED_PHALA/);
});

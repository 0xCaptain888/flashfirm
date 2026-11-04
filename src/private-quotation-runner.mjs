import {randomBytes} from 'node:crypto';
import {hash,validSeal} from './protocol.mjs';
import {quotationGate,prepareEncryptedTask} from '../tee/phala-worker.mjs';
import {parseTdxQuote,verifyPhalaEvidence} from './phala-attestation.mjs';
import {verifyTaskPrivacy} from './task-privacy.mjs';
import {readBounded} from './live.mjs';

export function privateQuotationPreflight(input,authority,now=Date.now()){
 const {flow,task,approval}=input??{},p=flow?.plan?.payload,a=approval?.payload;
 const endpoint=new URL(input?.endpoint??'https://invalid.invalid');
 if(endpoint.protocol!=='https:'||!endpoint.hostname.endsWith('.phala.network')||
   endpoint.username||endpoint.password||endpoint.search||endpoint.hash||endpoint.pathname!=='/')
  throw Error('PINNED_PHALA_HTTPS_ROOT_REQUIRED');
 if(!p||!validSeal(flow.plan,p.buyerKey)||p.privacyMode!=='CONFIDENTIAL_QUOTATIONS'||
   p.expiresAt<=now+120000||hash(task)!==p.privateTaskDigest||
   !authority||[p.buyerKey,...p.reviewerKeys,...p.workers.map(w=>w.key)].includes(authority)||
   !validSeal(approval,authority)||a?.version!=='flashfirm-secret-release/1'||
   a.taskRoot!==p.taskRoot||a.reportHash!==p.resultRoot||a.taskDigest!==p.privateTaskDigest||
   a.privateQuotationAllowed!==true||a.modelInferenceAllowed!==false||
   !Number.isSafeInteger(a.issuedAt)||a.issuedAt>now||!Number.isSafeInteger(a.expiresAt)||
   a.expiresAt<=now+120000||a.expiresAt>p.expiresAt||
   !/^[a-f0-9]{64}$/.test(a.auditHash??'')||typeof a.appId!=='string'||!a.appId||
   typeof a.dockerCompose!=='string'||a.dockerCompose.length>262144||
   ['mrtd','rtmr0','rtmr1','rtmr2'].some(k=>!/^[a-f0-9]{96}$/.test(a.measurements?.[k]??'')))
  throw Error('EXACT_EXTERNAL_PRIVATE_RELEASE_REQUIRED');
 if(Buffer.byteLength(JSON.stringify(task))>150000)throw Error('PRIVATE_TASK_TOO_LARGE');
 quotationGate(task);
 return {version:'flashfirm-private-quotation-preflight/1',taskRoot:p.taskRoot,resultRoot:p.resultRoot,
  taskDigest:p.privateTaskDigest,approvalHash:hash(approval),endpoint:endpoint.origin,
  privateReleaseVerifiedByConfiguredAuthority:true,hardwareVerified:false,privateTaskReleased:false,
  confidentialInferenceVerified:false,paidCalls:0};
}
export async function runPrivateQuotation(input,{authority,fetcher=fetch,checkpoint,reserveRelease,now=Date.now}){
 const preflight=privateQuotationPreflight(input,authority,now()),{flow,task,approval}=input,a=approval.payload;
 if(typeof checkpoint!=='function'||typeof reserveRelease!=='function')throw Error('DURABLE_PRIVATE_CHECKPOINT_AND_RELEASE_FENCE_REQUIRED');
 const expected={nonce:randomBytes(32).toString('hex'),taskDigest:preflight.taskDigest,
  expiresAt:Math.min(now()+300000,a.expiresAt,flow.plan.payload.expiresAt),dockerCompose:a.dockerCompose,appId:a.appId};
 const json=async(url,body)=>{
  const response=await fetcher(url,{method:body===undefined?'GET':'POST',redirect:'error',signal:AbortSignal.timeout(30000),
   headers:{'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
  return JSON.parse(await readBounded(response,2000000));
 };
 // Only a random nonce and opaque digest are sent before hardware/app/platform checks.
 const bundle=await json(new URL('/attest',input.endpoint),{nonce:expected.nonce,taskDigest:expected.taskDigest,expiresAt:expected.expiresAt});
 await checkpoint('attestation',bundle);
 const hardware=await json('https://cloud-api.phala.com/api/v1/attestations/verify',{hex:bundle.attestation?.quote});
 if(!/^[a-f0-9]{64}$/.test(hardware.checksum??''))throw Error('OFFICIAL_HARDWARE_REPORT_REQUIRED');
 const rawResponse=await fetcher('https://cloud-api.phala.com/api/v1/attestations/raw/'+hardware.checksum,
  {redirect:'error',signal:AbortSignal.timeout(30000)});
 if(!rawResponse.ok||Number(rawResponse.headers.get('content-length')??0)>32768)throw Error('BOUNDED_OFFICIAL_RAW_QUOTE_REQUIRED');
 const reader=rawResponse.body.getReader(),chunks=[];let length=0;
 while(true){const {value,done}=await reader.read();if(done)break;length+=value.length;
  if(length>32768){await reader.cancel();throw Error('BOUNDED_OFFICIAL_RAW_QUOTE_REQUIRED');}chunks.push(Buffer.from(value));}
 const raw=Buffer.concat(chunks);
 const verification=verifyPhalaEvidence(bundle,expected,hardware,now(),raw),
  measurements=parseTdxQuote(bundle.attestation.quote).body;
 for(const name of ['mrtd','rtmr0','rtmr1','rtmr2'])
  if(a.measurements[name]!==measurements[name])throw Error('UNAPPROVED_PRIVATE_PLATFORM');
 privateQuotationPreflight(input,authority,now());
 await checkpoint('pre-release-verification',{verification,approvalHash:hash(approval),taskDigest:preflight.taskDigest});
 // Exact approval may release the private input once, even if a response is lost.
 await reserveRelease(hash(approval));
 const client=prepareEncryptedTask(bundle,task);
 await checkpoint('release-intent',{approvalHash:hash(approval),nonce:expected.nonce,at:now()});
 const encrypted=await json(new URL('/run',input.endpoint),client.request);
 await checkpoint('encrypted-response',encrypted);
 const signedResult=client.decrypt(encrypted);
 const proof={version:'flashfirm-confidential-quotation/1',classification:'PRIVATE',taskRoot:preflight.taskRoot,
  reportHash:preflight.resultRoot,approvalHash:hash(approval),bundle,expected,signedResult};
 await checkpoint('task-proof',{proof,approval});
 const accepted=signedResult.result.status==='PASS'?
  await verifyTaskPrivacy(flow,{proof,approval},authority,fetcher,now()):null;
 return {proof,approval,acceptance:accepted,privateQuotationVerified:!!accepted,
  confidentialInferenceVerified:false,paidCalls:0,
  state:accepted?'PRIVATE_QUOTATION_VERIFIED':'PRIVATE_QUOTATION_CHALLENGED'};
}

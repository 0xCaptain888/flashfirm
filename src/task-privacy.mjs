import {createPublicKey,verify} from 'node:crypto';
import {hash,validSeal,canonical} from './protocol.mjs';
import {verifyPhalaEvidence,parseTdxQuote} from './phala-attestation.mjs';
// This proof contains commitments and encrypted-task result metadata, never the
// private source documents. The relying service obtains the hardware verdict.
export async function verifyTaskPrivacy(flow,{proof,approval},authority,fetcher=fetch,now=Date.now()){
  const started=Date.now();
  const p=flow.plan.payload,a=approval?.payload;
  if(p.privacyMode!=='CONFIDENTIAL_QUOTATIONS'||!authority||
    [p.buyerKey,...p.reviewerKeys,...p.workers.map(w=>w.key)].includes(authority)||
    !validSeal(approval,authority)||a?.version!=='flashfirm-secret-release/1'||
    a.taskRoot!==p.taskRoot||a.reportHash!==p.resultRoot||a.taskDigest!==p.privateTaskDigest||
    a.privateQuotationAllowed!==true||a.modelInferenceAllowed!==false||
    !Number.isSafeInteger(a.expiresAt)||a.expiresAt<=now||!Number.isSafeInteger(a.issuedAt)||a.issuedAt>now||
    !/^[a-f0-9]{64}$/.test(a.auditHash??'')||proof?.version!=='flashfirm-confidential-quotation/1'||
    proof.taskRoot!==p.taskRoot||proof.reportHash!==p.resultRoot||proof.classification!=='PRIVATE'||
    proof.approvalHash!==hash(approval)||proof.expected?.taskDigest!==p.privateTaskDigest||
    proof.expected?.dockerCompose!==a.dockerCompose||proof.expected?.appId!==a.appId)
    throw Error('TASK_BOUND_PRIVATE_QUOTATION_APPROVAL_REQUIRED');
  const read=async response=>{
    const text=await response.text();
    if(!response.ok||text.length>2000000)throw Error('OFFICIAL_ATTESTATION_SERVICE_UNAVAILABLE');
    return JSON.parse(text);
  };
  const hardware=await read(await fetcher('https://cloud-api.phala.com/api/v1/attestations/verify',{
    method:'POST',redirect:'error',signal:AbortSignal.timeout(30000),headers:{'Content-Type':'application/json'},
    body:JSON.stringify({hex:proof.bundle?.attestation?.quote})}));
  if(!/^[a-f0-9]{64}$/.test(hardware.checksum??''))throw Error('OFFICIAL_HARDWARE_REPORT_REQUIRED');
  const download=await fetcher('https://cloud-api.phala.com/api/v1/attestations/raw/'+hardware.checksum,
    {redirect:'error',signal:AbortSignal.timeout(30000)});
  if(!download.ok)throw Error('OFFICIAL_QUOTE_DOWNLOAD_REQUIRED');
  const raw=Buffer.from(await download.arrayBuffer());
  const verifiedAt=now+Math.max(0,Date.now()-started);
  if(a.expiresAt<=verifiedAt||p.expiresAt<=verifiedAt)throw Error('PRIVATE_APPROVAL_EXPIRED_DURING_VERIFICATION');
  const verification=verifyPhalaEvidence(proof.bundle,proof.expected,hardware,verifiedAt,raw);
  const measurements=parseTdxQuote(proof.bundle.attestation.quote).body;
  for(const name of ['mrtd','rtmr0','rtmr1','rtmr2'])if(a.measurements?.[name]!==measurements[name])throw Error('UNAPPROVED_PRIVATE_PLATFORM');
  const r=proof.signedResult,c=proof.bundle.context;
  const key=createPublicKey({key:Buffer.from(c.signingPublicKey,'base64'),type:'spki',format:'der'});
  if(r?.result?.taskDigest!==p.privateTaskDigest||r.resultDigest!==hash(r.result)||canonical(r.context)!==canonical(c)||
    !verify(null,Buffer.from(canonical({context:c,result:r.result,resultDigest:r.resultDigest})),key,Buffer.from(r.signature??'','base64'))||
    r.result.version!=='flashfirm-quotation-result/v1'||r.result.status!=='PASS')throw Error('PRIVATE_TASK_RESULT_NOT_SIGNED_OR_PASSED');
  return {version:'flashfirm-task-privacy/1',taskRoot:p.taskRoot,resultRoot:p.resultRoot,proofHash:hash(proof),
    approvalHash:hash(approval),authority,verifiedAt,taskDigest:p.privateTaskDigest,
    privateQuotationVerified:true,confidentialInferenceVerified:false,verification,
    scope:'Fresh attested quotation result under externally approved platform policy; no model-inference claim.'};
}

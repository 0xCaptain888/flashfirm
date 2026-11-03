import {randomBytes} from 'node:crypto';
import {hash,validSeal} from './protocol.mjs';
import {digest,prepareEncryptedTask} from '../tee/phala-worker.mjs';
import {parseTdxQuote,verifyPhalaEvidence} from './phala-attestation.mjs';
async function readJson(response){
  const text=await response.text();
  if(!response.ok||text.length>2000000)throw Error('ATTESTATION_SERVICE_UNAVAILABLE');
  return JSON.parse(text);
}
// Private material is kept in this process until hardware, exact application,
// platform measurements and a separately approved release policy all pass.
// A caller-supplied {"verified":true} has no entry point here.
export async function confidentialQuotationSession({task,taskRoot,reportHash,endpoint,approval,releaseAuthority,classification='PRIVATE',fetcher=fetch,now=Date.now}){
  const started=now(),policy=approval?.payload,url=new URL(endpoint);
  if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||url.pathname!=='/'||
    !/^[a-f0-9]{64}$/.test(taskRoot??'')||!/^[a-f0-9]{64}$/.test(reportHash??'')||
    !['PUBLIC','PRIVATE'].includes(classification))throw Error('PINNED_CONFIDENTIAL_TASK_REQUIRED');
  if(!releaseAuthority||!validSeal(approval,releaseAuthority)||policy?.version!=='flashfirm-secret-release/1'||
    policy.endpoint!==url.origin||policy.taskRoot!==taskRoot||policy.reportHash!==reportHash||
    policy.taskDigest!==digest(task)||!Number.isSafeInteger(policy.expiresAt)||policy.expiresAt<=started||
    !Number.isSafeInteger(policy.issuedAt)||policy.issuedAt>started||
    !/^[a-f0-9]{64}$/.test(policy.auditHash??'')||policy.modelInferenceAllowed!==false||
    (classification==='PRIVATE'&&policy.privateQuotationAllowed!==true))throw Error('INDEPENDENT_SECRET_RELEASE_APPROVAL_REQUIRED');
  const expected={nonce:randomBytes(32).toString('hex'),taskDigest:digest(task),expiresAt:Math.min(started+120000,policy.expiresAt),
    dockerCompose:policy.dockerCompose,appId:policy.appId};
  const post=(path,body)=>fetcher(url.origin+path,{method:'POST',redirect:'error',signal:AbortSignal.timeout(20000),
    headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}).then(readJson);
  // /attest receives only commitments and a fresh challenge, never plaintext.
  const bundle=await post('/attest',{nonce:expected.nonce,taskDigest:expected.taskDigest,expiresAt:expected.expiresAt});
  const hardware=await readJson(await fetcher('https://cloud-api.phala.com/api/v1/attestations/verify',{
    method:'POST',redirect:'error',signal:AbortSignal.timeout(30000),headers:{'Content-Type':'application/json'},
    body:JSON.stringify({hex:bundle.attestation.quote})}));
  if(!/^[a-f0-9]{64}$/.test(hardware.checksum??''))throw Error('INVALID_VERIFIER_REPORT_ID');
  const rawResponse=await fetcher('https://cloud-api.phala.com/api/v1/attestations/raw/'+hardware.checksum,
    {redirect:'error',signal:AbortSignal.timeout(30000)});
  if(!rawResponse.ok)throw Error('OFFICIAL_QUOTE_DOWNLOAD_REQUIRED');
  const raw=Buffer.from(await rawResponse.arrayBuffer());
  if(raw.length>65536)throw Error('QUOTE_TOO_LARGE');
  const verification=verifyPhalaEvidence(bundle,expected,hardware,now(),raw);
  const measurements=parseTdxQuote(bundle.attestation.quote).body;
  for(const name of ['mrtd','rtmr0','rtmr1','rtmr2'])
    if(!/^[a-f0-9]{96}$/.test(policy.measurements?.[name]??'')||policy.measurements[name]!==measurements[name])
      throw Error('PLATFORM_MEASUREMENT_NOT_APPROVED');
  if(now()>=expected.expiresAt)throw Error('SECRET_RELEASE_CHALLENGE_EXPIRED');
  const client=prepareEncryptedTask(bundle,task);
  let consumed=false;
  return {requestCommitment:{taskRoot,reportHash,taskDigest:expected.taskDigest,approvalHash:hash(approval)},
    async execute(){
      if(consumed||now()>=expected.expiresAt)throw Error('SESSION_ALREADY_USED_OR_EXPIRED');
      consumed=true; // Interrupted network handoff is never silently retried.
      const signedResult=client.decrypt(await post('/run',client.request));
      return {version:'flashfirm-confidential-quotation/1',taskRoot,reportHash,approvalHash:hash(approval),
        expected,bundle,verification,signedResult,classification,
        encryptedTaskDelivery:true,encryptedResultDelivery:true,confidentialInferenceVerified:false,
        scope:'Quotation task only. Explicit governance approval of measured platform; no model or remote API receives these materials.'};
    }};
}

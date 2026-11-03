import {hash,validSeal} from './protocol.mjs';
const hex=v=>/^[a-f0-9]{64}$/.test(v??'');
export const ACI_ORIGIN='https://inference.phala.com';
export function requireAciPass(transcript,ids){
 if(!transcript?.verdict?.verified||!Array.isArray(transcript.lines)||
  transcript.lines.some(l=>l.status==='fail')||ids.some(id=>transcript.lines.filter(l=>l.id===id&&l.status==='pass').length!==1))
  throw Error('ACI_REQUIRED_CHECK_FAILED_OR_SKIPPED');
}
export function validateAciRelease(approval,authority,{taskRoot,taskDigest,model,workerId},now=Date.now()){
 const p=approval?.payload;
 if(!authority||!validSeal(approval,authority)||p?.version!=='flashfirm-aci-release/1'||
  p.origin!==ACI_ORIGIN||p.taskRoot!==taskRoot||p.taskDigest!==taskDigest||!hex(taskRoot)||!hex(taskDigest)||
  p.model!==model||typeof model!=='string'||!model.length||model.length>200||
  p.workerId!==workerId||!/^[-a-z0-9_]{1,80}$/.test(workerId??'')||
  p.privateInferenceAllowed!==true||!Number.isSafeInteger(p.issuedAt)||p.issuedAt>now||
  !Number.isSafeInteger(p.expiresAt)||p.expiresAt<=now||p.expiresAt-p.issuedAt>86400000||
  !Array.isArray(p.composeHashes)||!p.composeHashes.length||p.composeHashes.length>8||!p.composeHashes.every(hex)||
  !Array.isArray(p.sessionIds)||!p.sessionIds.length||p.sessionIds.length>8||!p.sessionIds.every(hex)||
  !Number.isSafeInteger(p.maxInputBytes)||p.maxInputBytes<1||p.maxInputBytes>20000||
  !Number.isSafeInteger(p.maxOutputTokens)||p.maxOutputTokens<1||p.maxOutputTokens>1600||
  !Number.isSafeInteger(p.reservationFen)||p.reservationFen<1||p.reservationFen>2000)
  throw Error('EXTERNAL_ACI_RELEASE_APPROVAL_REQUIRED');
 return p;
}
// The SDK does not reconstruct the OS/KMS chain or appraise upstream evidence.
// This separate, pinned authority must audit those details. A gateway-provided
// boolean or a service hash copied on first use cannot satisfy this policy.
export function verifyAciRuntimeAudit(envelope,authority,policy,identity,now=Date.now()){
 const p=envelope?.payload,evidence=identity.report?.attestation?.evidence;
 if(!validSeal(envelope,authority)||p?.version!=='flashfirm-aci-runtime-audit/1'||
  p.origin!==policy.origin||p.model!==policy.model||!policy.composeHashes.includes(identity.composeHash)||
  p.composeHash!==identity.composeHash||p.workloadKeysetDigest!==identity.workloadKeysetDigest||
  p.gatewayEvidenceHash!==hash(evidence)||!policy.sessionIds.includes(p.sessionId)||
  !hex(p.sessionEvidenceHash)||!hex(p.modelMeasurement)||!hex(p.runtimeMeasurement)||
  p.productionOsVerified!==true||p.kmsCustodyVerified!==true||p.debugDisabled!==true||
  p.upstreamEvidenceAppraised!==true||p.weightsAndRuntimeVerified!==true||
  !Number.isSafeInteger(p.issuedAt)||p.issuedAt>now||!Number.isSafeInteger(p.expiresAt)||
  p.expiresAt<=now||p.expiresAt>policy.expiresAt)
  throw Error('INDEPENDENT_OS_KMS_AND_MODEL_AUDIT_REQUIRED');
 return p;
}
export function acceptInferenceCertificates(flow,input,{releaseAuthority,inferenceAuthority}={},now=Date.now()){
 const p=flow.plan.payload,team=[p.buyerKey,...p.reviewerKeys,...p.workers.map(w=>w.key)];
 if(p.privacyMode!=='CONFIDENTIAL_INFERENCE'||!inferenceAuthority||!releaseAuthority||
  inferenceAuthority===releaseAuthority||team.includes(inferenceAuthority)||team.includes(releaseAuthority)||
  !Array.isArray(input?.proofs)||input.proofs.length!==p.workers.length)
  throw Error('EXTERNAL_INFERENCE_VERIFIER_REQUIRED');
 const seen=new Set();
 for(const row of input.proofs){
  const c=row.certificate?.payload,release=validateAciRelease(row.approval,releaseAuthority,{
   taskRoot:p.taskRoot,taskDigest:p.privateTaskDigest,model:c?.model,workerId:c?.workerId},now);
  if(!validSeal(row.certificate,inferenceAuthority)||c?.version!=='flashfirm-aci-task-proof/1'||
   c.taskRoot!==p.taskRoot||c.taskDigest!==p.privateTaskDigest||c.approvalHash!==hash(row.approval)||
   !p.workers.some(w=>w.id===c.workerId&&w.artifactHash===c.artifactHash)||seen.has(c.artifactHash)||
   !release.composeHashes.includes(c.composeHash)||!release.sessionIds.includes(c.sessionId)||
   !hex(c.receiptHash)||!hex(c.runtimeAuditHash)||!hex(c.requestHash)||!hex(c.responseHash)||
   c.gatewayAndReceiptVerified!==true||c.externalRuntimeAuditVerified!==true||
   !Number.isSafeInteger(c.verifiedAt)||c.verifiedAt<release.issuedAt||c.verifiedAt>now||
   c.verifiedAt>=release.expiresAt)throw Error('EXACT_TASK_ARTIFACT_INFERENCE_PROOF_REQUIRED');
  seen.add(c.artifactHash);
 }
 return {version:'flashfirm-task-inference/1',taskRoot:p.taskRoot,resultRoot:p.resultRoot,taskDigest:p.privateTaskDigest,
  proofHash:hash(input),authority:inferenceAuthority,releaseAuthority,verifiedAt:now,
  confidentialInferenceVerified:true,artifactHashes:[...seen],
  scope:'Official ACI hardware, channel and receipt verification by configured verifier; OS/KMS and model/runtime appraisal depend on separately pinned external audit authority.'};
}

import {readBounded} from './live.mjs';
// This service receives fresh PUBLIC attestation metadata only. Never pass
// task text, API credentials, model outputs or a caller-chosen URL into it.
export function aciAuditor(urlValue,token,fetcher=fetch){
 const url=new URL(urlValue);
 if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)
  throw Error('HTTPS_AUDITOR_SERVICE_REQUIRED');
 return async(identity,policy)=>{
  const response=await fetcher(url,{method:'POST',redirect:'error',signal:AbortSignal.timeout(30000),
   headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},
   body:JSON.stringify({report:identity.report,composeHash:identity.composeHash,
    workloadKeysetDigest:identity.workloadKeysetDigest,model:policy.model,sessionIds:policy.sessionIds})});
  return JSON.parse(await readBounded(response,2000000));
 };
}

import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {runConfidentialInference} from '../src/aci-inference.mjs';
import {reserveAciSpend} from '../src/aci-budget.mjs';
import {seal} from '../src/protocol.mjs';
const [inputFile,runtimeDir,outputDir]=process.argv.slice(2);
if(!inputFile||!runtimeDir||!outputDir)throw Error('Usage: node scripts/run-confidential-inference.mjs PRIVATE_INPUT_JSON SHARED_RUNTIME PRIVATE_NEW_OUTPUT_DIR');
const input=JSON.parse(await readFile(inputFile,'utf8'));
const authority=process.env.FLASHFIRM_SECRET_RELEASE_AUTHORITY_KEY;
const verifier=JSON.parse(await readFile(path.join(runtimeDir,'aci-verifier-secret.json'),'utf8'));
if(!authority||verifier.publicKey!==process.env.FLASHFIRM_INFERENCE_VERIFIER_KEY||authority===verifier.publicKey)
 throw Error('CONFIGURED_SEPARATE_RELEASE_AND_VERIFIER_KEYS_REQUIRED');
// New output directory acts as an additional process-level dispatch fence.
await mkdir(outputDir,{mode:0o700});
await writeFile(path.join(outputDir,'intent.json'),JSON.stringify({taskRoot:input.taskRoot,workerId:input.workerId,at:new Date().toISOString()}),
 {flag:'wx',mode:0o600});
let runtimeAudit=input.runtimeAudit;
if(process.env.FLASHFIRM_ACI_AUDITOR_URL){
 const url=new URL(process.env.FLASHFIRM_ACI_AUDITOR_URL);
 if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)throw Error('HTTPS_AUDITOR_SERVICE_REQUIRED');
 runtimeAudit=async(identity,policy)=>{
  const response=await fetch(url,{method:'POST',redirect:'error',signal:AbortSignal.timeout(30000),
   headers:{'Content-Type':'application/json',...(process.env.FLASHFIRM_ACI_AUDITOR_TOKEN?
    {Authorization:'Bearer '+process.env.FLASHFIRM_ACI_AUDITOR_TOKEN}:{})},
   body:JSON.stringify({report:identity.report,composeHash:identity.composeHash,
    workloadKeysetDigest:identity.workloadKeysetDigest,model:policy.model,sessionIds:policy.sessionIds})});
  if(!response.ok)throw Error('INDEPENDENT_ACI_AUDITOR_UNAVAILABLE');
  const text=await response.text();if(text.length>2000000)throw Error('AUDITOR_RESPONSE_TOO_LARGE');
  return JSON.parse(text);
 };
}
const result=await runConfidentialInference({...input,runtimeAudit,releaseAuthority:authority,
 apiKey:process.env.PHALA_ACI_API_KEY,proxy:process.env.HTTPS_PROXY,
 reserveSpend:options=>reserveAciSpend(runtimeDir,options)});
await writeFile(path.join(outputDir,'result-private.json'),JSON.stringify(result),{flag:'wx',mode:0o600});
await writeFile(path.join(outputDir,'certificate.json'),JSON.stringify(seal(result.proof,verifier)),{flag:'wx',mode:0o600});
console.log(JSON.stringify({state:'VERIFIED_BY_CONFIGURED_AUDIT_POLICY',taskRoot:result.proof.taskRoot,
 artifactHash:result.proof.artifactHash,confidentialContentLogged:false,
 note:'Keep output directory private. Attach certificate and release approval only via authenticated flow/inference.'}));

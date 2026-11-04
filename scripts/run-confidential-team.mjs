import {readFile,writeFile,mkdir,stat} from 'node:fs/promises';
import {createPublicKey} from 'node:crypto';
import path from 'node:path';
import {preflightConfidentialTeam} from '../src/confidential-team.mjs';
import {runConfidentialInference} from '../src/aci-inference.mjs';
import {reserveAciSpend} from '../src/aci-budget.mjs';
import {seal,hash} from '../src/protocol.mjs';
import {aciAuditor} from '../src/aci-auditor.mjs';
try{
 const [mode,inputFile,runtime,output]=process.argv.slice(2);
 if(!['preview','execute'].includes(mode)||!inputFile||!runtime||(mode==='execute'&&!output))
  throw Error('EXPECTED_PREVIEW_OR_EXECUTE_WITH_PRIVATE_INPUT_AND_SHARED_RUNTIME');
 const readJson=async file=>{
  const info=await stat(file);if(!info.isFile()||info.size>2000000)throw Error('PRIVATE_INPUT_TOO_LARGE');
  return JSON.parse(await readFile(file,'utf8'));
 };
 const input=await readJson(inputFile),authority=process.env.FLASHFIRM_SECRET_RELEASE_AUTHORITY_KEY,
  inferenceAuthority=process.env.FLASHFIRM_INFERENCE_VERIFIER_KEY;
 const state={policy:await readJson(path.join(runtime,'aci-spend-policy.json')),
  original:await readJson(path.join(runtime,'provider-policy.json')),ledger:await readJson(path.join(runtime,'provider-budget.json')),
  releaseAuthority:authority,inferenceAuthority,apiKeyPresent:!!process.env.PHALA_ACI_API_KEY};
 const preflight=preflightConfidentialTeam(input,state);
 if(mode==='preview'){
  console.log(JSON.stringify(preflight,null,2));
 }else{
  const keyFile=path.join(runtime,'aci-verifier-secret.json'),keyInfo=await stat(keyFile);
  if(keyInfo.mode&0o077)throw Error('PRIVATE_VERIFIER_KEY_PERMISSIONS_REQUIRED');
  const verifier=await readJson(keyFile);
  if(verifier.publicKey!==inferenceAuthority||
   createPublicKey(verifier.privateKey).export({type:'spki',format:'pem'})!==inferenceAuthority)
   throw Error('EXACT_EXISTING_INFERENCE_VERIFIER_REQUIRED');
  // A new directory plus global approval reservations fence partial retries.
  // No automatic restart, compensation or renewed allowance after a failure.
  await mkdir(output,{mode:0o700});
  await writeFile(path.join(output,'intent.json'),JSON.stringify({taskRoot:input.taskRoot,
   taskDigest:preflight.taskDigest,approvals:input.workers.map(w=>hash(w.approval))}),{flag:'wx',mode:0o600});
  const proofs=[];
  const auditor=process.env.FLASHFIRM_ACI_AUDITOR_URL?
   aciAuditor(process.env.FLASHFIRM_ACI_AUDITOR_URL,process.env.FLASHFIRM_ACI_AUDITOR_TOKEN):null;
  for(const [index,worker]of input.workers.entries()){
   const result=await runConfidentialInference({taskRoot:input.taskRoot,task:input.task,
    workerId:worker.workerId,model:worker.model,approval:worker.approval,runtimeAudit:auditor??worker.runtimeAudit,
    releaseAuthority:authority,apiKey:process.env.PHALA_ACI_API_KEY,proxy:process.env.HTTPS_PROXY,
    reserveSpend:options=>reserveAciSpend(runtime,options)});
   const certificate=seal(result.proof,verifier);proofs.push({certificate,approval:worker.approval});
   await writeFile(path.join(output,`worker-${index}-private.json`),JSON.stringify(result),{flag:'wx',mode:0o600});
   await writeFile(path.join(output,`worker-${index}-certificate.json`),JSON.stringify({certificate,approval:worker.approval}),{flag:'wx',mode:0o600});
  }
  await writeFile(path.join(output,'flow-inference-private.json'),JSON.stringify({proofs}),{flag:'wx',mode:0o600});
  console.log(JSON.stringify({state:'TEAM_CERTIFICATES_SAVED',workers:proofs.length,privateContentLogged:false,
   taskSettlementComplete:false,note:'Attach to the exact report plan through authenticated flow/inference. This does not replace independent review or payment verification.'}));
 }
}catch(e){
 console.error(/^[A-Z][A-Z0-9_]+$/.test(e.message)?e.message:'CONFIDENTIAL_TEAM_STOPPED_CHECK_PRIVATE_CONFIGURATION_AND_RETAIN_PARTIAL_EVIDENCE');
 process.exitCode=1;
}

import {connectAci} from '@phala/aci-verifier/runtime';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {ACI_ORIGIN} from '../src/aci-policy.mjs';
import {readBounded} from '../src/live.mjs';
import {providerLimits} from '../src/provider-limits.mjs';
// Discovery only. Observed measurements are NOT promoted to approved releases.
let connection;
try{
 const runtime=process.argv[2]??'.runtime';
 const policy=JSON.parse(await readFile(runtime+'/provider-policy.json','utf8')),
  ledger=JSON.parse(await readFile(runtime+'/provider-budget.json','utf8'));
 connection=await connectAci({baseURL:ACI_ORIGIN+'/v1',timeoutMs:30000,proxy:process.env.HTTPS_PROXY});
 const response=await connection.fetch(ACI_ORIGIN+'/v1/models',{redirect:'error',signal:AbortSignal.timeout(30000)});
 const models=JSON.parse(await readBounded(response,1000000));
 const checks=connection.identity.transcript.lines.map(({id,status,title})=>({id,status,title}));
 const result={version:'flashfirm-aci-discovery/1',checkedAt:new Date().toISOString(),origin:ACI_ORIGIN,
  checks,observedComposeHash:connection.identity.composeHash,observedKeysetDigest:connection.identity.workloadKeysetDigest,
  models:(models.data??[]).map(m=>({id:m.id})),reviewedRelease:false,
  privateInputReleased:false,modelInferenceExecuted:false,paidCalls:0,
  remainingCalls:providerLimits(policy).maxCalls-ledger.calls.length,
  remainingReservationFen:ledger.capFen-ledger.reservedFen,
  credentialConfigured:!!process.env.PHALA_ACI_API_KEY,
  next:'Have an external auditor appraise OS/KMS/model and reviewed release/session measurements; configure the matching real ACI credential and approved tariff. Do not copy observed hashes into approval automatically.'};
 await mkdir(runtime+'/aci-inspection',{recursive:true,mode:0o700});
 await writeFile(runtime+'/aci-inspection/discovery-'+Date.now()+'.json',JSON.stringify(result,null,2),{flag:'wx',mode:0o600});
 console.log(JSON.stringify(result,null,2));
}catch(e){console.error(JSON.stringify({state:'ACI_DISCOVERY_NOT_VERIFIED',reason:/^[A-Z][A-Z0-9_]+$/.test(e.message)?e.message:'CONNECTION_OR_ATTESTATION_CHECK_FAILED',
 privateInputReleased:false,modelInferenceExecuted:false,paidCalls:0}));process.exitCode=1;
}finally{if(connection)await connection.close();}

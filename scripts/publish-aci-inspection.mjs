import {readFile,writeFile} from 'node:fs/promises';
const file=process.argv[2];
if(!file)throw Error('EXACT_RECORDED_DISCOVERY_FILE_REQUIRED');
const input=JSON.parse(await readFile(file,'utf8'));
if(input.version!=='flashfirm-aci-discovery/1'||input.origin!=='https://inference.phala.com'||
 !Number.isFinite(Date.parse(input.checkedAt))||input.reviewedRelease!==false||
 input.privateInputReleased!==false||input.modelInferenceExecuted!==false||input.paidCalls!==0||
 !['observedComposeHash','observedKeysetDigest'].every(k=>typeof input[k]==='string'&&input[k].length<100)||
 ![1,2,3,4,6].every(id=>input.checks?.some(c=>c.id==='id-'+id&&c.status==='pass'))||
 !input.checks?.some(c=>c.id==='id-5'&&c.status==='skip'))throw Error('LABELED_FREE_CONNECTION_OBSERVATION_REQUIRED');
const result={version:'flashfirm-aci-connection-observation/1',checkedAt:input.checkedAt,origin:input.origin,
 sdk:'@phala/aci-verifier 0.11.0',checks:input.checks.map(({id,status,title})=>({id,status,title})),
 observedComposeHash:input.observedComposeHash,observedKeysetDigest:input.observedKeysetDigest,
 modelIds:input.models.map(m=>m.id),paidCalls:0,privateInputReleased:false,modelInferenceExecuted:false,
 independentlyApprovedRelease:false,portableAttestationProof:false,
 scope:'Recorded free connection discovery by the operator. No raw attestation, channel transcript or inference receipt is published here. Key custody was skipped; observed hashes are not an approved release or trusted model appraisal.'};
await writeFile(new URL('../evidence/aci-connection-discovery.json',import.meta.url),JSON.stringify(result,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({state:'LABELED_RECORDED_CONNECTION_PUBLISHED',paidCalls:0,privateInputReleased:false,modelInferenceExecuted:false}));

import {readFile,writeFile,stat,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {privateQuotationPreflight,runPrivateQuotation} from '../src/private-quotation-runner.mjs';
try{
 const [mode,inputFile,runtime,output]=process.argv.slice(2);
 if(!['preview','execute'].includes(mode)||!inputFile||!runtime||(mode==='execute'&&!output))
  throw Error('EXPECTED_MODE_PRIVATE_INPUT_SHARED_RUNTIME_AND_NEW_OUTPUT');
 const info=await stat(inputFile);if(!info.isFile()||info.size>2000000||(info.mode&0o077))
  throw Error('PRIVATE_INPUT_FILE_PERMISSIONS_REQUIRED');
 const input=JSON.parse(await readFile(inputFile,'utf8')),authority=process.env.FLASHFIRM_SECRET_RELEASE_AUTHORITY_KEY;
 const preflight=privateQuotationPreflight(input,authority);
 if(mode==='preview')console.log(JSON.stringify(preflight,null,2));
 else{
  if(process.env.FLASHFIRM_USE_SYSTEM_PROXY==='1'){
   const {ProxyAgent,setGlobalDispatcher}=await import('../cloudflare/node_modules/undici/index.js');
   setGlobalDispatcher(new ProxyAgent('http://127.0.0.1:7897'));
  }
  await mkdir(output,{mode:0o700});
  await mkdir(path.join(runtime,'private-release-fences'),{recursive:true,mode:0o700});
  const checkpoint=(name,value)=>writeFile(path.join(output,name+'.json'),JSON.stringify(value,null,2),{flag:'wx',mode:0o600});
  await checkpoint('intent',{...preflight,privateTaskReleased:false});
  const result=await runPrivateQuotation(input,{authority,checkpoint,
   reserveRelease:approvalHash=>writeFile(path.join(runtime,'private-release-fences',approvalHash+'.json'),
    JSON.stringify({approvalHash,at:Date.now(),state:'RESERVED_NO_AUTOMATIC_RETRY'}),{flag:'wx',mode:0o600})});
  await checkpoint('result',result);
  console.log(JSON.stringify({state:result.state,privateQuotationVerified:result.privateQuotationVerified,
   confidentialInferenceVerified:false,privateContentLogged:false,paidCalls:0}));
 }
}catch(e){console.error(/^[A-Z][A-Z0-9_]+$/.test(e.message)?e.message:'PRIVATE_RUN_STOPPED_RETAIN_CHECKPOINTS_AND_RECONCILE_RELEASE');process.exitCode=1;}

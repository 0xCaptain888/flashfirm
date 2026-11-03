import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {evaluateTaskWithModel} from '../src/model-evaluation.mjs';
import {preflightLiveJob} from '../src/live-job.mjs';
import {hash} from '../src/protocol.mjs';
const [packageFile]=process.argv.slice(2);
if(!packageFile)throw Error('Usage: node scripts/evaluate-task.mjs /private/evaluation-package.json');
const value=JSON.parse(await readFile(packageFile,'utf8')),plan=value.flow?.plan,receipt=value.record?.receipt??value.receipt;
if(!plan||!receipt)throw Error('PLAN_AND_EXACT_PUBLIC_REPORT_REQUIRED');
const runtime=new URL('../.runtime/',import.meta.url).pathname;
const directory=new URL('../.runtime/quality-evaluations/',import.meta.url);
await mkdir(directory,{recursive:true,mode:0o700});
try{
 const result=await evaluateTaskWithModel(runtime,plan,receipt,{
  preflight:async runtime=>{
   await preflightLiveJob(runtime);
   // An interrupted paid dispatch cannot be replayed by invoking this command
   // again. Keep the fence for explicit operator reconciliation.
   await writeFile(new URL(hash(plan)+'-dispatch.json',directory),
    JSON.stringify({planHash:hash(plan),dispatchedAt:Date.now(),automaticRetryForbidden:true}),{flag:'wx',mode:0o600})
    .catch(error=>{if(error.code==='EEXIST')throw Error('EVALUATION_ALREADY_DISPATCHED_RECONCILE_PARTIAL_OUTPUT');throw error;});
  },
  onProgress:p=>writeFile(new URL(hash(plan)+'-partial.json',directory),JSON.stringify(p),{mode:0o600})});
 await writeFile(new URL(hash(plan)+'-unsigned.json',directory),JSON.stringify(result,null,2),{flag:'wx',mode:0o600});
 console.log('Public-data model evaluation saved for a pinned reviewer to inspect and sign. It does not count as independent review.');
}catch(error){console.error(JSON.stringify({status:'BLOCKED',reason:/^[A-Z0-9_]+$/.test(error.message)?error.message:'EVALUATION_FAILED',noAutomaticRetry:true}));process.exitCode=1;}

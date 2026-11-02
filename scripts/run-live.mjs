import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { BudgetedProvider, collectSources, runLiveReview } from '../src/live.mjs';
const runtime=fileURLToPath(new URL('../.runtime/',import.meta.url));
await mkdir(runtime,{recursive:true,mode:0o700});
try {
  const sources=await collectSources();
  await writeFile(`${runtime}/live-sources.json`,JSON.stringify(sources,null,2),{mode:0o600});
  const resumeId=process.argv.find(a=>a.startsWith('--resume='))?.slice(9);
  if(resumeId&&!/^[a-f0-9-]{36}$/.test(resumeId))throw Error('INVALID_RESUME_ID');
  const resume=resumeId?JSON.parse(await readFile(`${runtime}/live-${resumeId}-partial.json`,'utf8')):null;
  if(resume){
    try{
      const previous=JSON.parse(await readFile(`${runtime}/live-review.json`,'utf8'));
      if(previous.payload.taskId===resumeId){
        await writeFile(`${runtime}/live-review-${previous.payload.review.callId}.json`,JSON.stringify(previous,null,2),{mode:0o600});
        resume.priorReviews=[...(previous.payload.priorReviews??[]),{...previous.payload.review,revisionReason:'Expanded verifier context to complete fetched excerpts; prior critique retained for review.'}];
      }
    }catch(e){if(e.code!=='ENOENT')throw e;}
  }
  const receipt=await runLiveReview(runtime,new BudgetedProvider(runtime),sources,resume);
  const ledger=JSON.parse(await readFile(`${runtime}/provider-budget.json`,'utf8'));
  console.log(JSON.stringify({state:receipt.payload.state,taskId:receipt.payload.taskId,workers:receipt.payload.workers.map(w=>({id:w.worker.id,citationChecks:w.checks,usage:w.usage})),review:receipt.payload.review.verdict,approvedCapCny:20,conservativelyReservedCny:ledger.reservedFen/100,actualInvoiceCost:'NOT_QUERIED',report:`${runtime}/live-report.md`,receipt:`${runtime}/live-review.json`},null,2));
}catch(e){console.error(JSON.stringify({status:'BLOCKED',reason:e.message,paidWorkSaved:true}));process.exitCode=1;}

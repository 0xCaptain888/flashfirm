import {readFile,writeFile} from 'node:fs/promises';
import {verifySourceBytes,auditClaimOverlap} from '../src/source-audit.mjs';
import {readBounded} from '../src/live.mjs';
if(process.env.FLASHFIRM_USE_SYSTEM_PROXY==='1'){
  const {ProxyAgent,setGlobalDispatcher}=await import('../cloudflare/node_modules/undici/index.js');
  setGlobalDispatcher(new ProxyAgent('http://127.0.0.1:7897'));
}
const receipt=JSON.parse(await readFile('evidence/revised-live-receipt.json','utf8'));
const original=receipt.payload.parentReceipt,texts={};
for(const source of original.payload.sources){
  // URLs are fixed by verifyReport; never fetch arbitrary caller-supplied URLs.
  const {verifyReport}=await import('../src/report-revision.mjs');
  if(!verifyReport(receipt).valid)throw Error('INVALID_REPORT');
  texts[source.id]=await readBounded(await fetch(source.url,{redirect:'error',signal:AbortSignal.timeout(25000)}),100000);
}
const result={status:'PINNED_PUBLIC_SOURCES_RETRIEVED_AND_MATCHED',checkedAt:new Date().toISOString(),
  ...verifySourceBytes(receipt,texts),overlap:auditClaimOverlap(receipt),modelCalls:0,financialTransactions:0};
await writeFile('evidence/source-audit.json',JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({status:result.status,files:result.files.length,repeatedEvidenceGroups:result.overlap.repeatedEvidence.length,modelCalls:0}));

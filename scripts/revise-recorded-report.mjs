import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {identity, hash} from '../src/protocol.mjs';
import {reviseReport, verifyReport, citationLocations} from '../src/report-revision.mjs';
const parent=JSON.parse(await readFile(new URL('../evidence/queued-live-receipt.json',import.meta.url),'utf8'));
const runtime=new URL('../.runtime/editorial/',import.meta.url);
await mkdir(runtime,{recursive:true,mode:0o700});
let editor;
try{editor=JSON.parse(await readFile(new URL('identity.json',runtime),'utf8'));}
catch(e){if(e.code!=='ENOENT')throw e;editor=identity();await writeFile(new URL('identity.json',runtime),JSON.stringify(editor),{flag:'wx',mode:0o600});}
const target=new URL('../evidence/revised-live-receipt.json',import.meta.url);
try{
 const existing=JSON.parse(await readFile(target,'utf8'));
 if(!verifyReport(existing).valid||existing.payload.parentHash!==hash(parent))throw Error('Existing revision mismatch; do not overwrite');
 console.log(JSON.stringify({status:'EXISTING_REVISION_VERIFIED',...verifyReport(existing),modelCalls:0}));
}catch(e){
 if(e.code!=='ENOENT')throw e;
 const quote='It will make available the modifier\n * `onlyOwner`, which can be applied to your functions to restrict their use to\n * the owner.';
 const receipt=reviseReport(parent,[{workerId:'sentinel-live',claimIndex:0,operation:'REPLACE_QUOTE',quote,
  reason:'Restore the Solidity documentation comment prefix omitted by the model. Statement is unchanged; exact source text is retained.'}],editor);
 const result=verifyReport(receipt);
 if(!result.valid||result.citationState!=='PASS')throw Error('Revision verification failed');
 await writeFile(target,JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});
 const summary={status:'EDITORIAL_REVISION_SOURCE_CHECKED',createdAt:receipt.payload.createdAt,
  parentHash:receipt.payload.parentHash,receiptHash:hash(receipt),sourceTaskId:receipt.payload.taskId,
  state:receipt.payload.state,citationState:result.citationState,modelCalls:0,financialTransactions:0,
  originalPreserved:true,independentReviewVerified:false,claims:citationLocations(receipt)};
 await writeFile(new URL('../evidence/report-revision.json',import.meta.url),JSON.stringify(summary,null,2)+'\n',{flag:'wx'});
 console.log(JSON.stringify({status:summary.status,state:summary.state,citationState:summary.citationState,modelCalls:0}));
}

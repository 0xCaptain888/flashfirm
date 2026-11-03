import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {settlementManifest} from '../src/task-settlement.mjs';
import {createCase} from '../src/task-case.mjs';
import {hash} from '../src/protocol.mjs';
const root=new URL('../',import.meta.url),proof=JSON.parse(await readFile(new URL('.runtime/same-task-sandbox.json',root),'utf8'));
const receipt=JSON.parse(await readFile(new URL('evidence/revised-live-receipt.json',root),'utf8'));
const manifest=settlementManifest(proof.signedTestFlow,createCase(receipt),proof.syntheticReview,
 {authority:proof.syntheticTrustRoots.identityAuthority},proof.signedTestFlow.plan.payload.createdAt+60001);
if(proof.status!=='PASS'||proof.network!=='LOCAL_SANDBOX'||proof.mainnetPayment!==false||
 proof.publicTestnetPayment!==false||proof.syntheticIdentityAndReviewFixture!==true||proof.exactTransferBodiesVerified!==true||
 proof.manifestHash!==hash(manifest)||proof.resultRoot!==hash(receipt)||
 proof.transactions.filter(t=>t.method==='claim_for').length!==5||
 proof.transactions.filter(t=>t.transfer?.transferVerified===true).length!==5||
 proof.closedStatus.phase!=='Closed'||proof.closedStatus.paid_yocto!==proof.budgetYocto||
 proof.closedStatus.credits_yocto.some(n=>n!=='0')||proof.closedStatus.pending_yocto.some(n=>n!=='0')||
 createHash('sha256').update(await readFile(new URL('artifacts/flashfirm_treasury.wasm',root))).digest('hex')!==proof.wasmSha256)
 throw Error('SAME_TASK_SANDBOX_EVIDENCE_INTEGRITY_FAILED');
await writeFile(new URL('evidence/same-task-settlement-sandbox.json',root),JSON.stringify(proof,null,2)+'\n');
console.log(JSON.stringify({status:'SANDBOX_ONLY_EVIDENCE_PUBLISHED',manifestHash:proof.manifestHash,mainnetPayment:false,paidModelCalls:0}));

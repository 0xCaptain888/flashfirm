import {Worker} from 'near-workspaces';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {nativeFixture} from '../test-support/native-task.mjs';
import {nativeAllocation,NATIVE_TREASURY_SHA256,verifyNativeTransferBody} from '../src/native-task-settlement.mjs';
import {hash} from '../src/protocol.mjs';
import {checkTransaction} from '../src/treasury-policy.mjs';
import {createHash} from 'node:crypto';
const worker=await Worker.init(),gas=100000000000000n;
try{
 const f=nativeFixture(),manifest=f.flow.manifest,root=worker.rootAccount;
 const actors={};
 for(const name of ['buyer','worker-a','worker-b','worker-c','fee','review-a','review-b','review-c','arbiter','sponsor'])
  actors[name]=await root.createSubAccount(name);
 const wasm=await readFile(new URL('../artifacts/flashfirm_treasury.wasm',import.meta.url));
 assert.equal(createHash('sha256').update(wasm).digest('hex'),NATIVE_TREASURY_SHA256);
 const contract=await root.devDeploy(wasm),head=await worker.provider.block({finality:'final'});
 const recipients=['buyer','worker-a','worker-b','worker-c','fee'].map(n=>actors[n].accountId);
 const parts=nativeAllocation(manifest,'1000000000000000000000');
 const mappings=manifest.obligations.map(o=>({obligationId:o.id,kind:o.kind,
  accountId:o.kind==='UNSPENT_REFUND'?recipients[0]:o.kind==='PROTOCOL_FEE'?recipients[4]:
   recipients[manifest.payouts.findIndex(w=>w.id===o.workerId)+1]}));
 const amounts=recipients.map(r=>parts.find(p=>mappings.find(m=>m.obligationId===p.obligationId).accountId===r)?.amountYocto??'0');
 await contract.call(contract,'new',{buyer:actors.buyer.accountId,evaluators:['review-a','review-b','review-c'].map(n=>actors[n].accountId),
  recipients,task_root:manifest.taskRoot,policy_hash:f.plan.payload.reviewPolicyHash,arbiter:actors.arbiter.accountId,
  deadline_ns:String(BigInt(head.header.timestamp_nanosec)+3600000000000n),
  appeal_window_ns:'60000000000',arbitration_window_ns:'60000000000'});
 const records=[];
 async function call(actor,method,args,deposit='0'){
  const result=await actor.callRaw(contract,method,args,{gas,attachedDeposit:BigInt(deposit)});
  const expected={signerId:actor.accountId,receiverId:contract.accountId,actions:[{type:'FunctionCall',params:{
   methodName:method,args,gas:String(gas),deposit}}]};
  const final=await worker.provider.sendJsonRpc(method==='claim_for'?'EXPERIMENTAL_tx_status':'tx',{tx_hash:result.result.transaction.hash,
   sender_account_id:actor.accountId,wait_until:'FINAL'});
  checkTransaction(final,expected);
  const transfer=method==='claim_for'?verifyNativeTransferBody(final,{contractId:contract.accountId,recipient:args.recipient,
   amountYocto:amounts[recipients.indexOf(args.recipient)]}):null;
  records.push({method,hash:result.result.transaction.hash,actor:actor.accountId,args,deposit,...(transfer?{transfer}:{})});
  return result.parseResult();
 }
 const budget='1000000000000000000000';
 await call(actors.buyer,'fund',{},budget);
 const planHash=await call(actors.buyer,'propose',{amounts_yocto:amounts,evidence_root:hash({manifest,parts,mappings})});
 await assert.rejects(actors.sponsor.call(contract,'claim_for',{recipient:recipients[1]},{gas}));
 await call(actors['review-a'],'approve',{plan_hash:planHash});
 await call(actors['review-b'],'approve',{plan_hash:planHash});
 await worker.provider.fastForward(200);
 for(const recipient of recipients)assert.equal(await call(actors.sponsor,'claim_for',{recipient}),true);
 const status=await contract.view('get_status',{});
 assert.equal(status.phase,'Closed');assert.equal(status.paid_yocto,budget);
 assert(status.credits_yocto.every(n=>n==='0'));assert(status.pending_yocto.every(n=>n==='0'));
 await assert.rejects(actors.sponsor.call(contract,'claim_for',{recipient:recipients[1]},{gas}));
 const evidence={version:'flashfirm-same-task-sandbox/1',status:'PASS',network:'LOCAL_SANDBOX',
  at:new Date().toISOString(),resultRoot:manifest.resultRoot,taskRoot:manifest.taskRoot,manifestHash:hash(manifest),
  recordedAiReport:true,syntheticIdentityAndReviewFixture:true,independentHumanReview:false,
  mainnetPayment:false,publicTestnetPayment:false,exactTransferBodiesVerified:true,wasmSha256:NATIVE_TREASURY_SHA256,
  budgetYocto:budget,obligations:mappings.map(m=>({...m,...parts.find(p=>p.obligationId===m.obligationId)})),
  transactions:records,closedStatus:status,
  scope:'Recorded AI report and synthetic signed semantic/identity fixtures bind one manifest to actual local sandbox transfers: three workers, protocol fee and buyer unused budget. No new AI call or external money movement.'};
 evidence.syntheticTrustRoots={identityAuthority:f.authority.publicKey};
 evidence.signedTestFlow=f.flow;evidence.syntheticReview=f.review;
 await mkdir(new URL('../.runtime/',import.meta.url),{recursive:true});
 await writeFile(new URL('../.runtime/same-task-sandbox.json',import.meta.url),JSON.stringify(evidence,null,2));
 console.log(JSON.stringify({status:'PASS',network:evidence.network,obligations:mappings.length,
  reportHash:manifest.resultRoot,workerTransfers:3,feeTransfers:1,refundTransfers:1,mainnetPayment:false},null,2));
}finally{await worker.tearDown();}

import { Worker } from 'near-workspaces';
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const wasm=await readFile(process.env.FLASHFIRM_WASM ?? new URL('../artifacts/flashfirm_treasury.wasm',import.meta.url));
const worker=await Worker.init(),checks=[];
const gas=100000000000000n;
try{
 const root=worker.rootAccount;
 const accounts=[];for(const n of ['buyer','worker','review-a','review-b','review-c','outsider','arbiter'])accounts.push(await root.createSubAccount(n));
 const [buyer,recipient,a,b,c,outsider,arbiter]=accounts;
 const contract=await root.devDeploy(wasm);
 const deadline=String((BigInt(Date.now())+3600000n)*1000000n);
 const args={buyer:buyer.accountId,evaluators:[a,b,c].map(x=>x.accountId),recipients:[buyer,recipient].map(x=>x.accountId),task_root:'a'.repeat(64),deadline_ns:deadline,arbiter:arbiter.accountId,policy_hash:'f'.repeat(64),appeal_window_ns:'60000000000',arbitration_window_ns:'60000000000'};
 await assert.rejects(buyer.call(contract,'new',args));
 await contract.call(contract,'new',args);
 await assert.rejects(outsider.call(contract,'fund',{},{attachedDeposit:10000n}));
 await buyer.call(contract,'fund',{},{attachedDeposit:10000n});
 await assert.rejects(buyer.call(contract,'fund',{},{attachedDeposit:10000n}));checks.push('Buyer-only one-time funding');
 await assert.rejects(buyer.call(contract,'propose',{amounts_yocto:['0','9999'],evidence_root:'b'.repeat(64)}));
 const plan=await buyer.call(contract,'propose',{amounts_yocto:['0','10000'],evidence_root:'b'.repeat(64)});
 await assert.rejects(recipient.call(contract,'claim',{}, {gas}));
 await assert.rejects(outsider.call(contract,'approve',{plan_hash:plan}));
 await assert.rejects(a.call(contract,'approve',{plan_hash:'c'.repeat(64)}));
 await a.call(contract,'approve',{plan_hash:plan});
 await assert.rejects(a.call(contract,'approve',{plan_hash:plan}));
 await assert.rejects(recipient.call(contract,'claim',{}, {gas}));
 await b.call(contract,'approve',{plan_hash:plan});checks.push('Exact allocation, pinned reviewers and 2-of-3 quorum enforced');
 await assert.rejects(outsider.call(contract,'on_claim',{recipient_index:1}));
 await assert.rejects(recipient.call(contract,'claim',{}, {gas}));
 await worker.provider.fastForward(200);
 await assert.rejects(buyer.call(contract,'challenge',{plan_hash:plan,reason_root:'c'.repeat(64)}));
 assert.equal(await recipient.call(contract,'claim',{}, {gas}),true);
 const status=await contract.view('get_status',{});
 assert.equal(status.phase,'Closed');assert.equal(status.paid_yocto,'10000');assert.deepEqual(status.pending_yocto,['0','0']);
 await assert.rejects(recipient.call(contract,'claim',{}, {gas}));checks.push('Real sandbox transfer callback closes accounting; duplicate claim rejected');
 const recovery=await root.devDeploy(wasm),oneNear=10n**24n,temporaryId=`temporary.${root.accountId}`;
 await recovery.call(recovery,'new',{...args,recipients:[buyer.accountId,temporaryId]});
 await buyer.call(recovery,'fund',{},{attachedDeposit:oneNear});
 const recoveryPlan=await buyer.call(recovery,'propose',{amounts_yocto:['0',String(oneNear)],evidence_root:'e'.repeat(64)});
 await a.call(recovery,'approve',{plan_hash:recoveryPlan});await b.call(recovery,'approve',{plan_hash:recoveryPlan});
 await worker.provider.fastForward(200);
 // A never-created named account forces a genuine receipt failure without deletion.
 assert.equal(await outsider.call(recovery,'claim_for',{recipient:temporaryId}, {gas}),false);
 const restored=await recovery.view('get_status',{});assert.equal(restored.credits_yocto[1],String(oneNear));assert.equal(restored.pending_yocto[1],'0');assert.equal(restored.paid_yocto,'0');
 await root.createSubAccount('temporary');
 assert.equal(await outsider.call(recovery,'claim_for',{recipient:temporaryId}, {gas}),true);
 assert.equal((await recovery.view('get_status',{})).phase,'Closed');
 checks.push('Missing sandbox recipient causes real transfer failure; callback restores credit and sponsored retry succeeds');
 const refundable=await root.devDeploy(wasm);
 const block=await worker.provider.block({finality:'final'});
 await refundable.call(refundable,'new',{...args,deadline_ns:String(BigInt(block.header.timestamp_nanosec)+60000000000n)});
 await buyer.call(refundable,'fund',{},{attachedDeposit:10000n});
 await assert.rejects(buyer.call(refundable,'make_refund_available',{}));
 await worker.provider.fastForward(200);
 await buyer.call(refundable,'make_refund_available',{});
 assert.equal(await buyer.call(refundable,'claim',{}, {gas}),true);
 assert.equal((await refundable.view('get_status',{})).phase,'Closed');
 checks.push('Unapproved expired task returns full funding through buyer claim');
 // Direct on-chain dispute enforcement; no trusted HTTP coordinator bypass.
 for(const outcome of ['uphold','reject','timeout']){
   const disputed=await root.devDeploy(wasm),head=await worker.provider.block({finality:'final'});
   await disputed.call(disputed,'new',{...args,deadline_ns:String(BigInt(head.header.timestamp_nanosec)+120000000000n)});
   await buyer.call(disputed,'fund',{},{attachedDeposit:10000n});
   const planHash=await buyer.call(disputed,'propose',{amounts_yocto:['0','10000'],evidence_root:'b'.repeat(64)});
   await a.call(disputed,'approve',{plan_hash:planHash});await b.call(disputed,'approve',{plan_hash:planHash});
   await assert.rejects(outsider.call(disputed,'challenge',{plan_hash:planHash,reason_root:'c'.repeat(64)}));
   await recipient.call(disputed,'challenge',{plan_hash:planHash,reason_root:'c'.repeat(64)});
   await assert.rejects(recipient.call(disputed,'claim',{}, {gas}));
   const resolution={plan_hash:planHash,challenge_root:'c'.repeat(64),uphold:outcome==='uphold',resolution_root:'d'.repeat(64)};
   await assert.rejects(buyer.call(disputed,'resolve_challenge',resolution));
   if(outcome==='timeout'){
     await assert.rejects(buyer.call(disputed,'make_refund_available',{}));
     await worker.provider.fastForward(600);
     await buyer.call(disputed,'make_refund_available',{});
     assert.equal(await buyer.call(disputed,'claim',{}, {gas}),true);
   }else{
     await arbiter.call(disputed,'resolve_challenge',resolution);
     await assert.rejects(arbiter.call(disputed,'resolve_challenge',resolution));
     if(outcome==='uphold'){await worker.provider.fastForward(200);assert.equal(await recipient.call(disputed,'claim',{}, {gas}),true);}
     else {await assert.rejects(recipient.call(disputed,'claim',{}, {gas}));assert.equal(await buyer.call(disputed,'claim',{}, {gas}),true);}
   }
   assert.equal((await disputed.view('get_status',{})).phase,'Closed');
   checks.push(`On-chain appeal ${outcome}: payment gate, pinned arbiter, exact claim/refund and closure verified`);
 }
 const record={status:'PASS',network:'LOCAL_SANDBOX',wasmSha256:createHash('sha256').update(wasm).digest('hex'),checks,closedStatus:status,testnetDeployed:false,failedTransferCallbackTested:true,faultInjection:'Initially nonexistent named recipient created only after callback restored credit; no account deletion or user account involved',at:new Date().toISOString()};
 await mkdir(new URL('../.runtime/',import.meta.url),{recursive:true});await writeFile(new URL('../.runtime/sandbox-evidence.json',import.meta.url),JSON.stringify(record,null,2));console.log(JSON.stringify(record,null,2));
}finally{await worker.tearDown();}

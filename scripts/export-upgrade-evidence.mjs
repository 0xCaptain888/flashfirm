import { readFile, writeFile } from 'node:fs/promises';
import { verifyLiveReceipt } from '../src/live.mjs';
const root=new URL('../',import.meta.url);
const read=async file=>JSON.parse(await readFile(new URL(file,root),'utf8'));
const job=await read('.runtime/queued-live-validation.json'),budget=await read('.runtime/provider-budget.json');
if(job.state!=='SUCCEEDED'||job.receiptValid!==true||!verifyLiveReceipt(job.receipt).valid)throw Error('Queued report invalid');
const exceptions=await read('.runtime/testnet-exceptions/evidence-public.json');
if(exceptions.status!=='VERIFIED'||exceptions.scenarios.some(s=>s.network!=='testnet'||s.phase!=='Closed'||s.userWalletFundsUsed!==false))throw Error('Exception evidence incomplete');
const report={version:'flashfirm-integration-upgrade/1',checkedAt:new Date().toISOString(),ai:{jobId:job.jobId,state:job.state,attempts:job.attempts,receiptValid:true,qualityState:job.receipt.payload.state,settlementExecuted:false,cumulativeCalls:budget.calls.length,conservativeReservedCny:budget.reservedFen/100,capCny:20,actualInvoiceCost:null,issues:job.receipt.payload.workers.flatMap(w=>w.checks.issues.map(issue=>({worker:w.worker.id,issue})))},testnet:{scenarios:exceptions.scenarios.map(s=>({scenario:s.scenario,contractId:s.contractId,phase:s.phase,amountYocto:s.amountYocto,transactions:s.transactions})),failedTransferRecovery:'SANDBOX_ONLY',independentOperators:false},reviewerBinding:{implemented:true,independentOperatorsOnboarded:0},tee:{verifierImplemented:true,hardwareVerified:false,workloadDeployed:false},intents:{previewAdapter:true,liveQuoteVerified:false,paymentVerified:false,blocker:'Official endpoint returned HTTP 521'},backend:{managedModeHttpTested:true,encryptedBackupRestoreTested:true,containerBuilt:false,publicDeployment:false}};
const container = await read('evidence/managed-container.json');
report.backend.containerBuilt = container.status === 'CI_BUILD_AND_SMOKE_TEST_PASSED';
report.backend.containerVerification = container;
try {
 const recovery=await read('.runtime/testnet-recovery/evidence-public.json');
 if(recovery.status!=='VERIFIED'||recovery.network!=='testnet'||recovery.phase!=='Closed'||recovery.failedTransferRecovery!==true||recovery.accountDeletion!==false)throw Error('Invalid recovery evidence');
 const restored=await read('.runtime/testnet-recovery/restored-credit.json');
 if(restored.status.paid_yocto!=='0'||JSON.stringify(restored.status.credits_yocto)!==JSON.stringify(['0',recovery.amountYocto])||restored.status.pending_yocto.some(v=>v!=='0'))throw Error('Invalid restored credit');
 report.testnet.failedTransferRecovery='TESTNET_VERIFIED';
 report.testnet.recovery=recovery;
 await writeFile(new URL('evidence/testnet-recovery.json',root),JSON.stringify(recovery,null,2));
} catch(error) {if(error.code!=='ENOENT')throw error;}
await writeFile(new URL('evidence/queued-live-receipt.json',root),JSON.stringify(job.receipt,null,2));
await writeFile(new URL('evidence/testnet-exceptions.json',root),JSON.stringify(exceptions,null,2));
await writeFile(new URL('evidence/integration-upgrade.json',root),JSON.stringify(report,null,2));
console.log(JSON.stringify({status:'UPGRADE_EVIDENCE_EXPORTED',calls:report.ai.cumulativeCalls,reservedCny:report.ai.conservativeReservedCny,qualityState:report.ai.qualityState,testnetScenarios:exceptions.scenarios.length}));

import {hash} from './protocol.mjs';
import {validateNativeSettlement} from './native-task-settlement.mjs';

// Exact wallet/CLI handoff; no keys, signature generation, networking or send.
export function nativeExecutionPackage(flow,now=Date.now()){
 const envelope=flow.nativeSettlement?.authorization,v=validateNativeSettlement(envelope,flow,now);
 const call=(actor,method,args,deposit='0')=>({signerId:actor,receiverId:v.plan.contractId,
  actions:[{type:'FunctionCall',params:{methodName:method,args,gas:'100000000000000',deposit}}]});
 const transferRows=v.parts.map(part=>({
  ...part,...flow.manifest.obligations.find(o=>o.id===part.obligationId),
  accountId:envelope.payload.accounts.find(a=>a.obligationId===part.obligationId).accountId
 }));
 return {version:'flashfirm-native-execution-package/1',network:v.network,asset:'NATIVE_NEAR',
  taskRoot:flow.manifest.taskRoot,resultRoot:flow.manifest.resultRoot,
  manifestHash:hash(flow.manifest),authorizationHash:v.authorizationHash,contractId:v.plan.contractId,
  budgetYocto:v.budgetYocto,planHash:v.planHash,evidenceRoot:v.evidenceRoot,
  allocations:transferRows,
  prerequisites:['Deploy the exact pinned WASM and initialize the exact buyer-approved configuration.',
   ...(v.network==='mainnet'?['Remove ALL treasury access keys before funding; this is irreversible. Do not lock an uninitialized or unverified contract.']:[]),
   'Verify code and configuration against a final block. Never replay an uncertain transaction.'],
  stages:[
   {id:'fund',requires:'Buyer wallet authorization',transaction:call(v.plan.init.buyer,'fund',{},v.budgetYocto)},
   {id:'propose',requires:'Funding finalized',transaction:call(v.plan.init.buyer,'propose',{amounts_yocto:v.amountsYocto,evidence_root:v.evidenceRoot})},
   {id:'approve',requires:'Two independent pinned reviewers; each must inspect the allocation',
    alternatives:v.plan.init.evaluators.map(actor=>call(actor,'approve',{plan_hash:v.planHash}))},
   {id:'release',requires:'Two approvals and appeal interval elapsed; no unresolved challenge',
    transactions:transferRows.map(row=>call(v.relayer,'claim_for',{recipient:row.accountId}))}
  ],
  verificationInput:{fund:null,propose:null,approvals:[],claims:[]},
  executionPolicy:{version:'flashfirm-escrow-execution/1',enabled:false,network:v.network,
   authorizationHash:v.authorizationHash,contractId:v.plan.contractId,relayer:v.relayer,
   wasmSha256:envelope.payload.wasmSha256,nativeBudgetYocto:v.budgetYocto,maximumCalls:v.parts.length,
   gasPerCall:'100000000000000',expiresAt:v.expiresAt},
  fundsMoved:false,readyToBroadcast:false,
  scope:'Exact transaction preview for one common native NEAR escrow. Allocation weights are not an exchange rate. Mainnet requires separate operator enablement and actual wallet approval.'};
}

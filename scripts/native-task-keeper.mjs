import {readFile,mkdir,writeFile,realpath} from 'node:fs/promises';
import path from 'node:path';
import {connect,KeyPair,keyStores,transactions} from 'near-api-js';
import {executeNativeClaims} from '../src/native-claim-queue.mjs';
import {pinnedTaskVerifiers} from '../src/read-only-rpc.mjs';
import {validateNativeSettlement} from '../src/native-task-settlement.mjs';
// Explicit execution only. This keeper can sponsor fixed claim_for calls, never
// fund, approve, redirect, create accounts or touch mainnet.
const [flowFile,keyFile,journalDir,mode]=process.argv.slice(2);
if(!flowFile||!keyFile||!journalDir||!['preview','execute'].includes(mode))
 throw Error('Usage: node scripts/native-task-keeper.mjs FLOW_JSON TESTNET_RELAYER_KEY_JSON JOURNAL_DIR preview|execute');
const flow=JSON.parse(await readFile(flowFile,'utf8')),v=validateNativeSettlement(flow.nativeSettlement?.authorization,flow);
if(mode==='preview'){
 console.log(JSON.stringify({network:'testnet',contract:v.plan.contractId,relayer:v.relayer,
  allocations:v.parts,fundsMoved:false,method:'claim_for',deposit:'0',gasPerClaim:'100000000000000'},null,2));
}else{
 const credentials=JSON.parse(await readFile(keyFile,'utf8'));
 if(credentials.network!=='testnet'||credentials.accountId!==v.relayer)throw Error('EXACT_TESTNET_RELAYER_KEY_REQUIRED');
 const key=KeyPair.fromString(credentials.privateKey);
 if(key.getPublicKey().toString()!==credentials.publicKey)throw Error('RELAYER_PUBLIC_KEY_MISMATCH');
 const store=new keyStores.InMemoryKeyStore();await store.setKey('testnet',v.relayer,key);
 const near=await connect({networkId:'testnet',nodeUrl:'https://rpc.testnet.near.org',keyStore:store});
 await mkdir(journalDir,{recursive:true,mode:0o700});
 const directory=await realpath(journalDir),file=(id,suffix)=>path.join(directory,id+suffix+'.json');
 const journal={reserve:(id,entry)=>writeFile(file(id,'-intent'),JSON.stringify(entry),{flag:'wx',mode:0o600}),
  record:(id,entry)=>writeFile(file(id,'-'+entry.state),JSON.stringify(entry),{flag:'wx',mode:0o600})};
 const result=await executeNativeClaims({flow,journal,rpc:pinnedTaskVerifiers().nativeRpc,
  send:async action=>{
   const p=action.actions[0].params;
   return (await near.account(action.signerId)).signAndSendTransaction({receiverId:action.receiverId,
    actions:[transactions.functionCall(p.methodName,p.args,BigInt(p.gas),0n)]});
  }});
 console.log(JSON.stringify(result,null,2));
}

// Isolated developer TESTNET recovery test. No user wallet key, mainnet or deletion.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import assert from 'node:assert/strict';
import {connect,keyStores,KeyPair,transactions} from 'near-api-js';
import {DEVELOPER_ACCOUNT,verifyRoleKey,requireFinalSuccess} from '../src/independent-deployment.mjs';
import {nearRpc,FASTNEAR_TESTNET_RPC,inspectTreasury} from '../src/near-rpc.mjs';
import {prepareTestnet,treasuryAction,checkTransaction} from '../src/treasury-policy.mjs';
import {base58} from '../src/near-deployment.mjs';
const mode=process.argv[2];if(!['prepare','run','verify'].includes(mode))throw Error('Expected prepare|run|verify');
const dir=new URL('../.runtime/testnet-recovery/',import.meta.url),original=new URL('../.runtime/independent-testnet/',import.meta.url);
await mkdir(dir,{recursive:true,mode:0o700});
const read=async(name,root=dir)=>JSON.parse(await readFile(new URL(name,root),'utf8'));
const save=(name,data,exclusive=false)=>writeFile(new URL(name,dir),JSON.stringify(data,null,2),{mode:0o600,flag:exclusive?'wx':'w'});
const digest=b=>createHash('sha256').update(b).digest('hex');
const contractId=`recovery-v1.${DEVELOPER_ACCOUNT}`,recipient=`recovery-payee.${DEVELOPER_ACCOUNT}`,amount='1000000000000000000000',gas=100000000000000n;
let last=0;
async function rpc(method,params){
 for(let attempt=0;;attempt++){
  await delay(Math.max(0,1200-(Date.now()-last)));last=Date.now();
  try{return await nearRpc(method,params,fetch,FASTNEAR_TESTNET_RPC);}catch(e){if(e.message!=='Testnet RPC HTTP 429'||attempt===3)throw e;await delay(2000*2**attempt);}
 }
}
if((await rpc('status',[])).chain_id!=='testnet')throw Error('WRONG_NETWORK');
if(mode==='prepare'){
 const balance=await rpc('query',{request_type:'view_account',account_id:DEVELOPER_ACCOUNT,finality:'final'});
 assert.ok(BigInt(balance.amount)>=3n*10n**24n,'Need three testnet NEAR reserve');
 for(const account_id of [contractId,recipient]){
  try{await rpc('query',{request_type:'view_account',account_id,finality:'final'});throw Error('Target already exists');}
  catch(e){if(e.rpcCause!=='UNKNOWN_ACCOUNT')throw e;}
 }
 const keys=[contractId,recipient].map(accountId=>{const key=KeyPair.fromRandom('ed25519');return {accountId,publicKey:key.getPublicKey().toString(),privateKey:key.toString()};});
 await save('keys.json',keys,true);
 await save('plan.json',{network:'testnet',sponsor:DEVELOPER_ACCOUNT,contractId,recipient,contractReserveYocto:String(2n*10n**24n),recipientReserveYocto:String(10n**23n),testDepositYocto:amount,accountDeletion:false,sameOperator:true},true);
 console.log('Prepared isolated testnet recovery; no transaction sent.');process.exit(0);
}
const setup=await read('setup-public.json',original),credentials=await read('developer-key.json',original),roleKeys=await read('role-keys.json',original),keys=await read('keys.json');
assert.equal(credentials.accountId,DEVELOPER_ACCOUNT);assert.equal(credentials.network,'testnet');assert.deepEqual(keys.map(k=>k.accountId),[contractId,recipient]);
const store=new keyStores.InMemoryKeyStore();
for(const item of [credentials,...setup.accounts.map(r=>({...r,privateKey:roleKeys[r.accountId]})),...keys]){
 const key=KeyPair.fromString(item.privateKey);assert.equal(key.getPublicKey().toString(),item.publicKey);await store.setKey('testnet',item.accountId,key);
}
verifyRoleKey(credentials,await rpc('query',{request_type:'view_access_key_list',account_id:DEVELOPER_ACCOUNT,finality:'final'}));
const near=await connect({networkId:'testnet',nodeUrl:FASTNEAR_TESTNET_RPC,keyStore:store});
const wasm=await readFile(new URL('../artifacts/flashfirm_treasury.wasm',import.meta.url)),build=JSON.parse(await readFile(new URL('../artifacts/contract-build.json',import.meta.url),'utf8'));
assert.equal(digest(wasm),build.sha256);
async function submit(label,actor,receiver,actions,expected,failedTransfer=false){
 let record;try{record=await read(label+'-hash.json');}catch(e){if(e.code!=='ENOENT')throw e;}
 if(!record){
  if(mode!=='run')throw Error('Missing '+label);
  await save(label+'-intent.json',{actor,receiver,at:new Date().toISOString()},true);
  // Intent file fences an ambiguous broadcast; never automatically replay.
  const outcome=await(await near.account(actor)).signAndSendTransaction({receiverId:receiver,actions});
  assert.ok(outcome.transaction?.hash);record={hash:outcome.transaction.hash,actor,receiver};await save(label+'-hash.json',record);
 }
 assert.equal(record.actor,actor);assert.equal(record.receiver,receiver);
 const outcome=await rpc('tx',{tx_hash:record.hash,sender_account_id:actor,wait_until:'FINAL'});
 assert.equal(outcome.transaction.hash,record.hash);
 if(failedTransfer){
  assert.equal(outcome.final_execution_status,'FINAL');assert.equal(outcome.transaction.signer_id,actor);assert.equal(outcome.transaction.receiver_id,receiver);
  assert.equal(outcome.status.SuccessValue,Buffer.from('false').toString('base64'));
  const failures=outcome.receipts_outcome.filter(r=>r.outcome.status.Failure);
  assert.equal(failures.length,1);assert.equal(failures[0].outcome.executor_id,recipient);
  assert.equal(failures[0].outcome.status.Failure.ActionError?.kind?.AccountDoesNotExist?.account_id,recipient);
  // Check exact call composition separately from the expected child receipt failure.
  const checked=structuredClone(outcome);checked.status.SuccessValue=Buffer.from('true').toString('base64');checked.receipts_outcome=checked.receipts_outcome.filter(r=>!r.outcome.status.Failure);
  checkTransaction(checked,expected);
 }else{requireFinalSuccess(outcome,actor,receiver);if(expected)checkTransaction(outcome,expected);}
 await save(label+'-final.json',outcome);console.log(JSON.stringify({step:label,hash:record.hash,final:true,expectedFailure:failedTransfer}));return record.hash;
}
let config;try{config=await read('config.json');}catch(e){
 if(e.code!=='ENOENT'||mode!=='run')throw e;
 const block=await rpc('block',{finality:'final'});
 config={network:'testnet',contractId,init:{...setup.config.init,buyer:DEVELOPER_ACCOUNT,recipients:[DEVELOPER_ACCOUNT,recipient],task_root:digest('recovery-v1'),policy_hash:digest('same operator missing recipient recovery'),deadline_ns:String(BigInt(block.header.timestamp_nanosec)+3600n*1000000000n),appeal_window_ns:'60000000000',arbitration_window_ns:'60000000000'}};
 await save('config.json',config,true);
}
assert.equal(config.contractId,contractId);assert.equal(config.init.buyer,DEVELOPER_ACCOUNT);assert.deepEqual(config.init.recipients,[DEVELOPER_ACCOUNT,recipient]);
const plan=prepareTestnet(config,0n),snapshot=()=>inspectTreasury(plan,base58(Buffer.from(build.sha256,'hex')),rpc);
const hashes={};
hashes.create=await submit('create',DEVELOPER_ACCOUNT,contractId,[transactions.createAccount(),transactions.transfer(2n*10n**24n),transactions.addKey(KeyPair.fromString(keys[0].privateKey).getPublicKey(),transactions.fullAccessKey())]);
hashes.deploy=await submit('deploy',contractId,contractId,[transactions.deployContract(wasm),transactions.functionCall('new',plan.init,gas,0n)]);
async function call(label,actor,method,input,failed=false){
 let expected;try{expected=await read(label+'-expected.json');}catch(e){if(e.code!=='ENOENT'||mode!=='run')throw e;const state=await snapshot();expected=treasuryAction(plan,state.status,actor,method,input,state.timestampNs);await save(label+'-expected.json',expected,true);}
 assert.equal(expected.signerId,actor);assert.equal(expected.receiverId,contractId);assert.equal(expected.actions[0].params.methodName,method);
 const p=expected.actions[0].params;return submit(label,actor,contractId,[transactions.functionCall(method,p.args,BigInt(p.gas),BigInt(p.deposit))],expected,failed);
}
hashes.fund=await call('fund',DEVELOPER_ACCOUNT,'fund',{amount_yocto:amount});
hashes.propose=await call('propose',DEVELOPER_ACCOUNT,'propose',{amounts_yocto:['0',amount],evidence_root:digest('failed callback restores exact credit')});
hashes.approveA=await call('approve-a',plan.init.evaluators[0],'approve',{});
hashes.approveB=await call('approve-b',plan.init.evaluators[1],'approve',{});
if(mode==='run'){
 let state=await snapshot();while(state.status.phase!=='Closed'&&!state.status.release_allowed){console.log('Waiting for testnet appeal window.');await delay(15000);state=await snapshot();}
}
hashes.failedClaim=await call('failed-claim',DEVELOPER_ACCOUNT,'claim_for',{recipient},true);
let restored;try{restored=await read('restored-credit.json');}catch(e){
 if(e.code!=='ENOENT'||mode!=='run')throw e;const state=await snapshot();assert.equal(state.status.paid_yocto,'0');assert.deepEqual(state.status.pending_yocto,['0','0']);assert.deepEqual(state.status.credits_yocto,['0',amount]);
 restored={status:state.status,blockHash:state.blockHash,blockHeight:state.blockHeight};await save('restored-credit.json',restored,true);
}
hashes.createRecipient=await submit('create-recipient',DEVELOPER_ACCOUNT,recipient,[transactions.createAccount(),transactions.transfer(10n**23n),transactions.addKey(KeyPair.fromString(keys[1].privateKey).getPublicKey(),transactions.fullAccessKey())]);
hashes.retry=await call('retry-claim',DEVELOPER_ACCOUNT,'claim_for',{recipient});
const final=await snapshot();assert.equal(final.status.phase,'Closed');assert.equal(final.status.paid_yocto,amount);assert.deepEqual(final.status.credits_yocto,['0','0']);assert.deepEqual(final.status.pending_yocto,['0','0']);
const evidence={status:'VERIFIED',network:'testnet',contractId,recipient,amountYocto:amount,transactions:hashes,restoredCreditBlock:restored.blockHeight,finalBlock:final.blockHeight,phase:'Closed',failedTransferRecovery:true,accountDeletion:false,independentOperators:false,fundingSource:'User-funded developer testnet account',verifiedAt:new Date().toISOString()};
await save('evidence-public.json',evidence);console.log(JSON.stringify(evidence));

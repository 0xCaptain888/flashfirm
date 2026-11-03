import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import {paymentPolicy as policy,quoteRequest,validateQuote,usdMicros,preparePayment,validateSignedPayment,verifyOrigin,verifyCrossChain} from '../src/mainnet-payment.mjs';
const require=createRequire(import.meta.url);
const {KeyPair}=require('@near-js/crypto');
const {createTransaction,actionCreators,SignedTransaction,Signature,encodeTransaction}=require('@near-js/transactions');
const now=1804215600000,deposit='1'.repeat(64),sourceHash='2'.repeat(44),destinationHash='0x'+'a'.repeat(64);
test('recorded real dry quote verifies against the official SDK key; changed amount fails',async()=>{
  const artifact=JSON.parse(await readFile(new URL('../evidence/mainnet-route-preview.json',import.meta.url),'utf8'));
  const response=artifact.quote;
  const request=quoteRequest(true,Date.parse(response.quoteRequest.deadline)-30*60000);
  assert.equal(validateQuote(response,request,Date.parse(response.timestamp)),response);
  const tampered=structuredClone(response);tampered.quote.amountOut='1887517';
  assert.throws(()=>validateQuote(tampered,request,Date.parse(response.timestamp)),/SIGNED_QUOTE/);
  assert.equal(artifact.fundsMoved,false);
});
function quote(dry=false){
  const request=quoteRequest(dry,now);
  return {quoteRequest:request,timestamp:new Date(now).toISOString(),signature:'injected-test-verifier-only',
    quote:{amountIn:policy.amount,minAmountIn:policy.amount,amountInUsd:'1.91',amountOut:'1800000',minAmountOut:'1782000',
      ...(dry?{}:{depositAddress:deposit,deadline:request.deadline})}};
}
function fixture(){
  const journal={policy,state:'QUOTED',created:now,quote:quote()};
  const near=async(method,params)=>{
    if(method==='status')return {chain_id:'mainnet'};
    if(method==='block')return {header:{hash:'final',timestamp_nanosec:String(BigInt(now)*1000000n)}};
    if(method==='gas_price')return {gas_price:'100000000'};
    if(params.request_type==='view_account')return {block_hash:'final',amount:'10000000000000000000000000',storage_usage:182};
    const value=params.method_name==='storage_balance_bounds'?{min:'1250000000000000000000'}:null;
    return {block_hash:'final',result:[...Buffer.from(JSON.stringify(value))]};
  };
  return {journal,near};
}
test('mainnet quote pins the approved route, rejects signatures, stale/degraded amounts and overspend',()=>{
  const response=quote(true);
  assert.equal(validateQuote(response,response.quoteRequest,now,()=>true),response);
  assert.throws(()=>validateQuote(response,response.quoteRequest,now,()=>false),/SIGNED_QUOTE/);
  assert.throws(()=>validateQuote(response,{...response.quoteRequest,recipient:'0x'+'b'.repeat(40)},now,()=>true),/SIGNED_QUOTE/);
  assert.throws(()=>validateQuote({...response,quote:{...response.quote,amountInUsd:'4.20'}},response.quoteRequest,now,()=>true),/BUDGET/);
  assert.throws(()=>validateQuote(response,response.quoteRequest,now+120001,()=>true),/QUOTE/);
  assert.throws(()=>validateQuote({...response,quote:{...response.quote,depositAddress:deposit}},response.quoteRequest,now,()=>true),/FUNDING/);
  const defaults={...response,quoteRequest:{...response.quoteRequest,confidentiality:'public',quoteWaitingTimeMs:0,insured:false,appFees:[{recipient:deposit,fee:20}]}};
  assert.equal(validateQuote(defaults,response.quoteRequest,now,()=>true),defaults);
  defaults.quoteRequest.appFees[0].fee=26;
  assert.throws(()=>validateQuote(defaults,response.quoteRequest,now,()=>true),/SERVICE_FEE/);
  assert.equal(usdMicros('1.0000000001'),1000001n);
});
test('payment preparation registers both storage accounts and caps attached value and prepaid gas',async()=>{
  const {journal,near}=fixture(),prepared=await preparePayment(journal,near,now);
  assert.equal(prepared.actions.length,4);
  assert.equal(prepared.actions[0].args.account_id,policy.signer);
  assert.equal(prepared.actions[1].args.account_id,deposit);
  assert.equal(prepared.actions[2].methodName,'near_deposit');
  assert.deepEqual(prepared.actions[3].args,{receiver_id:deposit,amount:policy.amount});
  await assert.rejects(preparePayment(journal,async(m,p)=>m==='status'?{chain_id:'testnet'}:near(m,p),now),/NETWORK/);
  await assert.rejects(preparePayment(journal,async(m,p)=>m==='gas_price'?{gas_price:'999999999999999999'}:near(m,p),now),/FEE_BUDGET/);
  await assert.rejects(preparePayment({...journal,state:'BROADCAST_UNKNOWN'},near,now),/FRESH/);
  await assert.rejects(preparePayment(journal,near,now+120001),/FRESH/);
  await assert.rejects(preparePayment(journal,async(m,p)=>m==='query'&&p.request_type==='view_account'?{block_hash:'final',amount:policy.amount,storage_usage:182}:near(m,p),now),/INSUFFICIENT/);
});
function sign(prepared,change={}){
  const key=KeyPair.fromRandom('ed25519');
  const tx=createTransaction(change.signerId??prepared.signerId,key.getPublicKey(),change.receiverId??prepared.receiverId,1n,
    (change.actions??prepared.actions).map(a=>actionCreators.functionCall(a.methodName,a.args,BigInt(a.gas),BigInt(a.deposit))),new Uint8Array(32));
  const hash=createHash('sha256').update(encodeTransaction(tx)).digest();
  const signature=new Signature({keyType:0,data:key.sign(hash).signature});
  return Buffer.from(new SignedTransaction({transaction:tx,signature}).encode()).toString('base64');
}
test('signed bytes must match exact signer, receiver, methods, arguments and amount; hash is deterministic',async()=>{
  const {journal,near}=fixture(),prepared=await preparePayment(journal,near,now),bytes=sign(prepared);
  assert.equal(validateSignedPayment(bytes,prepared).hash,validateSignedPayment(bytes,prepared).hash);
  assert.throws(()=>validateSignedPayment(sign(prepared,{signerId:'other.near'}),prepared),/SUBSTITUTED/);
  assert.throws(()=>validateSignedPayment(sign(prepared,{receiverId:'attacker.near'}),prepared),/SUBSTITUTED/);
  const actions=structuredClone(prepared.actions);actions[3].args.receiver_id='attacker.near';
  assert.throws(()=>validateSignedPayment(sign(prepared,{actions}),prepared),/SUBSTITUTED/);
  actions[3].args.receiver_id=deposit;actions[2].deposit=String(BigInt(policy.amount)+1n);
  assert.throws(()=>validateSignedPayment(sign(prepared,{actions}),prepared),/SUBSTITUTED/);
  const corrupt=Buffer.from(bytes,'base64');corrupt[corrupt.length-1]^=1;
  assert.throws(()=>validateSignedPayment(corrupt.toString('base64'),prepared),/SIGNATURE/);
});
test('origin verification requires final success, exact actions and the matching wNEAR Transfer event',async()=>{
  const {journal,near}=fixture();journal.prepared=await preparePayment(journal,near,now);journal.sourceHash=sourceHash;
  const outcome={final_execution_status:'FINAL',status:{SuccessValue:''},
    transaction:{hash:sourceHash,signer_id:policy.signer,receiver_id:'wrap.near',
      actions:journal.prepared.actions.map(a=>({FunctionCall:{method_name:a.methodName,args:Buffer.from(JSON.stringify(a.args)).toString('base64'),gas:a.gas,deposit:a.deposit}}))},
    receipts_outcome:[{outcome:{executor_id:'wrap.near',status:{SuccessValue:''},
      logs:['EVENT_JSON:'+JSON.stringify({standard:'nep141',event:'ft_transfer',data:[{old_owner_id:policy.signer,new_owner_id:deposit,amount:policy.amount}]})]}}]};
  const rpc=async(m,p)=>m==='tx'?outcome:near(m,p);
  assert.equal((await verifyOrigin(journal,rpc)).verified,true);
  outcome.final_execution_status='EXECUTED_OPTIMISTIC';
  await assert.rejects(verifyOrigin(journal,rpc),/FINAL/);
  outcome.final_execution_status='FINAL';outcome.receipts_outcome[0].outcome.executor_id='fake.near';
  await assert.rejects(verifyOrigin(journal,rpc),/EVENT/);
});
test('cross-chain SUCCESS requires origin mapping, exact destination amount and finality; relay-only is never enough',async()=>{
  const {journal}=fixture();journal.sourceHash=sourceHash;journal.origin={verified:true,hash:sourceHash};
  const status={status:'SUCCESS',quoteResponse:journal.quote,swapDetails:{originChainTxHashes:[{hash:sourceHash}],
    destinationChainTxHashes:[{hash:destinationHash}],amountIn:policy.amount,amountOut:'1800000',intentHashes:['intent']}};
  const receipt={transactionHash:destinationHash,status:'0x1',blockHash:'block',blockNumber:'0x10',logs:[{
    address:policy.token,logIndex:'0x0',topics:['0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
      '0x'+'0'.repeat(64),'0x'+'0'.repeat(24)+policy.recipient.slice(2)],data:'0x'+(1800000n).toString(16).padStart(64,'0')}]};
  let finalized='0x11';
  const rpc=async(m,p)=>m==='eth_chainId'?policy.chainId:m==='eth_getTransactionReceipt'?receipt:
    p[0]==='finalized'?{number:finalized}:{hash:'block',timestamp:'0x'+Math.ceil(now/1000).toString(16)};
  const result=await verifyCrossChain(journal,status,rpc,()=>true);
  assert.equal(result.crossChainOriginVerified,true);assert.equal(result.automaticTaskPayout,false);
  finalized='0xf';await assert.rejects(verifyCrossChain(journal,status,rpc,()=>true),/NOT_FINAL/);
  finalized='0x11';status.swapDetails.originChainTxHashes=[];
  await assert.rejects(verifyCrossChain(journal,status,rpc,()=>true),/LINKAGE/);
  const waiting=await verifyCrossChain(journal,{status:'REFUNDED',quoteResponse:journal.quote},rpc,()=>true);
  assert.equal(waiting.verified,false);assert.match(waiting.next,/NO_REDEPOSIT/);
  await assert.rejects(verifyCrossChain({...journal,origin:null},status,rpc,()=>true),/ORIGIN/);
});

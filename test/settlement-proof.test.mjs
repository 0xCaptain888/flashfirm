import test from 'node:test';
import assert from 'node:assert/strict';
import {bindTaskQuote,verifyNearNative,verifyTaskPayment,verifyNativeRefund,taskRoute} from '../src/settlement-proof.mjs';
import {nativePaymentPreview} from '../src/payment-preview.mjs';
const now=Date.now(),sourceHash='1'.repeat(44),dstHash='0x'+'a'.repeat(64);
function data(){
 const invoice={state:'AUTHORIZED_NOT_FUNDED',sourceAccount:'payer.near',recipient:'0x'+'2'.repeat(40),
  originAmountYocto:'500000000000000000000000',maximumFeeYocto:'10000000000000000000000',
  minimumUsdcUnits:'1000000',createdAt:now-1000,expiresAt:now+3600000};
 const quote={signature:'synthetic-test-only',timestamp:new Date(now).toISOString(),
  quoteRequest:{dry:false,swapType:'EXACT_INPUT',depositMode:'SIMPLE',originAsset:taskRoute.originAsset,
  destinationAsset:taskRoute.destinationAsset,depositType:'ORIGIN_CHAIN',recipientType:'DESTINATION_CHAIN',
  refundType:'ORIGIN_CHAIN',refundTo:invoice.sourceAccount,recipient:invoice.recipient,amount:invoice.originAmountYocto,
  slippageTolerance:100,deadline:new Date(now+600000).toISOString()},
  quote:{depositAddress:'deposit.near',amountIn:invoice.originAmountYocto,minAmountOut:'1000000',deadline:new Date(now+600000).toISOString()}};
 return {invoice,quote};
}
test('task quote is bound after authorization and refuses historical, changed recipients and unsigned responses',()=>{
 const {invoice,quote}=data();
 assert.equal(bindTaskQuote(invoice,quote,now,()=>true).state,'QUOTED');
 assert.throws(()=>bindTaskQuote(invoice,quote,now,()=>false),/REJECTED/);
 const changed=structuredClone(quote);changed.quoteRequest.recipient='0x'+'3'.repeat(40);
 assert.throws(()=>bindTaskQuote(invoice,changed,now,()=>true),/REJECTED/);
 assert.throws(()=>bindTaskQuote({...invoice,createdAt:now+1},quote,now,()=>true),/REJECTED/);
 assert.throws(()=>bindTaskQuote(invoice,quote,now+300000,()=>true),/REJECTED/);
});
test('both-chain proof requires finalized exact deposit, fee cap and relay-linked finalized ERC20 transfer',async()=>{
 const {invoice,quote}=data(),bound=bindTaskQuote(invoice,quote,now,()=>true);
 const source={final_execution_status:'FINAL',status:{SuccessValue:''},transaction:{hash:sourceHash,signer_id:'payer.near',receiver_id:'deposit.near',
  actions:[{Transfer:{deposit:invoice.originAmountYocto}}]},transaction_outcome:{block_hash:'source-block',outcome:{tokens_burnt:'1'}},
  receipts_outcome:[{id:'receipt',outcome:{status:{SuccessValue:''},tokens_burnt:'2'}}]};
 const nearRpc=async method=>method==='status'?{chain_id:'mainnet'}:method==='block'?{header:{hash:'source-block',timestamp_nanosec:String(BigInt(now+1000)*1000000n)}}:source;
 const relay={status:'SUCCESS',quoteResponse:quote,swapDetails:{amountIn:invoice.originAmountYocto,amountOut:'1000001',
  originChainTxHashes:[{hash:sourceHash}],destinationChainTxHashes:[{hash:dstHash}]}};
 const evmRpc=async method=>method==='eth_chainId'?'0xa4b1':method==='eth_getTransactionReceipt'?
  {status:'0x1',transactionHash:dstHash,blockNumber:'0x10',blockHash:'block',logs:[{logIndex:'0x0',address:taskRoute.token,
   topics:['0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef','0x'+'0'.repeat(64),'0x'+'0'.repeat(24)+invoice.recipient.slice(2)],data:'0x'+(1000001n).toString(16).padStart(64,'0')}]}:
  {number:'0x10',hash:'block',timestamp:'0x'+Math.ceil((now+1000)/1000).toString(16)};
 const verifiers={nearRpc,evmRpc,status:async()=>relay};
 const proof=await verifyTaskPayment(bound,sourceHash,verifiers,()=>true);assert.equal(proof.paymentVerified,true);
 source.transaction.actions[0].Transfer.deposit='1';
 await assert.rejects(verifyTaskPayment(bound,sourceHash,verifiers,()=>true),/EXACT_NATIVE/);
 source.transaction.actions[0].Transfer.deposit=invoice.originAmountYocto;
 relay.status='REFUNDED';relay.swapDetails.refundedAmount='100';
 const refund=await verifyTaskPayment(bound,sourceHash,verifiers,()=>true);
 assert.equal(refund.state,'REFUND_PENDING');assert.equal(refund.refundVerified,false);
});
test('human-readable preview uses exact decimals and never invokes an unparsed wallet request',()=>{
 const p=nativePaymentPreview({source:'payer.near',receiver:'deposit.near',amountYocto:'500000000000000000000000',
  maximumFeeYocto:'100000000000000000000000',minimumUsdcUnits:'1861840',
  recipient:'0x'+'2'.repeat(40),deadline:new Date(now+600000).toISOString()});
 assert.equal(p.amount,'0.5 NEAR');assert.equal(p.minimumReceipt,'1.86184 native USDC');
 assert.equal(p.automaticWalletHandoff,false);assert.equal(p.contractCalls,0);
});
test('refund needs relay-linked exact successful native receipt bodies; a status or balance claim is insufficient',async()=>{
 const {invoice,quote}=data(),bound={...bindTaskQuote(invoice,quote,now,()=>true),state:'REFUND_PENDING',
  sourceHash,evidence:{origin:{hash:sourceHash,verified:true}}};
 const refundHash='2'.repeat(44),relay={status:'REFUNDED',quoteResponse:quote,swapDetails:{refundedAmount:'10000',nearTxHashes:[refundHash],
  originChainTxHashes:[{hash:sourceHash}]}};
 const source={final_execution_status:'FINAL',status:{SuccessValue:''},transaction:{hash:sourceHash,signer_id:'payer.near',receiver_id:'deposit.near',
  actions:[{Transfer:{deposit:invoice.originAmountYocto}}]},transaction_outcome:{block_hash:'source-block',outcome:{tokens_burnt:'1'}},
  receipts_outcome:[{id:'source-receipt',outcome:{status:{SuccessValue:''},tokens_burnt:'2'}}]};
 const outcome={final_execution_status:'FINAL',status:{SuccessValue:''},transaction:{hash:refundHash},
  transaction_outcome:{block_hash:'refund-block',outcome:{receipt_ids:['receipt']}},receipts:[{receipt_id:'receipt',receiver_id:'payer.near',predecessor_id:'deposit.near',
   receipt:{Action:{actions:[{Transfer:{deposit:'10000'}}]}}}],
  receipts_outcome:[{id:'receipt',outcome:{executor_id:'payer.near',status:{SuccessValue:''}}}]};
 const nearRpc=async(method,params)=>method==='status'?{chain_id:'mainnet'}:method==='block'?{
  header:{hash:params.block_id,timestamp_nanosec:String(BigInt(now+1000)*1000000n)}}:method==='tx'?source:outcome;
 const verifiers={nearRpc,status:async()=>relay};
 const proof=await verifyNativeRefund(bound,refundHash,verifiers,()=>true);
 assert.equal(proof.refundVerified,true);assert.equal(proof.sourceHash,sourceHash);
 assert.equal(proof.unreturnedPrincipalYocto,String(BigInt(invoice.originAmountYocto)-10000n));
 outcome.receipts[0].predecessor_id='unrelated-donor.near';
 await assert.rejects(verifyNativeRefund(bound,refundHash,verifiers,()=>true),/EXACT_REFUND/);
 outcome.receipts[0].predecessor_id='deposit.near';
 outcome.transaction_outcome.outcome.receipt_ids=[];
 await assert.rejects(verifyNativeRefund(bound,refundHash,verifiers,()=>true),/EXACT_REFUND/);
 outcome.transaction_outcome.outcome.receipt_ids=['receipt'];
 outcome.receipts.push(structuredClone(outcome.receipts[0]));
 await assert.rejects(verifyNativeRefund(bound,refundHash,verifiers,()=>true),/UNIQUE_REFUND/);
 outcome.receipts.pop();
 source.transaction.actions[0].Transfer.deposit='1';
 await assert.rejects(verifyNativeRefund(bound,refundHash,verifiers,()=>true),/EXACT_NATIVE/);
 source.transaction.actions[0].Transfer.deposit=invoice.originAmountYocto;
 await assert.rejects(verifyNativeRefund({...bound,sourceHash:undefined},refundHash,verifiers,()=>true),/VERIFIED_TASK_SOURCE/);
 const unchanged=structuredClone(relay.quoteResponse);
 relay.quoteResponse=structuredClone(quote);relay.quoteResponse.quoteRequest.refundTo='attacker.near';
 await assert.rejects(verifyNativeRefund(bound,refundHash,verifiers,()=>true),/RELAY_REQUEST_CHANGED/);
 relay.quoteResponse=unchanged;
 // Real native withdrawals can be emitted by wrap.near; require the exact
 // reachable near_withdraw call from this deposit, never a generic gas refund.
 outcome.receipts[0].predecessor_id='wrap.near';
 await assert.rejects(verifyNativeRefund(bound,refundHash,verifiers,()=>true),/EXACT_REFUND/);
 outcome.receipts.push({receipt_id:'unwrap',predecessor_id:'deposit.near',receiver_id:'wrap.near',
  receipt:{Action:{actions:[{FunctionCall:{method_name:'near_withdraw',deposit:'1',args:Buffer.from(JSON.stringify({amount:'10000'})).toString('base64')}}]}}});
 outcome.receipts_outcome.push({id:'unwrap',outcome:{executor_id:'wrap.near',status:{SuccessReceiptId:'receipt'},receipt_ids:['receipt']}});
 outcome.transaction_outcome.outcome.receipt_ids=['unwrap'];
 assert.equal((await verifyNativeRefund(bound,refundHash,verifiers,()=>true)).refundVerified,true);
 outcome.receipts=[];
 await assert.rejects(verifyNativeRefund(bound,refundHash,verifiers,()=>true),/EXACT_REFUND/);
 relay.swapDetails.nearTxHashes=['3'.repeat(44)];
 await assert.rejects(verifyNativeRefund(bound,refundHash,verifiers,()=>true),/RELAY_LINKED/);
});

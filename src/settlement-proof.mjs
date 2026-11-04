import {verifyQuoteSignature} from '@defuse-protocol/one-click-sdk-typescript';
import {canonical,hash} from './protocol.mjs';
import {verifyEvmDelivery,validateDestination} from './intents.mjs';

const units=v=>typeof v==='string'&&/^[1-9]\d{0,77}$/.test(v);
export const taskRoute=Object.freeze({chainId:'0xa4b1',token:'0xaf88d065e77c8cc2239327c5edb3a432268e5831',
  originAsset:'nep141:wrap.near',destinationAsset:'nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near'});
export function bindTaskQuote(invoice,response,now=Date.now(),verifySignature=verifyQuoteSignature) {
  const r=response?.quoteRequest,q=response?.quote;
  if(!verifySignature(response)||!r||!q||r.dry!==false||r.swapType!=='EXACT_INPUT'||
    r.depositMode!=='SIMPLE'||r.originAsset!==taskRoute.originAsset||r.destinationAsset!==taskRoute.destinationAsset||
    r.depositType!=='ORIGIN_CHAIN'||r.recipientType!=='DESTINATION_CHAIN'||r.refundType!=='ORIGIN_CHAIN'||
    r.refundTo!==invoice.sourceAccount||r.recipient!==invoice.recipient||r.amount!==invoice.originAmountYocto||
    !Number.isInteger(r.slippageTolerance)||r.slippageTolerance<0||r.slippageTolerance>100||
    q.depositMemo||q.amountIn!==invoice.originAmountYocto||!units(q.minAmountOut)||
    BigInt(q.minAmountOut)<BigInt(invoice.minimumUsdcUnits)||
    !Number.isFinite(Date.parse(response.timestamp))||Math.abs(Date.parse(response.timestamp)-now)>120000||
    Date.parse(response.timestamp)<invoice.createdAt||
    !Number.isFinite(Date.parse(q.deadline))||Date.parse(q.deadline)<now+120000||
    !Number.isFinite(Date.parse(r.deadline))||Date.parse(r.deadline)<now+120000||
    Date.parse(q.deadline)>invoice.expiresAt)throw Error('TASK_QUOTE_BINDING_REJECTED');
  validateDestination('near',q.depositAddress);
  if(q.depositAddress===invoice.sourceAccount)throw Error('INVALID_DEPOSIT_ADDRESS');
  return {...invoice,state:'QUOTED',quote:response,quoteHash:hash(response),quoteBoundAt:now};
}
function successful(outcome,hashValue){
  if(outcome?.final_execution_status!=='FINAL'||outcome.transaction?.hash!==hashValue||
    !Object.hasOwn(outcome.status??{},'SuccessValue')||!Array.isArray(outcome.receipts_outcome)||
    outcome.receipts_outcome.some(r=>!Object.hasOwn(r.outcome?.status??{},'SuccessValue')&&!Object.hasOwn(r.outcome?.status??{},'SuccessReceiptId')))
    throw Error('NEAR_TRANSACTION_NOT_SUCCESSFULLY_FINAL');
}
export async function verifyNearNative(expected,rpc){
  if((await rpc('status',[])).chain_id!=='mainnet')throw Error('WRONG_NEAR_NETWORK');
  const outcome=await rpc('tx',{tx_hash:expected.hash,sender_account_id:expected.signer,wait_until:'FINAL'});
  successful(outcome,expected.hash);
  const tx=outcome.transaction;
  if(tx.signer_id!==expected.signer||tx.receiver_id!==expected.receiver||
    !Array.isArray(tx.actions)||tx.actions.length!==1||
    Object.keys(tx.actions[0]).join()!=='Transfer'||tx.actions[0].Transfer?.deposit!==expected.amount)
    throw Error('EXACT_NATIVE_TRANSFER_REQUIRED');
  const block=await rpc('block',{block_id:outcome.transaction_outcome.block_hash});
  if(block.header.hash!==outcome.transaction_outcome.block_hash)throw Error('SOURCE_BLOCK_MISMATCH');
  const time=Number(BigInt(block.header.timestamp_nanosec)/1000000n);
  if(!Number.isFinite(time)||time<expected.notBefore||time>expected.notAfter)throw Error('TRANSFER_OUTSIDE_INVOICE_WINDOW');
  const fees=[outcome.transaction_outcome,...outcome.receipts_outcome].map(r=>r.outcome.tokens_burnt);
  if(fees.some(v=>!/^(0|[1-9]\d{0,77})$/.test(v??'')))throw Error('SOURCE_FEE_EVIDENCE_REQUIRED');
  const fee=fees.reduce((s,v)=>s+BigInt(v),0n);
  if(expected.maxFee&&fee>BigInt(expected.maxFee))throw Error('SOURCE_FEE_BUDGET_EXCEEDED');
  return {hash:expected.hash,signer:tx.signer_id,receiver:tx.receiver_id,amount:expected.amount,
    blockHash:block.header.hash,at:time,feeYocto:String(fee),verified:true};
}
export async function verifyTaskPayment(invoice,sourceHash,{nearRpc,evmRpc,status},verifySignature=verifyQuoteSignature){
  if(!invoice.quote||!['QUOTED','SOURCE_VERIFIED','REFUND_PENDING'].includes(invoice.state))throw Error('BOUND_QUOTE_REQUIRED');
  const quote=invoice.quote,relay=await status(quote);
  if(!verifySignature(quote)||!verifySignature(relay.quoteResponse)||
    relay.quoteResponse.signature!==quote.signature||canonical(relay.quoteResponse.quote)!==canonical(quote.quote))
    throw Error('SIGNED_RELAY_QUOTE_MISMATCH');
  // 1Click may add null/default request fields in status; compare every
  // economically relevant request field against the locally bound quote.
  for(const k of ['amount','originAsset','destinationAsset','recipient','recipientType','refundTo','refundType','depositType','dry','swapType','slippageTolerance'])
    if(relay.quoteResponse.quoteRequest?.[k]!==quote.quoteRequest[k])throw Error('RELAY_REQUEST_CHANGED');
  const origin=await verifyNearNative({hash:sourceHash,signer:invoice.sourceAccount,
    receiver:quote.quote.depositAddress,amount:invoice.originAmountYocto,notBefore:invoice.quoteBoundAt,
    notAfter:relay.status==='REFUNDED'?invoice.expiresAt:Date.parse(quote.quote.deadline),maxFee:invoice.maximumFeeYocto},nearRpc);
  const d=relay.swapDetails;
  if(!d?.originChainTxHashes?.some(t=>t.hash===sourceHash))throw Error('SOURCE_RELAY_LINK_REQUIRED');
  if(relay.status==='REFUNDED')return {state:'REFUND_PENDING',origin,relayStatus:'REFUNDED',refundedAmount:d.refundedAmount,
    refundVerified:false,next:'Supply a relay-linked refund receipt; a status label is not a refund proof.'};
  if(relay.status!=='SUCCESS')return {state:'SOURCE_VERIFIED',origin,relayStatus:relay.status,paymentVerified:false};
  if(d.amountIn!==invoice.originAmountYocto||!units(d.amountOut)||BigInt(d.amountOut)<BigInt(quote.quote.minAmountOut)||
    d.destinationChainTxHashes?.length!==1)throw Error('DESTINATION_RELAY_LINK_REQUIRED');
  const delivery=await verifyEvmDelivery({...taskRoute,recipient:invoice.recipient,minimumAmount:d.amountOut,
    hash:d.destinationChainTxHashes[0].hash,notBeforeSeconds:Math.ceil(invoice.quoteBoundAt/1000)},evmRpc);
  return {state:'VERIFIED',paymentVerified:true,origin,delivery,
    linkageTrust:'Signed 1Click quote and relay mapping; both finalized chain transactions independently checked'};
}
// No acceptance based on balance changes or a relay REFUNDED label. Native
// refunds must be visible as an exact successful action in a relay-linked NEAR
// receipt tree. A wrap.near withdrawal is accepted only with its exact
// deposit-originating ancestor; wrapped-token balances alone are insufficient.
export async function verifyNativeRefund(invoice,refundHash,{nearRpc,status},verifySignature=verifyQuoteSignature){
  if(invoice.state!=='REFUND_PENDING'||!invoice.sourceHash||invoice.evidence?.origin?.hash!==invoice.sourceHash||
    invoice.evidence?.origin?.verified!==true)throw Error('VERIFIED_TASK_SOURCE_REQUIRED_BEFORE_REFUND');
  const relay=await status(invoice.quote),d=relay.swapDetails;
  if(relay.status!=='REFUNDED'||relay.quoteResponse?.signature!==invoice.quote.signature||
    !verifySignature(invoice.quote)||!verifySignature(relay.quoteResponse)||!units(d?.refundedAmount)||
    BigInt(d.refundedAmount)>BigInt(invoice.originAmountYocto)||!d.nearTxHashes?.includes(refundHash))
    throw Error('SIGNED_RELAY_LINKED_REFUND_REQUIRED');
  if(canonical(relay.quoteResponse.quote)!==canonical(invoice.quote.quote))throw Error('SIGNED_RELAY_QUOTE_MISMATCH');
  for(const key of ['amount','originAsset','destinationAsset','recipient','recipientType','refundTo','refundType','depositType','depositMode','dry','swapType','slippageTolerance'])
    if(relay.quoteResponse.quoteRequest?.[key]!==invoice.quote.quoteRequest[key])throw Error('RELAY_REQUEST_CHANGED');
  if(!d.originChainTxHashes?.some(t=>t.hash===invoice.sourceHash))throw Error('SOURCE_RELAY_LINK_REQUIRED');
  const origin=await verifyNearNative({hash:invoice.sourceHash,signer:invoice.sourceAccount,
    receiver:invoice.quote.quote.depositAddress,amount:invoice.originAmountYocto,notBefore:invoice.quoteBoundAt,
    notAfter:invoice.expiresAt,maxFee:invoice.maximumFeeYocto},nearRpc);
  if((await nearRpc('status',[])).chain_id!=='mainnet')throw Error('WRONG_NEAR_NETWORK');
  const outcome=await nearRpc('EXPERIMENTAL_tx_status',{tx_hash:refundHash,sender_account_id:invoice.quote.quote.depositAddress,wait_until:'FINAL'});
  successful(outcome,refundHash);
  if(!Array.isArray(outcome.receipts)||!Array.isArray(outcome.receipts_outcome)||
    new Set(outcome.receipts.map(r=>r.receipt_id)).size!==outcome.receipts.length||
    new Set(outcome.receipts_outcome.map(r=>r.id)).size!==outcome.receipts_outcome.length)
    throw Error('FULL_UNIQUE_REFUND_RECEIPTS_REQUIRED');
  const receipts=new Map(outcome.receipts.map(r=>[r.receipt_id,r])),
    outcomes=new Map(outcome.receipts_outcome.map(r=>[r.id,r.outcome]));
  const reachable=new Set(),parents=new Map(),queue=[...(outcome.transaction_outcome?.outcome?.receipt_ids??[])];
  while(queue.length){
    const id=queue.shift();if(reachable.has(id))continue;reachable.add(id);
    for(const child of outcomes.get(id)?.receipt_ids??[]){if(!parents.has(child))parents.set(child,id);queue.push(child);}
  }
  const deposit=invoice.quote.quote.depositAddress;
  const authorizedUnwrap=(id,amount)=>{
    const visited=new Set();
    for(let parent=parents.get(id);parent;parent=parents.get(parent)){
      if(visited.has(parent))return false;visited.add(parent);
      const body=receipts.get(parent),row=outcomes.get(parent),actions=body?.receipt?.Action?.actions;
      if(body?.predecessor_id!==deposit||body.receiver_id!=='wrap.near'||row?.executor_id!=='wrap.near'||
        !Array.isArray(actions)||actions.length!==1)continue;
      const call=actions[0].FunctionCall;
      if(call?.method_name!=='near_withdraw'||call.deposit!=='1')continue;
      try{if(JSON.parse(Buffer.from(call.args,'base64').toString()).amount===amount)return true;}catch{}
    }
    return false;
  };
  let refunded=0n;const evidence=[],seen=new Set();
  for(const row of outcome.receipts_outcome){
    const receipt=receipts.get(row.id);
    if(!receipt||!reachable.has(row.id)||seen.has(row.id))continue;seen.add(row.id);
    if(receipt.receiver_id!==invoice.sourceAccount||row.outcome.executor_id!==invoice.sourceAccount||
      !Object.hasOwn(row.outcome.status??{},'SuccessValue'))continue;
    const actions=receipt.receipt?.Action?.actions;
    if(!Array.isArray(actions)||actions.length!==1||Object.keys(actions[0]).join()!=='Transfer'||
      !units(actions[0].Transfer?.deposit))continue;
    const amount=actions[0].Transfer.deposit;
    if(receipt.predecessor_id!==deposit&&!(receipt.predecessor_id==='wrap.near'&&authorizedUnwrap(row.id,amount)))continue;
    refunded+=BigInt(amount);evidence.push(row.id);
  }
  if(refunded!==BigInt(d.refundedAmount)||!evidence.length)throw Error('EXACT_REFUND_RECEIPTS_REQUIRED');
  const block=await nearRpc('block',{block_id:outcome.transaction_outcome.block_hash});
  if(block.header.hash!==outcome.transaction_outcome.block_hash||
    Number(BigInt(block.header.timestamp_nanosec)/1000000n)<invoice.quoteBoundAt)throw Error('HISTORICAL_REFUND_REJECTED');
  const refundAt=Number(BigInt(block.header.timestamp_nanosec)/1000000n);
  if(refundAt<origin.at)throw Error('REFUND_PREDATES_TASK_SOURCE');
  return {state:'REFUNDED',refundVerified:true,refundHash,amount:String(refunded),receiptIds:evidence,
    origin,sourceHash:invoice.sourceHash,invoiceHash:invoice.invoiceHash,quoteHash:hash(invoice.quote),
    receiver:invoice.sourceAccount,unreturnedPrincipalYocto:String(BigInt(invoice.originAmountYocto)-refunded),
    refundAt,scope:'Reverified exact task deposit plus reachable native refund actions from the deposit or its exact wrapped-NEAR withdrawal. Shortfall is recorded, not assumed to be a fee.'};
}

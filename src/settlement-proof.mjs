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
    notAfter:relay.status==='REFUNDED'?Number.MAX_SAFE_INTEGER:Date.parse(quote.quote.deadline),maxFee:invoice.maximumFeeYocto},nearRpc);
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
// receipt tree. Wrapped-token refunds deliberately remain unsupported.
export async function verifyNativeRefund(invoice,refundHash,{nearRpc,status},verifySignature=verifyQuoteSignature){
  const relay=await status(invoice.quote),d=relay.swapDetails;
  if(relay.status!=='REFUNDED'||relay.quoteResponse?.signature!==invoice.quote.signature||
    !verifySignature(invoice.quote)||!verifySignature(relay.quoteResponse)||!units(d?.refundedAmount)||
    BigInt(d.refundedAmount)>BigInt(invoice.originAmountYocto)||!d.nearTxHashes?.includes(refundHash))
    throw Error('SIGNED_RELAY_LINKED_REFUND_REQUIRED');
  if((await nearRpc('status',[])).chain_id!=='mainnet')throw Error('WRONG_NEAR_NETWORK');
  const outcome=await nearRpc('EXPERIMENTAL_tx_status',{tx_hash:refundHash,sender_account_id:invoice.quote.quote.depositAddress,wait_until:'FINAL'});
  successful(outcome,refundHash);
  const receipts=new Map((outcome.receipts??[]).map(r=>[r.receipt_id,r]));
  let refunded=0n;const evidence=[],seen=new Set();
  for(const row of outcome.receipts_outcome){
    const receipt=receipts.get(row.id);
    if(!receipt||seen.has(row.id))continue;seen.add(row.id);
    if(receipt.receiver_id!==invoice.sourceAccount||row.outcome.executor_id!==invoice.sourceAccount||
      !Object.hasOwn(row.outcome.status??{},'SuccessValue'))continue;
    for(const action of receipt.receipt?.Action?.actions??[]){
      if(action.Transfer&&units(action.Transfer.deposit)){refunded+=BigInt(action.Transfer.deposit);evidence.push(row.id);}
    }
  }
  if(refunded!==BigInt(d.refundedAmount)||!evidence.length)throw Error('EXACT_REFUND_RECEIPTS_REQUIRED');
  const block=await nearRpc('block',{block_id:outcome.transaction_outcome.block_hash});
  if(block.header.hash!==outcome.transaction_outcome.block_hash||
    Number(BigInt(block.header.timestamp_nanosec)/1000000n)<invoice.quoteBoundAt)throw Error('HISTORICAL_REFUND_REJECTED');
  return {state:'REFUNDED',refundVerified:true,refundHash,amount:String(refunded),receiptIds:evidence,
    receiver:invoice.sourceAccount,scope:'Native NEAR receipt actions. RPC must expose receipt bodies; absent bodies fail closed.'};
}

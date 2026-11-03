import { createHash, createPublicKey, verify } from 'node:crypto';
import { createRequire } from 'node:module';
import { verifyQuoteSignature } from '@defuse-protocol/one-click-sdk-typescript';
import { canonical } from './protocol.mjs';
import { base58 } from './near-deployment.mjs';
import { verifyEvmDelivery, validateDestination } from './intents.mjs';
// The pinned NEAR 1.x packages expose an extensionless legacy ESM build.
const {SignedTransaction,encodeTransaction}=createRequire(import.meta.url)('@near-js/transactions');

// One explicitly approved demonstration. This is separate from the testnet treasury.
export const paymentPolicy = Object.freeze({
  network: 'mainnet', signer: '0cd07d0982767b3b7abed80e489129be51df7300f0b2729a8f28f6eef3200606',
  recipient: '0xa2c191561397c584ddad75388b5519e4931ef026',
  originAsset: 'nep141:wrap.near',
  destinationAsset: 'nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near',
  token: '0xaf88d065e77c8cc2239327c5edb3a432268e5831', chainId: '0xa4b1',
  amount: '500000000000000000000000', maximumExtraNear: '100000000000000000000000',
  maximumUsdMicros: '5000000', quoteLifetimeMs: 120000, slippageBps: 100
});
const positive = s => typeof s === 'string' && /^[1-9]\d{0,77}$/.test(s);
export function usdMicros(s) {
  if (typeof s !== 'string' || !/^(0|[1-9]\d*)(\.\d{1,18})?$/.test(s)) throw Error('INVALID_USD_VALUE');
  const [whole, fraction = ''] = s.split('.');
  return BigInt(whole) * 1000000n + BigInt(fraction.padEnd(6, '0').slice(0, 6)) + (/[1-9]/.test(fraction.slice(6)) ? 1n : 0n);
}
export function quoteRequest(dry, now = Date.now()) {
  return {dry, swapType:'EXACT_INPUT', depositMode:'SIMPLE', slippageTolerance:paymentPolicy.slippageBps,
    originAsset:paymentPolicy.originAsset, destinationAsset:paymentPolicy.destinationAsset,
    depositType:'ORIGIN_CHAIN', amount:paymentPolicy.amount, refundTo:paymentPolicy.signer,
    refundType:'ORIGIN_CHAIN', recipient:paymentPolicy.recipient, recipientType:'DESTINATION_CHAIN',
    deadline:new Date(now + 30 * 60000).toISOString()};
}
export function validateQuote(response, request, now = Date.now(), verifySignature = verifyQuoteSignature) {
  const q = response?.quote;
  const echoed=structuredClone(response?.quoteRequest??{});
  // The public service adds these defaults, including its unauthenticated fee.
  // No arbitrary extra request field is accepted. Output minimum and deposit
  // address remain covered by the official SDK signature.
  for(const [key,value] of Object.entries({confidentiality:'public',quoteWaitingTimeMs:0,insured:false})) {
    if(!Object.hasOwn(request,key)&&Object.hasOwn(echoed,key)){
      if(echoed[key]!==value)throw Error('UNEXPECTED_QUOTE_DEFAULT');
      delete echoed[key];
    }
  }
  if(!Object.hasOwn(request,'appFees')&&Object.hasOwn(echoed,'appFees')){
    if(!Array.isArray(echoed.appFees)||echoed.appFees.length>1)throw Error('UNEXPECTED_SERVICE_FEE');
    for(const fee of echoed.appFees){
      // Executable quotes serialize the optional limit-order reference as
      // null, while dry quotes omit it. A real order reference is not allowed.
      if(Object.hasOwn(fee,'limitOrderId')&&fee.limitOrderId===null)delete fee.limitOrderId;
      if(Object.keys(fee).sort().join()!=='fee,recipient'||!Number.isInteger(fee.fee)||fee.fee<0||fee.fee>25)
        throw Error('UNEXPECTED_SERVICE_FEE');
      validateDestination('near',fee.recipient);
    }
    delete echoed.appFees;
  }
  if (canonical(echoed) !== canonical(request) || verifySignature(response) !== true)
    throw Error('INVALID_SIGNED_QUOTE');
  if (!q || q.amountIn !== paymentPolicy.amount || !positive(q.amountOut) || !positive(q.minAmountOut) ||
      BigInt(q.minAmountOut) > BigInt(q.amountOut) || BigInt(q.minAmountIn) > BigInt(paymentPolicy.amount) ||
      !Number.isFinite(Date.parse(response.timestamp)) || Math.abs(now-Date.parse(response.timestamp)) > 120000)
    throw Error('UNEXPECTED_QUOTE');
  // Reserve the entire allowed 0.1 NEAR for source storage + gas, using the signed valuation.
  if (usdMicros(q.amountInUsd) * 6n > BigInt(paymentPolicy.maximumUsdMicros) * 5n)
    throw Error('TOTAL_USD_BUDGET_EXCEEDED');
  if (request.dry) {
    if (q.depositAddress || q.depositMemo) throw Error('UNEXPECTED_FUNDING_INSTRUCTION');
  } else {
    validateDestination('near', q.depositAddress);
    if (q.depositAddress === paymentPolicy.signer || q.depositMemo ||
        Date.parse(q.deadline) < now+300000 || Date.parse(request.deadline) < now+300000)
      throw Error('UNSUPPORTED_DEPOSIT_INSTRUCTION');
  }
  return response;
}
function requireFresh(journal, now) {
  if (!journal || journal.state !== 'QUOTED' || journal.quote?.quoteRequest?.dry !== false ||
      journal.created + paymentPolicy.quoteLifetimeMs < now) throw Error('FRESH_EXECUTABLE_QUOTE_REQUIRED');
}
export async function preparePayment(journal, nearRpc, now = Date.now()) {
  requireFresh(journal, now);
  if ((await nearRpc('status', [])).chain_id !== 'mainnet') throw Error('WRONG_NEAR_NETWORK');
  const finalBlock = await nearRpc('block', {finality:'final'});
  const blockTime = BigInt(finalBlock.header.timestamp_nanosec) / 1000000n;
  if (blockTime < BigInt(now-120000) || blockTime > BigInt(now+30000)) throw Error('STALE_NEAR_RPC');
  const view = async (method_name,args) => {
    const result = await nearRpc('query',{request_type:'call_function',block_id:finalBlock.header.hash,
      account_id:'wrap.near',method_name,args_base64:Buffer.from(JSON.stringify(args)).toString('base64')});
    if (result.block_hash !== finalBlock.header.hash) throw Error('INCONSISTENT_NEAR_SNAPSHOT');
    return JSON.parse(Buffer.from(result.result).toString());
  };
  const actions=[];
  const minimum = (await view('storage_balance_bounds',{})).min;
  if (!positive(minimum)) throw Error('INVALID_STORAGE_BOUND');
  for (const account_id of [paymentPolicy.signer,journal.quote.quote.depositAddress]) {
    if (!(await view('storage_balance_of',{account_id})))
      actions.push({methodName:'storage_deposit',args:{account_id,registration_only:true},gas:'10000000000000',deposit:minimum});
  }
  actions.push({methodName:'near_deposit',args:{},gas:'30000000000000',deposit:paymentPolicy.amount});
  actions.push({methodName:'ft_transfer',args:{receiver_id:journal.quote.quote.depositAddress,amount:paymentPolicy.amount},
    gas:'30000000000000',deposit:'1'});
  const gas = actions.reduce((n,a)=>n+BigInt(a.gas),0n);
  const deposits = actions.reduce((n,a)=>n+BigInt(a.deposit),0n);
  const gasPrice = BigInt((await nearRpc('gas_price',{block_id:finalBlock.header.hash})).gas_price);
  // Transaction/action overhead and 2x gas-price headroom; unused prepaid gas is refunded.
  const maximumGasCost = (gas+10000000000000n)*gasPrice*2n;
  if (deposits-BigInt(paymentPolicy.amount)+maximumGasCost > BigInt(paymentPolicy.maximumExtraNear))
    throw Error('SOURCE_FEE_BUDGET_EXCEEDED');
  const account=await nearRpc('query',{request_type:'view_account',block_id:finalBlock.header.hash,account_id:paymentPolicy.signer});
  if (account.block_hash !== finalBlock.header.hash) throw Error('INCONSISTENT_NEAR_SNAPSHOT');
  // Retain 0.1 NEAR, plus conservative account-storage collateral at 1e19 yocto/byte.
  const retain = BigInt(account.storage_usage)*10000000000000000000n;
  if (BigInt(account.amount) < deposits+maximumGasCost+retain) throw Error('INSUFFICIENT_AVAILABLE_MAINNET_NEAR');
  return {signerId:paymentPolicy.signer,receiverId:'wrap.near',actions,
    maximumGasCost:String(maximumGasCost),totalAttachedNear:String(deposits),
    snapshot:finalBlock.header.hash,preparedAt:now};
}
// Installed OKX 4.22.2 attempts submission inside signTransaction itself.
// Post-signature validation cannot prevent an extension-side broadcast. Keep
// signing disabled until both parameter fidelity and submission are resolved.
export const walletExecution = Object.freeze({
  signingEnabled:false,
  reason:'WALLET_ACTION_MISMATCH_REQUIRES_REVIEW',
  walletMayBroadcast:true
});
export function inspectSignedPayment(encoded) {
  if (typeof encoded !== 'string' || encoded.length>20000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded))
    throw Error('INVALID_SIGNED_TRANSACTION');
  const bytes=Buffer.from(encoded,'base64'), signed=SignedTransaction.decode(bytes), tx=signed.transaction;
  if (!Buffer.from(signed.encode()).equals(bytes)) throw Error('SIGNED_TRANSACTION_SUBSTITUTED');
  const actual=tx.actions.map(a=>{
    if (!a.functionCall) throw Error('UNEXPECTED_ACTION');
    const f=a.functionCall;
    return {methodName:f.methodName,args:JSON.parse(Buffer.from(f.args).toString()),gas:String(f.gas),deposit:String(f.deposit)};
  });
  const rawKey=tx.publicKey.ed25519Key?.data;
  if (!rawKey || signed.signature.ed25519Signature?.data?.length!==64) throw Error('UNSUPPORTED_SIGNATURE');
  const key=createPublicKey({key:Buffer.concat([Buffer.from('302a300506032b6570032100','hex'),Buffer.from(rawKey)]),format:'der',type:'spki'});
  const digest=createHash('sha256').update(encodeTransaction(tx)).digest();
  if (!verify(null,digest,key,Buffer.from(signed.signature.ed25519Signature.data))) throw Error('INVALID_WALLET_SIGNATURE');
  return {hash:base58(digest),signerId:tx.signerId,receiverId:tx.receiverId,actions:actual};
}
export function validateSignedPayment(encoded, prepared) {
  const observed=inspectSignedPayment(encoded);
  if(observed.signerId!==prepared.signerId||observed.receiverId!==prepared.receiverId)
    throw Error('SIGNED_TRANSACTION_SUBSTITUTED');
  if(canonical(observed.actions)!==canonical(prepared.actions))throw Error('SIGNED_ACTIONS_SUBSTITUTED');
  return {hash:observed.hash,bytes:encoded};
}
function comparableRequest(request) {
  const value=structuredClone(request??{});
  for(const key of ['referral','virtualChainRecipient','virtualChainRefundRecipient'])
    if(value[key]===null)delete value[key];
  for(const [key,defaultValue]of Object.entries({depositMode:'SIMPLE',quoteWaitingTimeMs:0,insured:false}))
    if(value[key]===defaultValue)delete value[key];
  for(const fee of value.appFees??[])if(fee.limitOrderId===null)delete fee.limitOrderId;
  return value;
}
export function verifySavedQuoteStatus(journal,status,verifySignature=verifyQuoteSignature) {
  const saved=journal?.quote,echoed=status?.quoteResponse;
  if(!saved||canonical(comparableRequest(echoed?.quoteRequest))!==canonical(comparableRequest(saved.quoteRequest))||
      canonical(echoed?.quote)!==canonical(saved.quote)||echoed?.timestamp!==saved.timestamp||
      echoed?.signature!==saved.signature||verifySignature(saved)!==true||verifySignature(echoed)!==true)
    throw Error('SWAP_IDENTITY_MISMATCH');
  if(!['KNOWN_DEPOSIT_TX','PENDING_DEPOSIT','INCOMPLETE_DEPOSIT','PROCESSING','SUCCESS','REFUNDED','FAILED'].includes(status.status))
    throw Error('UNKNOWN_RELAY_STATUS');
  return status.status;
}
export async function observePayment(journal,status,nearRpc,now=Date.now(),verifySignature=verifyQuoteSignature) {
  const relayStatus=verifySavedQuoteStatus(journal,status,verifySignature);
  if((await nearRpc('status',[])).chain_id!=='mainnet')throw Error('WRONG_NEAR_NETWORK');
  const block=await nearRpc('block',{finality:'final'});
  const time=BigInt(block.header.timestamp_nanosec)/1000000n;
  if(time<BigInt(now-120000)||time>BigInt(now+30000))throw Error('STALE_NEAR_RPC');
  const account=await nearRpc('query',{request_type:'view_account',block_id:block.header.hash,account_id:paymentPolicy.signer});
  if(account.block_hash!==block.header.hash)throw Error('INCONSISTENT_NEAR_SNAPSHOT');
  return {checkedAt:now,relayStatus,sourceBalanceYocto:String(account.amount),snapshot:block.header.hash,
    sourceTransactionKnown:!!journal.sourceHash,walletResponseHash:journal.walletResponse?.hash??null,
    sourceHash:journal.sourceHash??null,paymentVerified:false,
    scope:'Read-only relay and finalized account observations; neither non-deposit nor refund is proven by these observations.',
    next:journal.sourceHash?'RECONCILE_SAVED_HASH_ONLY':'WALLET_REVIEW_REQUIRED_NO_NEW_SIGNATURE'};
}
export async function verifyOrigin(journal, nearRpc) {
  if (!journal?.sourceHash || !journal.prepared) throw Error('NO_SIGNED_PAYMENT');
  if ((await nearRpc('status',[])).chain_id!=='mainnet') throw Error('WRONG_NEAR_NETWORK');
  const outcome=await nearRpc('tx',{tx_hash:journal.sourceHash,sender_account_id:paymentPolicy.signer,wait_until:'FINAL'});
  if (outcome.final_execution_status!=='FINAL' || outcome.transaction?.hash!==journal.sourceHash ||
      outcome.transaction.signer_id!==paymentPolicy.signer || outcome.transaction.receiver_id!=='wrap.near' ||
      !Object.hasOwn(outcome.status??{},'SuccessValue') || !Array.isArray(outcome.receipts_outcome) ||
      outcome.receipts_outcome.some(r=>Object.hasOwn(r.outcome.status??{},'Failure')))
    throw Error('ORIGIN_NOT_SUCCESSFULLY_FINAL');
  const actual=outcome.transaction.actions.map(a=>{
    const f=a.FunctionCall;if (!f) throw Error('ORIGIN_ACTION_CHANGED');
    return {methodName:f.method_name,args:JSON.parse(Buffer.from(f.args,'base64').toString()),gas:String(f.gas),deposit:String(f.deposit)};
  });
  if (canonical(actual)!==canonical(journal.prepared.actions)) throw Error('ORIGIN_ACTION_CHANGED');
  let amount=0n;
  for (const receipt of outcome.receipts_outcome) {
    if (receipt.outcome.executor_id!=='wrap.near') continue;
    for (const line of receipt.outcome.logs??[]) {
      if (!line.startsWith('EVENT_JSON:')) continue;
      const event=JSON.parse(line.slice(11));
      if (event.standard!=='nep141' || event.event!=='ft_transfer') continue;
      for (const data of event.data??[]) if (data.old_owner_id===paymentPolicy.signer &&
        data.new_owner_id===journal.quote.quote.depositAddress && positive(data.amount)) amount+=BigInt(data.amount);
    }
  }
  if (amount!==BigInt(paymentPolicy.amount)) throw Error('ORIGIN_DEPOSIT_EVENT_MISMATCH');
  return {verified:true,hash:journal.sourceHash,amount:String(amount),receiver:journal.quote.quote.depositAddress};
}
export async function verifyCrossChain(journal, status, evmRpc, verifySignature = verifyQuoteSignature) {
  if (!journal.origin?.verified || journal.state==='VERIFIED') throw Error('ORIGIN_VERIFICATION_REQUIRED');
  const saved=journal.quote;
  verifySavedQuoteStatus(journal,status,verifySignature);
  if (status.status!=='SUCCESS') return {verified:false,status:status.status,next:'WAIT_OR_RECONCILE_NO_REDEPOSIT'};
  const details=status.swapDetails;
  if (!details?.originChainTxHashes?.some(t=>t.hash===journal.sourceHash) ||
      details.amountIn!==paymentPolicy.amount || !positive(details.amountOut) ||
      BigInt(details.amountOut)<BigInt(saved.quote.minAmountOut) ||
      !Array.isArray(details.destinationChainTxHashes) || details.destinationChainTxHashes.length!==1)
    throw Error('UNEXPECTED_SWAP_LINKAGE');
  const delivery=await verifyEvmDelivery({chainId:paymentPolicy.chainId,token:paymentPolicy.token,
    recipient:paymentPolicy.recipient,minimumAmount:details.amountOut,
    hash:details.destinationChainTxHashes[0].hash,notBeforeSeconds:Math.floor(journal.created/1000)},evmRpc);
  return {verified:true,status:'VERIFIED',origin:journal.origin,delivery,
    intentHashes:details.intentHashes,crossChainOriginVerified:true,
    linkageTrust:'Signed 1Click quote and relay transaction mapping; both chain transactions verified via pinned RPC',
    testnetTreasuryLinked:false,automaticTaskPayout:false};
}

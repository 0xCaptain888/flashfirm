import {paymentPolicy, verifySavedQuoteStatus} from './mainnet-payment.mjs';

// 1Click manages wrapping for its NEAR origin-chain deposits. This path uses
// OKX's native sendMoney operation, not its incompatible FunctionCall encoder.
// Keep the original FunctionCall journal and its signing lock unchanged.
export function validateNativeOutcome(outcome, journal) {
  const tx=outcome?.transaction, actions=tx?.actions;
  if(!/^[1-9A-HJ-NP-Za-km-z]{40,44}$/.test(journal.sourceHash??'') ||
      outcome?.final_execution_status!=='FINAL' ||
      !Object.hasOwn(outcome.status??{},'SuccessValue') ||
      tx?.hash!==journal.sourceHash || tx?.signer_id!==paymentPolicy.signer ||
      tx?.receiver_id!==journal.quote?.quote?.depositAddress ||
      !Array.isArray(actions) || actions.length!==1 ||
      Object.keys(actions[0]).join()!=='Transfer' ||
      actions[0].Transfer?.deposit!==paymentPolicy.amount ||
      !Array.isArray(outcome.receipts_outcome) ||
      outcome.receipts_outcome.some(r=>Object.hasOwn(r.outcome?.status??{},'Failure')))
    throw Error('NATIVE_DEPOSIT_NOT_SUCCESSFULLY_FINAL');
  const costs=[outcome.transaction_outcome,...outcome.receipts_outcome];
  if(costs.some(r=>!/^(0|[1-9]\d{0,77})$/.test(r?.outcome?.tokens_burnt??'')))
    throw Error('INVALID_SOURCE_FEE_EVIDENCE');
  const fee=costs.reduce((total,r)=>total+BigInt(r.outcome.tokens_burnt),0n);
  if(fee>BigInt(paymentPolicy.maximumExtraNear))throw Error('SOURCE_FEE_BUDGET_EXCEEDED');
  return {verified:true,hash:journal.sourceHash,amount:paymentPolicy.amount,
    receiver:tx.receiver_id,asset:'native NEAR',sourceFeeYocto:String(fee),
    scope:'Finalized exact native NEAR deposit; managed wrapping belongs to 1Click'};
}

export async function nativePreflight(journal, rpc, now=Date.now()) {
  if(journal.sourceHash || journal.handoffAt)throw Error('PAYMENT_ALREADY_HANDED_TO_WALLET');
  if((await rpc('status',[])).chain_id!=='mainnet')throw Error('WRONG_NEAR_NETWORK');
  const deadlines=[journal.quote?.quoteRequest?.deadline,journal.quote?.quote?.deadline].map(Date.parse);
  if(deadlines.some(d=>!Number.isFinite(d)||d<now+120000))throw Error('QUOTE_EXPIRED_NO_DEPOSIT');
  const block=await rpc('block',{finality:'final'});
  const time=Number(BigInt(block.header.timestamp_nanosec)/1000000n);
  if(time<now-120000||time>now+30000)throw Error('STALE_NEAR_RPC');
  const params={request_type:'view_account',account_id:paymentPolicy.signer,block_id:block.header.hash};
  const account=await rpc('query',params);
  if(account.block_hash!==block.header.hash)throw Error('INCONSISTENT_NEAR_SNAPSHOT');
  const reserve=BigInt(account.storage_usage)*10000000000000000000n;
  if(BigInt(account.amount)<BigInt(paymentPolicy.amount)+BigInt(paymentPolicy.maximumExtraNear)+reserve)
    throw Error('INSUFFICIENT_AVAILABLE_MAINNET_NEAR');
  return {checkedAt:now,block:block.header.hash,balanceYocto:account.amount,
    receiverId:journal.quote.quote.depositAddress,amount:paymentPolicy.amount,
    source:paymentPolicy.signer,method:'sendMoney',maximumExtraNear:paymentPolicy.maximumExtraNear};
}

export function assertUnfundedOriginal(original, status) {
  verifySavedQuoteStatus(original,status);
  const details=status.swapDetails;
  if(original.sourceHash || original.walletResponse?.hash ||
      status.status!=='PENDING_DEPOSIT' ||
      details?.depositedAmount!=null || details?.originChainTxHashes?.length ||
      details?.destinationChainTxHashes?.length)
    throw Error('ORIGINAL_PAYMENT_REQUIRES_RECONCILIATION');
}

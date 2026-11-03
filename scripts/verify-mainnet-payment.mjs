import {readFile,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {canonical} from '../src/protocol.mjs';
import {paymentPolicy,quoteRequest,validateQuote,verifySavedQuoteStatus,verifyCrossChain} from '../src/mainnet-payment.mjs';
import {validateNativeOutcome} from '../src/native-payment.mjs';
import {readBounded} from '../src/live.mjs';

const root=new URL('../',import.meta.url);
const publicFile=new URL('evidence/mainnet-native-payment.json',root);
const nearEndpoint='https://rpc.mainnet.near.org';
const arbEndpoint='https://arb1.arbitrum.io/rpc';
async function remote(url,body){
  const response=await fetch(url,{method:body?'POST':'GET',redirect:'error',
    signal:AbortSignal.timeout(25000),headers:{'Content-Type':'application/json'},
    ...(body?{body:JSON.stringify(body)}:{})});
  if(!response.ok)throw Error('PUBLIC_RPC_UNAVAILABLE');
  return JSON.parse(await readBounded(response,2000000));
}
function rpc(endpoint,allowed){
  return async(method,params)=>{
    if(!allowed.includes(method))throw Error('READ_ONLY_RPC_REQUIRED');
    const r=await remote(endpoint,{jsonrpc:'2.0',id:1,method,params});
    if(r.error||r.id!==1||r.result==null)throw Error('PUBLIC_RPC_UNAVAILABLE');
    return r.result;
  };
}
function recordedEvmRpc(snapshot){
  return async(method,params)=>{
    if(method==='eth_chainId')return snapshot.chainId;
    if(method==='eth_getTransactionReceipt'&&params[0]===snapshot.receipt.transactionHash)return snapshot.receipt;
    if(method==='eth_getBlockByNumber'&&params[0]==='finalized')return snapshot.finalized;
    if(method==='eth_getBlockByNumber'&&params[0]===snapshot.receipt.blockNumber)return snapshot.block;
    throw Error('UNEXPECTED_EVIDENCE_LOOKUP');
  };
}
export async function verifyMainnetEvidence(proof,{nearRpc,evmRpc,status}={}){
  if(proof?.version!=='flashfirm-mainnet-native/1'||
      canonical(proof.policy)!==canonical(paymentPolicy)||
      !Number.isFinite(Date.parse(proof.checkedAt))||
      !Number.isSafeInteger(proof.created)||proof.created<=0||
      proof.sourceNetwork?.chain_id!=='mainnet')
    throw Error('INVALID_MAINNET_EVIDENCE');
  const quote=proof.quote,issued=Date.parse(quote?.quoteRequest?.deadline)-30*60000;
  validateQuote(quote,quoteRequest(false,issued),Date.parse(quote.timestamp));
  if(Math.abs(proof.created-Date.parse(quote.timestamp))>120000)
    throw Error('ORDER_TIME_MISMATCH');
  const journal={created:proof.created,quote,sourceHash:proof.sourceHash,state:'SOURCE_SUBMITTED'};
  if(nearRpc){
    if((await nearRpc('status',[])).chain_id!=='mainnet')throw Error('WRONG_NEAR_NETWORK');
    journal.origin=validateNativeOutcome(await nearRpc('tx',{
      tx_hash:proof.sourceHash,sender_account_id:paymentPolicy.signer,wait_until:'FINAL'
    }),journal);
  }else journal.origin=validateNativeOutcome(proof.sourceOutcome,journal);
  const relay=status??proof.relay;
  verifySavedQuoteStatus(journal,relay);
  const result=await verifyCrossChain(journal,relay,evmRpc??recordedEvmRpc(proof.destinationSnapshot));
  if(!result.verified)throw Error('CROSS_CHAIN_NOT_COMPLETE');
  return {...result,capturedAt:proof.checkedAt,
    checkedAt:nearRpc&&evmRpc?new Date().toISOString():proof.checkedAt,
    verificationMode:nearRpc&&evmRpc?'LIVE_PINNED_RPC':'RECORDED_RPC_SNAPSHOTS',
    sourceNetwork:'NEAR mainnet',destinationNetwork:'Arbitrum One',
    chainProofBoundary:'Source/destination RPC snapshots are observations, not light-client proofs. Signed 1Click quote and relay mapping bind this demonstration.',
    fundsMoved:true};
}
async function main(){
  if(process.env.FLASHFIRM_USE_SYSTEM_PROXY==='1'){
    const {ProxyAgent,setGlobalDispatcher}=await import('../cloudflare/node_modules/undici/index.js');
    setGlobalDispatcher(new ProxyAgent('http://127.0.0.1:7897'));
  }
  const near=rpc(nearEndpoint,['status','tx']);
  const arb=rpc(arbEndpoint,['eth_chainId','eth_getTransactionReceipt','eth_getBlockByNumber']);
  if(process.argv.includes('--capture')){
    const j=JSON.parse(await readFile(new URL('.runtime/mainnet-payment/native-journal.json',root),'utf8'));
    if(!j.sourceHash)throw Error('SAVED_SOURCE_HASH_REQUIRED_NO_NEW_PAYMENT');
    const relay=await remote('https://1click.chaindefuser.com/v0/status?'+new URLSearchParams({depositAddress:j.quote.quote.depositAddress}));
    verifySavedQuoteStatus(j,relay);
    if(relay.status!=='SUCCESS')throw Error('RELAY_NOT_SUCCESS_NO_REDEPOSIT');
    const sourceNetwork=await near('status',[]);
    const sourceObservation=await near('tx',{tx_hash:j.sourceHash,sender_account_id:paymentPolicy.signer,wait_until:'FINAL'});
    const tx=sourceObservation.transaction;
    // Keep the exact public execution/action evidence, without copying a
    // wallet signature or a re-broadcastable signed transaction.
    const sourceOutcome={final_execution_status:sourceObservation.final_execution_status,
      status:sourceObservation.status,
      transaction:{hash:tx.hash,signer_id:tx.signer_id,receiver_id:tx.receiver_id,actions:tx.actions},
      transaction_outcome:sourceObservation.transaction_outcome,
      receipts_outcome:sourceObservation.receipts_outcome};
    const hash=relay.swapDetails?.destinationChainTxHashes?.[0]?.hash;
    const chainId=await arb('eth_chainId',[]);
    const receipt=await arb('eth_getTransactionReceipt',[hash]);
    if(!receipt)throw Error('DESTINATION_RECEIPT_REQUIRED');
    const finalized=await arb('eth_getBlockByNumber',['finalized',false]);
    const block=await arb('eth_getBlockByNumber',[receipt.blockNumber,false]);
    // Explicit public allowlist: no browser sessions, tokens, keys or private
    // operator journal are exported. All included transaction data is public.
    const proof={version:'flashfirm-mainnet-native/1',checkedAt:new Date().toISOString(),
      created:j.created,policy:paymentPolicy,quote:j.quote,sourceHash:j.sourceHash,
      sourceNetwork:{chain_id:sourceNetwork.chain_id},sourceOutcome,relay,
      destinationSnapshot:{chainId,receipt,finalized,block}};
    let result;
    try{result=await verifyMainnetEvidence(proof);}
    catch(error){
      if(error.message!=='DESTINATION_NOT_FINAL')throw error;
      console.log(JSON.stringify({status:'AWAITING_DESTINATION_FINALITY',
        checkedAt:proof.checkedAt,relayStatus:relay.status,sourceHash:j.sourceHash,
        destinationHash:hash,receiptBlock:receipt.blockNumber,finalizedBlock:finalized.number,
        finalizedBlockTime:new Date(Number(BigInt(finalized.timestamp))*1000).toISOString(),
        noNewPayment:true},null,2));
      process.exitCode=1;return;
    }
    await writeFile(publicFile,JSON.stringify(proof,null,2)+'\n');
    console.log(JSON.stringify({status:'MAINNET_EVIDENCE_CAPTURED',...result},null,2));
    return;
  }
  const proof=JSON.parse(await readFile(publicFile,'utf8'));
  const online=process.argv.includes('--online');
  const status=online?await remote('https://1click.chaindefuser.com/v0/status?'+new URLSearchParams({depositAddress:proof.quote.quote.depositAddress})):undefined;
  const result=await verifyMainnetEvidence(proof,online?{nearRpc:near,evmRpc:arb,status}:{});
  console.log(JSON.stringify(result,null,2));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  main().catch(e=>{console.error(e.message);process.exitCode=1;});
}

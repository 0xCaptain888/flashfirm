import http from 'node:http';
import {randomBytes} from 'node:crypto';
import {readFile,writeFile,rename,open,unlink} from 'node:fs/promises';
import {readBounded} from '../src/live.mjs';
import {canonical} from '../src/protocol.mjs';
import {paymentPolicy,quoteRequest,validateQuote,verifySavedQuoteStatus,verifyCrossChain} from '../src/mainnet-payment.mjs';
import {nativePreflight,validateNativeOutcome,assertUnfundedOriginal} from '../src/native-payment.mjs';
import {nativePaymentPreview} from '../src/payment-preview.mjs';

if(process.env.FLASHFIRM_USE_SYSTEM_PROXY==='1'){
  const {ProxyAgent,setGlobalDispatcher}=await import('../cloudflare/node_modules/undici/index.js');
  setGlobalDispatcher(new ProxyAgent('http://127.0.0.1:7897'));
}
const root=new URL('../.runtime/mainnet-payment/',import.meta.url);
const original=JSON.parse(await readFile(new URL('journal.json',root),'utf8'));
if(canonical(original.policy)!==canonical(paymentPolicy))throw Error('SAVED_PAYMENT_POLICY_CHANGED');
const lock=await open(new URL('native-console.lock',root),'wx',0o600);
await lock.writeFile(String(process.pid));
const file=new URL('native-journal.json',root);
let journal=null,preview=null;
try{journal=JSON.parse(await readFile(file,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
if(journal&&canonical(journal.policy)!==canonical(paymentPolicy))throw Error('SAVED_PAYMENT_POLICY_CHANGED');
async function save(){
  await writeFile(new URL('native-journal.tmp',root),JSON.stringify(journal,null,2),{mode:0o600});
  await rename(new URL('native-journal.tmp',root),file);
}
async function remote(url,body){
  const r=await fetch(url,{method:body?'POST':'GET',redirect:'error',signal:AbortSignal.timeout(25000),
    headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
  if(!r.ok)throw Error('REMOTE_CHECK_UNAVAILABLE');
  return JSON.parse(await readBounded(r,2000000));
}
const rpc=(url,allowed)=>async(method,params)=>{
  if(!allowed.includes(method))throw Error('RPC_METHOD_DENIED');
  const r=await remote(url,{jsonrpc:'2.0',id:1,method,params});
  if(r.error||r.id!==1||r.jsonrpc!=='2.0'||r.result==null)throw Error('RPC_RESULT_UNAVAILABLE');
  return r.result;
};
const near=rpc('https://rpc.mainnet.near.org',['status','block','query','tx']);
const arb=rpc('https://arb1.arbitrum.io/rpc',['eth_chainId','eth_getTransactionReceipt','eth_getBlockByNumber']);
const status=q=>remote('https://1click.chaindefuser.com/v0/status?'+new URLSearchParams({depositAddress:q.quote.depositAddress}));
async function checkOriginal(){
  const current=JSON.parse(await readFile(new URL('journal.json',root),'utf8'));
  if(canonical(current.quote)!==canonical(original.quote))throw Error('ORIGINAL_ORDER_CHANGED');
  const result=await status(original.quote);
  assertUnfundedOriginal(current,result);
  return {checkedAt:Date.now(),state:result.status,originalSourceHash:current.sourceHash??null,
    originalDeposit:original.quote.quote.depositAddress,
    scope:'Original signed-order relay check; independent account history was separately inspected by the operator'};
}
const port=43187,origin=`http://127.0.0.1:${port}`,csrf=randomBytes(32).toString('hex');
const state=()=>({policy:paymentPolicy,journal,preview,taskTreasuryLinked:false,serverCanBroadcast:false,
 manualPreview:journal?.state==='WALLET_HANDOFF'&&journal.prepared?nativePaymentPreview({
  source:journal.prepared.source,receiver:journal.prepared.receiverId,amountYocto:journal.prepared.amount,
  maximumFeeYocto:journal.prepared.maximumExtraNear,minimumUsdcUnits:journal.quote.quote.minAmountOut,
  recipient:paymentPolicy.recipient,deadline:journal.quote.quote.deadline}):null});
const send=(res,status,body)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(body));};
let queue=Promise.resolve();
const server=http.createServer(async(req,res)=>{
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Content-Type-Options','nosniff');
  try{
    if(req.headers.host!==`127.0.0.1:${port}` || (req.headers.origin&&req.headers.origin!==origin))
      return send(res,403,{error:'ORIGIN_DENIED'});
    const path=new URL(req.url,origin).pathname;
    if(req.method==='GET'&&path==='/api/session')return send(res,200,{csrf,...state()});
    if(req.method==='GET'&&path==='/api/state')return send(res,200,state());
    const files={'/':['native-payment.html','text/html'],'/native-payment.js':['native-payment.js','text/javascript'],
      '/style.css':['style.css','text/css'],'/operations.css':['operations.css','text/css'],'/favicon.svg':['favicon.svg','image/svg+xml']};
    if(req.method==='GET'&&files[path]){
      const [f,t]=files[path];res.writeHead(200,{'Content-Type':t,'Cache-Control':'no-cache'});
      return res.end(await readFile(new URL('../web/'+f,import.meta.url)));
    }
    if(req.method!=='POST'||req.headers['x-flashfirm-csrf']!==csrf)return send(res,403,{error:'LOCAL_SESSION_REQUIRED'});
    let text='';for await(const p of req){text+=p;if(Buffer.byteLength(text)>20000)throw Error('REQUEST_TOO_LARGE');}
    const input=JSON.parse(text||'{}');
    const operation=async()=>{
      if(path==='/api/preview'){
        if(journal)throw Error('SAVED_ORDER_EXISTS');
        const originalCheck=await checkOriginal(),request=quoteRequest(true);
        preview={created:Date.now(),originalCheck,response:validateQuote(await remote('https://1click.chaindefuser.com/v0/quote',request),request)};
        return state();
      }
      if(path==='/api/reserve'){
        if(journal||input.approval!=='NATIVE_NEAR_TO_ARBITRUM_USDC_MAX_5_USD'||
          !preview||Date.now()-preview.created>120000)throw Error('FRESH_PREVIEW_AND_APPROVAL_REQUIRED');
        const originalCheck=await checkOriginal(),request=quoteRequest(false);
        const response=await remote('https://1click.chaindefuser.com/v0/quote',request);
        // Preserve even an invalid response, rather than creating replacements.
        journal={version:1,policy:paymentPolicy,created:Date.now(),state:'RECEIVED_QUOTE',
          originalCheck,quote:response,sourceHash:null,method:'native NEAR via OKX sendMoney'};
        await save();
        validateQuote(response,request);
        if(BigInt(response.quote.minAmountOut)<BigInt(preview.response.quote.minAmountOut))throw Error('QUOTE_WORSENED_REVIEW_REQUIRED');
        journal.state='QUOTED';await save();return state();
      }
      if(path==='/api/prepare'){
        if(journal?.state!=='QUOTED')throw Error('QUOTED_ORDER_REQUIRED');
        await checkOriginal();
        const request=quoteRequest(true);
        const fresh=validateQuote(await remote('https://1click.chaindefuser.com/v0/quote',request),request);
        journal.freshValuation={checkedAt:Date.now(),quote:fresh};
        journal.prepared=await nativePreflight(journal,near);
        journal.state='PREPARED';await save();return state();
      }
      if(path==='/api/accept-quote'){
        if(journal?.state!=='RECEIVED_QUOTE' ||
          input.approval!=='NATIVE_NEAR_TO_ARBITRUM_USDC_MAX_5_USD' ||
          input.minimumAmount!==journal.quote?.quote?.minAmountOut)
          throw Error('EXACT_UPDATED_QUOTE_REVIEW_REQUIRED');
        const issued=Date.parse(journal.quote.quoteRequest.deadline)-30*60000;
        validateQuote(journal.quote,quoteRequest(false,issued),Date.parse(journal.quote.timestamp));
        await checkOriginal();
        await nativePreflight(journal,near);
        journal.updatedOutputAcceptedAt=Date.now();
        journal.state='QUOTED';await save();return state();
      }
      if(path==='/api/begin'){
        throw Error('UNPARSED_WALLET_PREVIEW_BLOCKED_USE_NATIVE_SEND_SCREEN');
      }
      if(path==='/api/manual-start'){
        if(journal?.state!=='PREPARED'||journal.handoffAt||input.account!==paymentPolicy.signer||
          input.approval!=='NATIVE_NEAR_TO_ARBITRUM_USDC_MAX_5_USD')throw Error('APPROVED_NATIVE_PAYMENT_REQUIRED');
        if(Date.now()-journal.prepared.checkedAt>90000)throw Error('PREPARATION_EXPIRED');
        await checkOriginal();
        const request=quoteRequest(true);
        validateQuote(await remote('https://1click.chaindefuser.com/v0/quote',request),request);
        const prepared=await nativePreflight(journal,near);
        journal.handoffAt=Date.now();journal.state='WALLET_HANDOFF';await save();
        return {preview:nativePaymentPreview({source:prepared.source,receiver:prepared.receiverId,amountYocto:prepared.amount,
          maximumFeeYocto:prepared.maximumExtraNear,minimumUsdcUnits:journal.quote.quote.minAmountOut,
          recipient:paymentPolicy.recipient,deadline:journal.quote.quote.deadline})};
      }
      if(path==='/api/record'){
        if(journal?.state!=='WALLET_HANDOFF'||journal.sourceHash||
          !/^[1-9A-HJ-NP-Za-km-z]{40,44}$/.test(input.hash??''))throw Error('SINGLE_WALLET_RESULT_REQUIRED');
        journal.sourceHash=input.hash;journal.state='SOURCE_SUBMITTED';await save();return state();
      }
      if(path==='/api/check'){
        if(!journal)throw Error('SAVED_ORDER_REQUIRED');
        const result=await status(journal.quote);
        verifySavedQuoteStatus(journal,result);
        journal.lastStatus=result;journal.lastChecked=Date.now();
        if(journal.sourceHash){
          const outcome=await near('tx',{tx_hash:journal.sourceHash,sender_account_id:paymentPolicy.signer,wait_until:'FINAL'});
          journal.origin=validateNativeOutcome(outcome,journal);
          try{
            // A repeat read must query the destination again, without creating
            // a new order or consuming this payment as another task's payout.
            const verified=await verifyCrossChain({...journal,state:'RECONCILING'},result,arb);
            if(verified.verified){journal.state='VERIFIED';journal.evidence=verified;delete journal.pendingReason;}
            else{journal.state='RECONCILING';delete journal.evidence;}
          }catch(error){
            // Persist the successful source and relay observations while
            // waiting for rollup finality. Never treat SUCCESS as finality.
            if(error.message!=='DESTINATION_NOT_FINAL')throw error;
            journal.state='AWAITING_DESTINATION_FINALITY';
            delete journal.evidence;
            journal.pendingReason=error.message;
          }
        }
        await save();return state();
      }
      throw Error('UNKNOWN_OPERATION');
    };
    const next=queue.then(operation);queue=next.catch(()=>{});
    send(res,200,await next);
  }catch(error){send(res,400,{error:/^[A-Z0-9_]+$/.test(error.message)?error.message:'CHECK_UNAVAILABLE_NO_RETRY'});}
});
server.requestTimeout=30000;server.headersTimeout=15000;
server.listen(port,'127.0.0.1',()=>console.log(JSON.stringify({status:'READY',url:origin,serverCanBroadcast:false,privateKeysLoaded:false})));
async function close(){server.close();await lock.close();await unlink(new URL('native-console.lock',root));process.exit(0);}
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,close);

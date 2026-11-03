import http from 'node:http';
import {randomBytes} from 'node:crypto';
import {mkdir,open,readFile,rename,writeFile,unlink} from 'node:fs/promises';
import {readBounded} from '../src/live.mjs';
import {canonical} from '../src/protocol.mjs';
import {paymentPolicy,quoteRequest,validateQuote,preparePayment,validateSignedPayment,verifyOrigin,verifyCrossChain} from '../src/mainnet-payment.mjs';

if(process.env.FLASHFIRM_USE_SYSTEM_PROXY==='1'){
  const {ProxyAgent,setGlobalDispatcher}=await import('../cloudflare/node_modules/undici/index.js');
  setGlobalDispatcher(new ProxyAgent('http://127.0.0.1:7897'));
}
const directory=new URL('../.runtime/mainnet-payment/',import.meta.url);
await mkdir(directory,{recursive:true,mode:0o700});
const lock=await open(new URL('console.lock',directory),'wx',0o600);
await lock.writeFile(String(process.pid));
const filename=new URL('journal.json',directory);
let journal=null,preview=null;
try{journal=JSON.parse(await readFile(filename,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
if(journal&&canonical(journal.policy)!==canonical(paymentPolicy))throw Error('SAVED_PAYMENT_POLICY_CHANGED');
async function save(){await writeFile(new URL('journal.tmp',directory),JSON.stringify(journal,null,2),{mode:0o600});await rename(new URL('journal.tmp',directory),filename);}
async function remote(url,body) {
  const response=await fetch(url,{method:body?'POST':'GET',redirect:'error',signal:AbortSignal.timeout(25000),
    headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
  return JSON.parse(await readBounded(response,2000000));
}
function rpc(endpoint,allowed){return async(method,params)=>{
  if(!allowed.includes(method))throw Error('RPC_METHOD_DENIED');
  const value=await remote(endpoint,{jsonrpc:'2.0',id:1,method,params});
  if(value.id!==1||value.jsonrpc!=='2.0'||value.error||value.result==null)throw Error('RPC_RESULT_UNAVAILABLE');
  return value.result;
};}
const nearRpc=rpc('https://rpc.mainnet.near.org',['status','block','query','gas_price','tx','broadcast_tx_commit']);
const evmRpc=rpc('https://arb1.arbitrum.io/rpc',['eth_chainId','eth_getTransactionReceipt','eth_getBlockByNumber']);
const csrf=randomBytes(32).toString('hex'),port=43186,origin=`http://127.0.0.1:${port}`;
const publicState=()=>({policy:paymentPolicy,journal,preview,
  financialBroadcastByServer:!!journal?.sourceHash,taskTreasuryLinked:false});
const send=(res,code,value)=>{res.writeHead(code,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
let queue=Promise.resolve();
const server=http.createServer(async(req,res)=>{
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
  try{
    if(req.headers.host!==`127.0.0.1:${port}`||(req.headers.origin&&req.headers.origin!==origin))return send(res,403,{error:'ORIGIN_DENIED'});
    const url=new URL(req.url,origin);
    if(req.method==='GET'&&url.pathname==='/api/session')return send(res,200,{csrf,...publicState()});
    if(req.method==='GET'&&url.pathname==='/api/state')return send(res,200,publicState());
    const files={'/':['mainnet.html','text/html'],'/mainnet.js':['mainnet.js','text/javascript'],
      '/style.css':['style.css','text/css'],'/operations.css':['operations.css','text/css'],'/favicon.svg':['favicon.svg','image/svg+xml']};
    if(req.method==='GET'&&files[url.pathname]){
      const [file,type]=files[url.pathname];res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-cache'});
      return res.end(await readFile(new URL('../web/'+file,import.meta.url)));
    }
    if(req.method!=='POST'||req.headers['x-flashfirm-csrf']!==csrf)return send(res,403,{error:'LOCAL_SESSION_REQUIRED'});
    let text='';for await(const part of req){text+=part;if(Buffer.byteLength(text)>50000)throw Error('REQUEST_TOO_LARGE');}
    const input=JSON.parse(text||'{}');
    const operation=async()=>{
      if(url.pathname==='/api/preview'){
        if(journal)throw Error('PAYMENT_ALREADY_EXISTS_RECONCILE_BEFORE_ANY_NEW_PAYMENT');
        const request=quoteRequest(true),result=validateQuote(await remote('https://1click.chaindefuser.com/v0/quote',request),request);
        preview={created:Date.now(),result};return publicState();
      }
      if(url.pathname==='/api/issue'){
        if(journal)throw Error('ONE_PAYMENT_ONLY');
        if(input.approval!=='NEAR_TO_ARBITRUM_USDC_MAX_5_USD'||!preview||Date.now()-preview.created>120000)throw Error('FRESH_PREVIEW_AND_EXPLICIT_APPROVAL_REQUIRED');
        const request=quoteRequest(false),result=validateQuote(await remote('https://1click.chaindefuser.com/v0/quote',request),request);
        if(BigInt(result.quote.minAmountOut)<BigInt(preview.result.quote.minAmountOut))throw Error('QUOTE_WORSENED_REFRESH_AND_REVIEW');
        journal={version:1,policy:paymentPolicy,state:'QUOTED',created:Date.now(),quote:result,sourceHash:null};
        await save();return publicState();
      }
      if(url.pathname==='/api/prepare'){
        if(!journal||journal.state!=='QUOTED')throw Error('PAYMENT_NOT_QUOTED');
        journal.prepared=await preparePayment(journal,nearRpc);journal.state='PREPARED';await save();return publicState();
      }
      if(url.pathname==='/api/begin'){
        if(journal?.state!=='PREPARED'||Date.now()-journal.prepared.preparedAt>120000||input.account!==paymentPolicy.signer)
          throw Error('FRESH_PREPARATION_AND_EXACT_WALLET_REQUIRED');
        journal.state='AWAITING_SIGNATURE';await save();return {transaction:journal.prepared};
      }
      if(url.pathname==='/api/broadcast'){
        if(journal?.state!=='AWAITING_SIGNATURE'||journal.sourceHash)throw Error('NO_REPEAT_BROADCAST');
        if(Date.now()-journal.prepared.preparedAt>600000||Date.parse(journal.quote.quote.deadline)<Date.now()+60000)
          throw Error('SIGNATURE_WINDOW_EXPIRED_DO_NOT_BROADCAST');
        const signed=validateSignedPayment(input.signedTransaction,journal.prepared);
        // Revalue after the wallet returns, before committing a broadcast intent.
        const freshRequest=quoteRequest(true);
        validateQuote(await remote('https://1click.chaindefuser.com/v0/quote',freshRequest),freshRequest);
        const gasPrice=BigInt((await nearRpc('gas_price',{block_id:null})).gas_price);
        const gas=journal.prepared.actions.reduce((n,a)=>n+BigInt(a.gas),10000000000000n);
        const attached=journal.prepared.actions.reduce((n,a)=>n+BigInt(a.deposit),0n);
        if(attached-BigInt(paymentPolicy.amount)+gas*gasPrice*2n>BigInt(paymentPolicy.maximumExtraNear))
          throw Error('SOURCE_FEE_BUDGET_EXCEEDED');
        // Write the deterministic hash BEFORE sending. A timeout cannot trigger a fresh deposit.
        journal.sourceHash=signed.hash;journal.state='BROADCAST_UNKNOWN';await save();
        try{await nearRpc('broadcast_tx_commit',[signed.bytes]);}catch{throw Error('BROADCAST_RESULT_UNKNOWN_RECONCILE_SAVED_HASH_ONLY');}
        journal.state='SOURCE_SUBMITTED';await save();return publicState();
      }
      if(url.pathname==='/api/reconcile'){
        if(!journal?.sourceHash)throw Error('NO_BROADCAST_TO_RECONCILE');
        if(journal.state==='VERIFIED')return publicState();
        journal.origin=await verifyOrigin(journal,nearRpc);await save();
        const status=await remote('https://1click.chaindefuser.com/v0/status?'+new URLSearchParams({depositAddress:journal.quote.quote.depositAddress}));
        const result=await verifyCrossChain(journal,status,evmRpc);
        journal.lastChecked=Date.now();journal.relayState=result.status;
        if(result.verified){journal.evidence=result;journal.state='VERIFIED';}
        else journal.state='RECONCILING';
        await save();return publicState();
      }
      throw Error('UNKNOWN_OPERATION');
    };
    const next=queue.then(operation);queue=next.catch(()=>{});
    return send(res,200,await next);
  }catch(error){return send(res,400,{error:/^[A-Z0-9_]+$/.test(error.message)?error.message:'CHECK_FAILED_NO_AUTOMATIC_RETRY'});}
});
server.requestTimeout=30000;server.headersTimeout=15000;
server.listen(port,'127.0.0.1',()=>console.log(JSON.stringify({status:'READY',url:origin,capUsd:5,sourceAmountNear:'0.5',privateKeysLoaded:false})));
async function close(){server.close();await lock.close();await unlink(new URL('console.lock',directory));process.exit(0);}
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,close);

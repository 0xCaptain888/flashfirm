import http from 'node:http';
import {randomBytes,createPublicKey} from 'node:crypto';
import {readFile,writeFile,stat,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {identity,hash,seal} from './protocol.mjs';
import {blankReview,validateReviewPackage,signHumanReview} from './review-package.mjs';

// This runs on the actual reviewer's own machine, never on the public API.
// No remote requests, wallet keys, identity certificates or prefilled judgments.
export async function startReviewerConsole({directory,port=0}){
 await mkdir(directory,{recursive:true,mode:0o700});
 const keyFile=path.join(directory,'reviewer-key.json');
 let key=null,pkg=null,session=null,queue=Promise.resolve();
 try{
  const info=await stat(keyFile);
  if(!info.isFile()||(info.mode&0o077))throw Error('PRIVATE_REVIEWER_KEY_PERMISSIONS_REQUIRED');
  key=JSON.parse(await readFile(keyFile,'utf8'));
  if(createPublicKey(key.privateKey).export({type:'spki',format:'pem'})!==key.publicKey)
   throw Error('REVIEWER_KEY_MISMATCH');
 }catch(e){if(e.code!=='ENOENT')throw e;}
 const publicState=()=>({publicKey:key?.publicKey??null,keyFingerprint:key?hash(key.publicKey):null,
  packageLoaded:!!pkg,planHash:pkg?hash(pkg.plan):null,independenceCertified:false,
  walletAccess:false,remoteRequests:0});
 const csrf=randomBytes(32).toString('hex');
 const send=(res,status,body)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(body));};
 const files={'/':['reviewer.html','text/html'],'/reviewer.js':['reviewer.js','text/javascript'],
  '/style.css':['style.css','text/css'],'/operations.css':['operations.css','text/css'],'/favicon.svg':['favicon.svg','image/svg+xml']};
 const server=http.createServer(async(req,res)=>{
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
  try{
   if(req.headers.host!==new URL(session).host||(req.headers.origin&&req.headers.origin!==session)||
     req.headers['sec-fetch-site']==='cross-site')return send(res,403,{error:'LOCAL_ORIGIN_REQUIRED'});
   const route=new URL(req.url,session).pathname;
   if(req.method==='GET'&&route==='/api/session')return send(res,200,{csrf,...publicState()});
   if(req.method==='GET'&&files[route]){
    const [name,type]=files[route];res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-store'});
    return res.end(await readFile(new URL('../web/'+name,import.meta.url)));
   }
   if(req.method!=='POST'||req.headers.origin!==session||req.headers['x-flashfirm-csrf']!==csrf||
     req.headers['content-type']!=='application/json')return send(res,403,{error:'LOCAL_SESSION_REQUIRED'});
   const parts=[];let size=0;
   for await(const part of req){size+=part.length;if(size>1500000)throw Error('REQUEST_TOO_LARGE');parts.push(part);}
   const input=JSON.parse(Buffer.concat(parts).toString()||'{}');
   const operation=async()=>{
    if(route==='/api/key'){
     if(key||input.confirm!=='CREATE_MY_OWN_OFFCHAIN_REVIEW_KEY')throw Error('EXPLICIT_LOCAL_KEY_CREATION_REQUIRED');
     const generated=identity();
     await writeFile(keyFile,JSON.stringify(generated),{flag:'wx',mode:0o600});key=generated;
     return publicState();
    }
    if(route==='/api/load'){
     if(!key)throw Error('CREATE_OWN_KEY_BEFORE_ENROLLMENT');
     validateReviewPackage(input.package);
     if(input.expectedPlanHash!==hash(input.package.plan)||input.expectedBuyerFingerprint!==hash(input.package.plan.payload.buyerKey))
      throw Error('OUT_OF_BAND_PLAN_AND_BUYER_CONFIRMATION_REQUIRED');
     const draft=blankReview(input.package,key.publicKey);
     pkg=structuredClone(input.package);
     return {...publicState(),package:pkg,draft};
    }
    if(route==='/api/sign'){
     if(!pkg||input.confirm!=='I_COMPLETED_THIS_REVIEW_INDEPENDENTLY'||
       input.expectedPlanHash!==hash(pkg.plan)||input.expectedBuyerFingerprint!==hash(pkg.plan.payload.buyerKey))
      throw Error('EXACT_INDEPENDENT_REVIEW_CONFIRMATION_REQUIRED');
     const response=signHumanReview(pkg,input.draft,key,seal);
     // Response and human notes are retained locally; never exported key material.
     await writeFile(path.join(directory,'review-'+randomBytes(12).toString('hex')+'.json'),
      JSON.stringify(response,null,2),{flag:'wx',mode:0o600});
     return response;
    }
    throw Error('UNKNOWN_REVIEW_ACTION');
   };
   const pending=queue.then(operation);queue=pending.catch(()=>{});send(res,200,await pending);
  }catch(e){send(res,400,{error:/^[A-Z][A-Z0-9_]+$/.test(e.message)?e.message:'REVIEW_REFUSED_CHECK_INPUT'});}
 });
 server.requestTimeout=30000;server.headersTimeout=15000;
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
 session='http://127.0.0.1:'+server.address().port;
 return {url:session,server,close:()=>new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve()))};
}

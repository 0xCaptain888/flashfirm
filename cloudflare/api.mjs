import {hash} from '../src/protocol.mjs';
import {commitPolicy,assessReview,validateAppeal,resolveAppeal} from '../src/governance.mjs';
const json=(v,status=200)=>new Response(JSON.stringify(v),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}});
const fail=(message,status=400)=>{throw Object.assign(Error(message),{status});};
const q=(db,sql,...args)=>db.prepare(sql).bind(...args);
const utf8=new TextEncoder();
export async function sha(value){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',utf8.encode(value)))].map(b=>b.toString(16).padStart(2,'0')).join('');}
async function body(request){
 const reader=request.body?.getReader();if(!reader)return {};
 const chunks=[];let size=0;
 while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>100000){await reader.cancel();fail('INPUT_TOO_LARGE',413);}chunks.push(value);}
 const bytes=new Uint8Array(size);let at=0;for(const b of chunks){bytes.set(b,at);at+=b.length;}return JSON.parse(new TextDecoder().decode(bytes));
}
async function access(db,owner,id,active=false){const firm=await q(db,'SELECT * FROM firms WHERE id=? AND owner=?',id,owner).first();if(!firm)fail('NOT_FOUND',404);if(active&&firm.state!=='ACTIVE')fail('WORKSPACE_CLOSED',409);return firm;}
function event(db,firm,kind,data={}){return q(db,'INSERT INTO events(firm,kind,data,created) VALUES(?,?,?,?)',firm,kind,JSON.stringify(data),Date.now());}
async function quota(db,bucket,max){
 const row=await q(db,'INSERT INTO quotas(bucket,count) VALUES(?,1) ON CONFLICT(bucket) DO UPDATE SET count=count+1 WHERE count<? RETURNING count',bucket,max).first();
 if(!row)fail('FREE_TIER_APPLICATION_LIMIT',429);
}
async function key(env){if(!/^[a-f0-9]{64}$/.test(env.VAULT_KEY??''))fail('VAULT_NOT_CONFIGURED',503);return crypto.subtle.importKey('raw',Uint8Array.from(env.VAULT_KEY.match(/../g),b=>parseInt(b,16)),'AES-GCM',false,['encrypt','decrypt']);}
async function encrypt(env,id,value){const iv=crypto.getRandomValues(new Uint8Array(12));const bytes=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:utf8.encode(id)},await key(env),utf8.encode(JSON.stringify(value)));return JSON.stringify({iv:[...iv],bytes:[...new Uint8Array(bytes)]});}
function jobResult(row){return {...row,requestKey:row.request_key,attempts:row.state==='QUEUED'?0:1,result:row.result?JSON.parse(row.result):null,input:undefined};}
async function dispatch(env,job){
 try{await env.VERIFICATION.create({id:job.id,params:{jobId:job.id}});return true;}
 catch {try{await (await env.VERIFICATION.get(job.id)).status();return true;}catch{return false;}}
}
function assessment(current){let value=assessReview(current.commitment,current.resultRoot,current.decisions,Date.now());if(current.appeal)value={...value,state:'APPEAL_PENDING'};if(current.resolution)value={...value,...resolveAppeal(current.commitment,current.resultRoot,current.decisions,current.appeal,current.resolution,Date.now())};return {...current,assessment:value,settlementExecuted:false};}
export async function handle(request,env){
 try{
  const url=new URL(request.url),origin=request.headers.get('Origin');
  if(origin&&origin!==url.origin)fail('ORIGIN_DENIED',403);
  if(request.method==='GET'&&url.pathname==='/healthz'){await env.DB.prepare('SELECT 1').first();return json({status:'READY',storage:'D1',paidCallsEnabled:false,teeEnabled:false});}
  if(url.pathname.startsWith('/api/tasks'))fail('FIXTURE_API_DISABLED',403);
  if(!url.pathname.startsWith('/api/workspaces')){
   if(!['GET','HEAD'].includes(request.method))fail('METHOD_DENIED',405);
   return env.ASSETS.fetch(request);
  }
  const token=request.headers.get('Authorization')?.match(/^Bearer ([A-Za-z0-9_-]{32,200})$/)?.[1];
  if(!token)fail('AUTH_REQUIRED',401);
  const identity=await q(env.DB,'SELECT owner FROM tokens WHERE hash=? AND revoked=0 AND expires>?',await sha(token),Date.now()).first();
  if(!identity)fail('AUTH_REQUIRED',401);const owner=identity.owner;
  const day=new Date().toISOString().slice(0,10),minute=Math.floor(Date.now()/60000);
  await quota(env.DB,`minute:${owner}:${minute}`,60);
  const path=url.pathname.slice('/api/workspaces'.length);
  if(path==='/model-status')return json({enabled:false,reason:'CLOUD_PAID_RUNS_DISABLED_KEEP_EXISTING_LOCAL_LEDGER',budget:{calls:10,maxCalls:12,reservedFen:1591,capFen:2000},snapshotOnly:true,recordedAt:'2026-11-02'});
  if(path==='/integration-status')return json({deployment:'CLOUDFLARE_FREE',workflows:true,teeConfigured:false,settlementEnabled:false,routeIds:[],independentOperatorsVerified:false});
  if(!path){
   if(request.method==='GET')return json((await q(env.DB,'SELECT * FROM firms WHERE owner=? ORDER BY created DESC',owner).all()).results);
   if(request.method==='POST'){await quota(env.DB,`write:${day}`,500);const input=await body(request);if(typeof input.title!=='string'||!input.title.trim()||input.title.length>160)fail('INVALID_TITLE');const id=crypto.randomUUID();await env.DB.batch([q(env.DB,'INSERT INTO firms VALUES(?,?,?,?,?)',id,owner,input.title.trim(),'ACTIVE',Date.now()),event(env.DB,id,'CREATED')]);return json(await access(env.DB,owner,id),201);}
  }
  const match=path.match(/^\/([a-f0-9-]{36})(?:\/(jobs|events|documents|dissolve|review|decision|appeal|resolution)(?:\/([a-f0-9-]{36})(?:\/(resume))?)?)?$/);
  if(!match)fail('NOT_FOUND',404);const [,id,action,item,resume]=match;
  const firm=await access(env.DB,owner,id,request.method!=='GET');
  if(request.method==='GET'&&!action)return json(firm);
  if(request.method==='GET'&&action==='events')return json((await q(env.DB,'SELECT * FROM events WHERE firm=? ORDER BY seq LIMIT 500',id).all()).results.map(e=>({...e,data:JSON.parse(e.data)})));
  if(request.method==='GET'&&action==='jobs'){
   if(item){const job=await q(env.DB,'SELECT * FROM jobs WHERE id=? AND firm=?',item,id).first();if(!job)fail('NOT_FOUND',404);return json(jobResult(job));}
   return json((await q(env.DB,'SELECT id,firm,request_key,kind,state,created FROM jobs WHERE firm=? ORDER BY created DESC',id).all()).results.map(jobResult));
  }
  if(request.method==='POST'){
   await quota(env.DB,`write:${day}`,500);const input=await body(request);
   if(action==='jobs'){
    if(item&&resume){const job=await q(env.DB,'SELECT * FROM jobs WHERE id=? AND firm=?',item,id).first();if(!job)fail('NOT_FOUND',404);if(job.state!=='QUEUED')return json(jobResult(job));return json({...jobResult(job),dispatched:await dispatch(env,job)});}
    if(item)fail('NOT_FOUND',404);
    if(input.kind!=='VERIFY_RECEIPT'||!input.receipt)fail('ONLY_FREE_RECEIPT_VERIFICATION_SUPPORTED',409);
    const requestKey=request.headers.get('Idempotency-Key');if(!/^[A-Za-z0-9_-]{8,100}$/.test(requestKey??''))fail('IDEMPOTENCY_KEY_REQUIRED');
    const fingerprint=hash(input);let job=await q(env.DB,'SELECT * FROM jobs WHERE firm=? AND request_key=?',id,requestKey).first();
    if(job){if(job.input_hash!==fingerprint)fail('IDEMPOTENCY_CONFLICT',409);return json({...jobResult(job),dispatched:job.state==='QUEUED'?await dispatch(env,job):true},202);}
    await quota(env.DB,`jobs:${day}`,100);
    const jid=crypto.randomUUID();const encrypted=await encrypt(env,`${id}:${jid}`,input.receipt);
    await q(env.DB,"INSERT INTO jobs VALUES(?,?,?,?,?,?,'QUEUED',NULL,?) ON CONFLICT(firm,request_key) DO NOTHING",jid,id,requestKey,fingerprint,encrypted,'VERIFY_RECEIPT',Date.now()).run();
    job=await q(env.DB,'SELECT * FROM jobs WHERE firm=? AND request_key=?',id,requestKey).first();if(job.input_hash!==fingerprint)fail('IDEMPOTENCY_CONFLICT',409);
    return json({...jobResult(job),dispatched:await dispatch(env,job)},202);
   }
   if(action==='documents'&&!item){if(typeof input.text!=='string'||input.text.length>10000)fail('NOTE_TOO_LARGE');const docId=crypto.randomUUID();await env.DB.batch([q(env.DB,'INSERT INTO documents VALUES(?,?,?)',docId,id,await encrypt(env,`${id}:${docId}`,input)),event(env.DB,id,'DOCUMENT_STORED',{id:docId})]);return json({id:docId},201);}
   if(action==='dissolve'){
    await env.DB.batch([q(env.DB,"UPDATE firms SET state='CLOSED' WHERE id=? AND owner=?",id,owner),q(env.DB,"UPDATE jobs SET state='CANCELLED',input='' WHERE firm=? AND state IN ('QUEUED','RUNNING')",id),q(env.DB,'DELETE FROM documents WHERE firm=?',id),event(env.DB,id,'CLOSED')]);return json({state:'CLOSED',fundsMoved:false});
   }
   if(['review','decision','appeal','resolution'].includes(action)){
    const row=await q(env.DB,'SELECT * FROM reviews WHERE firm=?',id).first();
    if(action==='review'){
     const commitment=commitPolicy(input.policy);if(input.policy.expiresAt<=Date.now())fail('EXPIRED_POLICY');assessReview(commitment,input.resultRoot,[],Date.now());
     if(row){const current=JSON.parse(row.body);if(hash(current.commitment)!==hash(commitment)||current.resultRoot!==input.resultRoot)fail('IMMUTABLE_POLICY',409);return json(assessment(current));}
     const current={commitment,resultRoot:input.resultRoot,decisions:[],appeal:null,resolution:null};await q(env.DB,'INSERT INTO reviews(firm,body) VALUES(?,?)',id,JSON.stringify(current)).run();return json(assessment(current),201);
    }
    if(!row)fail('POLICY_REQUIRED',409);const current=JSON.parse(row.body),before=assessment(current);
    if(action==='decision'){
     const old=current.decisions.find(d=>d.publicKey===input.publicKey);if(old){if(hash(old)!==hash(input))fail('IMMUTABLE_DECISION',409);return json(before);}
     if(current.appeal||['EXPIRED','RELEASE_ELIGIBLE'].includes(before.assessment.state)||input.payload?.issuedAt<Date.now()-300000)fail('REVIEW_CLOSED',409);
     current.decisions.push(input);assessReview(current.commitment,current.resultRoot,current.decisions,Date.now());
    }else if(action==='appeal'){
     if(current.appeal){if(hash(current.appeal)!==hash(input))fail('IMMUTABLE_APPEAL',409);return json(before);}
     if(Date.now()>=before.assessment.appealUntil)fail('APPEAL_EXPIRED');validateAppeal(current.commitment,current.resultRoot,current.decisions,input,Date.now());current.appeal=input;
    }else{
     if(current.resolution){if(hash(current.resolution)!==hash(input))fail('IMMUTABLE_RESOLUTION',409);return json(before);}
     resolveAppeal(current.commitment,current.resultRoot,current.decisions,current.appeal,input,Date.now());current.resolution=input;
    }
    const result=await q(env.DB,'UPDATE reviews SET body=?,revision=revision+1 WHERE firm=? AND revision=?',JSON.stringify(current),id,row.revision).run();if(result.meta.changes!==1)fail('CONCURRENT_UPDATE_RELOAD_REQUIRED',409);return json(assessment(current));
   }
  }
  if(request.method==='GET'&&action==='review'){const row=await q(env.DB,'SELECT body FROM reviews WHERE firm=?',id).first();if(!row)fail('NOT_FOUND',404);return json(assessment(JSON.parse(row.body)));}
  fail('NOT_FOUND',404);
 }catch(error){return json({error:error.status?error.message:'REQUEST_REJECTED'},error.status??400);}
}
export async function decryptReceipt(env,job){const value=JSON.parse(job.input);const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:new Uint8Array(value.iv),additionalData:utf8.encode(`${job.firm}:${job.id}`)},await key(env),new Uint8Array(value.bytes));return JSON.parse(new TextDecoder().decode(plain));}

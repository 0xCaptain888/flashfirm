import {hash} from '../src/protocol.mjs';
import {commitPolicy,assessReview,validateAppeal,resolveAppeal} from '../src/governance.mjs';
import {createCase,assertCaseReview,caseStatus,exportCase,caseNotifications} from '../src/task-case.mjs';
import {taskFlowOperation} from '../src/task-flow-store.mjs';
import {pinnedTaskVerifiers} from '../src/read-only-rpc.mjs';
import {organizationSession,cloudPrincipal,organizationOperation} from './organizations.mjs';
import {backupResponse,mailSubscription,enqueueMail} from './operations.mjs';
import {pushConfigured,pushPreference,enqueuePush,drainPush} from './push.mjs';
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
export async function encrypt(env,id,value){const iv=crypto.getRandomValues(new Uint8Array(12));const bytes=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:utf8.encode(id)},await key(env),utf8.encode(JSON.stringify(value)));return JSON.stringify({iv:[...iv],bytes:[...new Uint8Array(bytes)]});}
export async function decrypt(env,id,blob){const value=JSON.parse(blob);const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:new Uint8Array(value.iv),additionalData:utf8.encode(id)},await key(env),new Uint8Array(value.bytes));return JSON.parse(new TextDecoder().decode(plain));}
async function caseContext(env,firm){
 const [row,reviewRow]=await Promise.all([q(env.DB,'SELECT blob FROM task_cases WHERE firm=?',firm.id).first(),q(env.DB,'SELECT body FROM reviews WHERE firm=?',firm.id).first()]);
 return {record:row?await decrypt(env,`${firm.id}:case`,row.blob):null,review:reviewRow?JSON.parse(reviewRow.body):null};
}
async function notifications(env,firm,context){
 const [jobs,acks,flowRow]=await Promise.all([q(env.DB,'SELECT id,state,result FROM jobs WHERE firm=? ORDER BY created DESC LIMIT 100',firm.id).all(),q(env.DB,'SELECT id FROM notification_acks WHERE firm=?',firm.id).all(),q(env.DB,'SELECT blob FROM task_flows WHERE firm=?',firm.id).first()]);
 const flow=flowRow?await decrypt(env,`${firm.id}:flow`,flowRow.blob):null;
 return caseNotifications(firm,context.record,context.review,jobs.results.map(j=>({...j,result:j.result?JSON.parse(j.result):null})),acks.results.map(a=>a.id),Date.now(),flow);
}
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
  if(request.method==='GET'&&url.pathname==='/api/operations/backup')return backupResponse(request,env);
  if(url.pathname==='/api/auth/config'&&request.method==='GET')return json({provider:'CLOUDFLARE_ACCESS',configured:!!env.ACCESS_ISSUER&&!!env.ACCESS_AUDIENCE,selfService:'VERIFIED_IDENTITY_REQUIRED'});
  if(url.pathname==='/api/auth/session'&&request.method==='POST'){
   await quota(env.DB,`login:${Math.floor(Date.now()/60000)}:${await sha(request.headers.get('CF-Connecting-IP')??'anonymous')}`,10);
   return json(await organizationSession(env,request.headers.get('Cf-Access-Jwt-Assertion'),await body(request)));
  }
  if(url.pathname.startsWith('/api/tasks'))fail('FIXTURE_API_DISABLED',403);
  if(!url.pathname.startsWith('/api/workspaces')){
   if(!['GET','HEAD'].includes(request.method))fail('METHOD_DENIED',405);
   return env.ASSETS.fetch(request);
  }
  const token=request.headers.get('Authorization')?.match(/^Bearer ([A-Za-z0-9_-]{32,200})$/)?.[1];
  if(!token)fail('AUTH_REQUIRED',401);
  const identity=await cloudPrincipal(env.DB,await sha(token));
  if(!identity)fail('AUTH_REQUIRED',401);const owner=identity.owner;
  if(identity.role==='VIEWER'&&!['GET','HEAD'].includes(request.method)&&
   !['/api/workspaces/logout','/api/workspaces/email-subscription','/api/workspaces/push-subscription'].includes(url.pathname))fail('READ_ONLY_MEMBER',403);
  const day=new Date().toISOString().slice(0,10),minute=Math.floor(Date.now()/60000);
  await quota(env.DB,`minute:${owner}:${minute}`,60);
  const path=url.pathname.slice('/api/workspaces'.length);
  const notifyMatch=path.match(/^\/([a-f0-9-]{36})\/email-notification$/);
  if(notifyMatch&&request.method==='POST'){
   const firm=await access(env.DB,owner,notifyMatch[1]),input=await body(request);
   const item=(await notifications(env,firm,await caseContext(env,firm))).items.find(n=>n.id===input.notificationId);
   if(!item)fail('UNKNOWN_NOTIFICATION',404);
   return json(await enqueueMail(env,identity,item,(id,v)=>encrypt(env,id,v)));
  }
  if(path==='/email-subscription'&&request.method==='POST')return json(await mailSubscription(env,identity,await body(request)));
  if(path==='/push-config'&&request.method==='GET')return json({configured:pushConfigured(env)&&!identity.legacy,
    publicKey:pushConfigured(env)&&!identity.legacy?env.VAPID_PUBLIC_KEY:null,
    reason:identity.legacy?'VERIFIED_ORGANIZATION_IDENTITY_REQUIRED':pushConfigured(env)?null:'VAPID_NOT_CONFIGURED'});
  if(path==='/push-subscription'&&request.method==='POST')return json(await pushPreference(env,identity,await body(request),(id,v)=>encrypt(env,id,v)));
  if(path==='/operations'&&request.method==='GET')return json({identityProviderConfigured:!!env.ACCESS_ISSUER&&!!env.ACCESS_AUDIENCE,
    offsiteExportConfigured:!!env.BACKUP_PUBLIC_KEY&&!!env.BACKUP_AUTH_HASH,
    emailConfigured:env.MAIL_SEND_ENABLED==='yes'&&!!env.RESEND_API_KEY,
    cloudPushConfigured:pushConfigured(env),teeInstanceEnabled:false,mainnetAutomaticSigning:false,
    health:(await q(env.DB,'SELECT * FROM operations_health').all()).results});
  if(path==='/logout'&&request.method==='POST'){
   await q(env.DB,'UPDATE tokens SET revoked=1 WHERE hash=?',await sha(token)).run();return json({revoked:true});
  }
  const orgMatch=path.match(/^\/organization\/(members|invite|revoke)$/);
  if(orgMatch){
   if((orgMatch[1]==='members'&&request.method!=='GET')||(orgMatch[1]!=='members'&&request.method!=='POST'))fail('METHOD_DENIED',405);
   return json(await organizationOperation(env,identity,orgMatch[1],request.method==='POST'?await body(request):{}));
  }
  const flowMatch=path.match(/^\/([a-f0-9-]{36})\/flow(?:\/(plan|quality|privacy|manifest|invoice|quote|verify|refund))?$/);
  if(flowMatch){
   const [,id,op]=flowMatch;
   if((op&&request.method!=='POST')||(!op&&request.method!=='GET'))fail('METHOD_DENIED',405);
   if(op)await quota(env.DB,`write:${day}`,500);
   const adapter={db:env.DB,access:(o,f,a)=>access(env.DB,o,f,a),context:f=>caseContext(env,f),
    encrypt:(f,v)=>encrypt(env,`${f}:flow`,v),decrypt:(f,b)=>decrypt(env,`${f}:flow`,b),
    security:{authority:env.IDENTITY_AUTHORITY_KEY,releaseAuthority:env.SECRET_RELEASE_AUTHORITY_KEY,revokedSubjects:JSON.parse(env.REVOKED_IDENTITY_SUBJECTS??'[]')},
    verifiers:pinnedTaskVerifiers()};
   return json(await taskFlowOperation(adapter,owner,id,op??'status',op?await body(request):{}));
  }
  if(path==='/model-status')return json({enabled:false,reason:'CLOUD_PAID_RUNS_DISABLED_KEEP_EXISTING_LOCAL_LEDGER',budget:{calls:10,maxCalls:12,reservedFen:1591,capFen:2000},snapshotOnly:true,recordedAt:'2026-11-02'});
  if(path==='/integration-status')return json({deployment:'CLOUDFLARE_FREE',workflows:true,teeConfigured:false,settlementEnabled:false,routeIds:[],independentOperatorsVerified:false});
  const caseMatch=path.match(/^\/([a-f0-9-]{36})\/(case|case-export|notifications)(?:\/([a-f0-9]{64}))?$/);
  if(caseMatch){
   const [,id,action,nid]=caseMatch,firm=await access(env.DB,owner,id);
   const context=await caseContext(env,firm);
   if(request.method==='GET'&&!nid){
    if(action==='case')return json({...context,status:caseStatus(firm,context.record,context.review)});
    if(action==='case-export')return json(exportCase(firm,context.record,context.review));
    if(action==='notifications')return json(await notifications(env,firm,context));
   }
   if(request.method==='POST'){
    await quota(env.DB,`write:${day}`,500);
    if(action==='notifications'&&nid){
     if(!(await notifications(env,firm,context)).items.some(n=>n.id===nid))fail('UNKNOWN_NOTIFICATION',404);
     await q(env.DB,'INSERT OR IGNORE INTO notification_acks VALUES(?,?,?)',id,nid,Date.now()).run();
     return json({acknowledged:true,id:nid});
    }
    if(action==='case'&&!nid){
     if(firm.state!=='ACTIVE')fail('WORKSPACE_CLOSED',409);
     const input=await body(request);
     if(JSON.stringify(input.receipt).length>90000)fail('CASE_TOO_LARGE',413);
     const record=createCase(input.receipt);
     if(context.record){if(context.record.receiptHash!==record.receiptHash)fail('IMMUTABLE_CASE_CREATE_NEW_WORKSPACE',409);return json({...context,status:caseStatus(firm,context.record,context.review)});}
     if(context.review)assertCaseReview(record,context.review.commitment,context.review.resultRoot);
     const inserted=await q(env.DB,'INSERT INTO task_cases VALUES(?,?,?,?) ON CONFLICT(firm) DO NOTHING',id,record.taskRoot,record.receiptHash,await encrypt(env,`${id}:case`,record)).run();
     const stored=await caseContext(env,firm);
     if(stored.record.receiptHash!==record.receiptHash)fail('IMMUTABLE_CASE_CREATE_NEW_WORKSPACE',409);
     if(inserted.meta.changes===1)await event(env.DB,id,'CASE_ATTACHED',{receiptHash:record.receiptHash,taskRoot:record.taskRoot}).run();
     return json({...stored,status:caseStatus(firm,stored.record,stored.review)},201);
    }
   }
   fail('NOT_FOUND',404);
  }
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
    const taskCase=await q(env.DB,'SELECT receipt_hash FROM task_cases WHERE firm=?',id).first();
    if(taskCase&&hash(input.receipt)!==taskCase.receipt_hash)fail('CASE_REPORT_MISMATCH_USE_NEW_WORKSPACE',409);
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
     const caseRow=await q(env.DB,'SELECT task_root,receipt_hash FROM task_cases WHERE firm=?',id).first();
     if(caseRow)assertCaseReview({taskRoot:caseRow.task_root,receiptHash:caseRow.receipt_hash},commitment,input.resultRoot);
     if(row){const current=JSON.parse(row.body);if(hash(current.commitment)!==hash(commitment)||current.resultRoot!==input.resultRoot)fail('IMMUTABLE_POLICY',409);return json(assessment(current));}
     const current={commitment,resultRoot:input.resultRoot,decisions:[],appeal:null,resolution:null};await q(env.DB,'INSERT INTO reviews(firm,body) VALUES(?,?)',id,JSON.stringify(current)).run();await event(env.DB,id,'REVIEW_POLICY_PINNED',{policyHash:commitment.digest,resultRoot:input.resultRoot}).run();return json(assessment(current),201);
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
    const result=await q(env.DB,'UPDATE reviews SET body=?,revision=revision+1 WHERE firm=? AND revision=?',JSON.stringify(current),id,row.revision).run();if(result.meta.changes!==1)fail('CONCURRENT_UPDATE_RELOAD_REQUIRED',409);await event(env.DB,id,'REVIEW_'+action.toUpperCase(),{resultRoot:current.resultRoot}).run();return json(assessment(current));
   }
  }
  if(request.method==='GET'&&action==='review'){const row=await q(env.DB,'SELECT body FROM reviews WHERE firm=?',id).first();if(!row)fail('NOT_FOUND',404);return json(assessment(JSON.parse(row.body)));}
  fail('NOT_FOUND',404);
 }catch(error){return json({error:error.status||/^[A-Z][A-Z0-9_]{2,100}$/.test(error.message)?error.message:'REQUEST_REJECTED'},error.status??400);}
}
export async function decryptReceipt(env,job){const value=JSON.parse(job.input);const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:new Uint8Array(value.iv),additionalData:utf8.encode(`${job.firm}:${job.id}`)},await key(env),new Uint8Array(value.bytes));return JSON.parse(new TextDecoder().decode(plain));}
export async function operationsTick(env){
 const {drainMail}=await import('./operations.mjs');
 // Round-robin one subscription/workspace pair per channel. This keeps a tick
 // within free-worker request limits and avoids always selecting the first user.
 for(const channel of ['mail','push']){
  if(channel==='mail'?env.MAIL_SEND_ENABLED!=='yes':!pushConfigured(env))continue;
  const table=channel==='mail'?'mail_subscriptions':'push_subscriptions',cursorId=channel+'-cursor';
  const cursorRow=await q(env.DB,'SELECT body FROM operations_health WHERE id=?',cursorId).first();
  const cursor=cursorRow?JSON.parse(cursorRow.body).cursor:'';
  const pairKey=channel==='mail'?"s.organization||':'||s.principal||':'||f.id":"s.id||':'||f.id";
  const query=`SELECT s.*,f.id AS firm_id,${pairKey} AS cursor_key FROM ${table} s JOIN organization_members m
    ON s.organization=m.organization AND s.principal=m.principal JOIN firms f ON f.owner='org:'||s.organization
    WHERE s.enabled=1 AND m.active=1 AND f.state='ACTIVE' AND ${pairKey}>? ORDER BY cursor_key LIMIT 1`;
  const sub=await q(env.DB,query,cursor).first()??(cursor?await q(env.DB,query,'').first():null);
  if(!sub)continue;
  await q(env.DB,'INSERT INTO operations_health VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body,checked=excluded.checked',
    cursorId,JSON.stringify({cursor:sub.cursor_key}),Date.now()).run();
  const owner='org:'+sub.organization,firm=await access(env.DB,owner,sub.firm_id);
  const inbox=await notifications(env,firm,await caseContext(env,firm));
  const candidates=inbox.items.filter(n=>!n.acknowledged).map(notification=>({
   notification,id:channel==='mail'?
    hash({organization:sub.organization,principal:sub.principal,notification:notification.id}):
    hash({subscription:sub.id,firmId:firm.id,notification:notification.id})
  }));
  const outbox=channel==='mail'?'notification_outbox':'push_outbox';
  const queued=new Set(candidates.length?(await q(env.DB,
   `SELECT id FROM ${outbox} WHERE id IN (SELECT value FROM json_each(?))`,
   JSON.stringify(candidates.map(n=>n.id))).all()).results.map(n=>n.id):[]);
  // Old unread alerts retain their existing retry state without starving newer
  // events. One JSON argument also keeps this below D1's SQL parameter limit.
  for(const {notification:n} of candidates.filter(n=>!queued.has(n.id)).slice(0,3)){
   if(channel==='mail')await enqueueMail(env,{...sub,owner},n,(id,v)=>encrypt(env,id,v));
   else await enqueuePush(env,sub,firm.id,n,(id,v)=>encrypt(env,id,v));
  }
 }
 // Delivery is best-effort. Read membership/consent again inside each drain.
 return {mail:await drainMail(env,(id,blob)=>decrypt(env,id,blob)),
  push:await drainPush(env,(id,blob)=>decrypt(env,id,blob))};
}

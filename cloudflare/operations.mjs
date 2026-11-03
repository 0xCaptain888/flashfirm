import {hash} from '../src/protocol.mjs';
import {encryptedCloudSnapshot} from '../src/cloud-backup.mjs';
const q=(db,sql,...args)=>db.prepare(sql).bind(...args);
export async function backupResponse(request,env){
  const bearer=request.headers.get('Authorization')?.match(/^Bearer ([A-Za-z0-9_-]{32,200})$/)?.[1];
  if(!bearer||!env.BACKUP_AUTH_HASH||hash(bearer)!==env.BACKUP_AUTH_HASH)return new Response('Unauthorized',{status:401});
  const data=await encryptedCloudSnapshot(env);
  await q(env.DB,'INSERT INTO operations_health VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body,checked=excluded.checked',
    'backup',JSON.stringify({state:'EXPORTED_ENCRYPTED',createdAt:data.createdAt}),Date.now()).run();
  return new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
}
export async function mailSubscription(env,identity,input){
  if(identity.legacy||!identity.email)throw Error('VERIFIED_ORGANIZATION_EMAIL_REQUIRED');
  if(typeof input.enabled!=='boolean')throw Error('EXPLICIT_NOTIFICATION_CHOICE_REQUIRED');
  await q(env.DB,`INSERT INTO mail_subscriptions VALUES(?,?,?,?) ON CONFLICT(organization,principal)
    DO UPDATE SET enabled=excluded.enabled,email=excluded.email`,identity.organization,identity.principal,input.enabled?1:0,identity.email).run();
  return {subscribed:input.enabled,channel:'EMAIL',deliveryEnabled:env.MAIL_SEND_ENABLED==='yes'&&!!env.RESEND_API_KEY};
}
export async function enqueueMail(env,identity,notification,encrypt){
  if(identity.legacy)return {queued:false};
  const subscription=await q(env.DB,'SELECT * FROM mail_subscriptions WHERE organization=? AND principal=? AND enabled=1',identity.organization,identity.principal).first();
  if(!subscription)return {queued:false};
  const id=hash({organization:identity.organization,principal:identity.principal,notification:notification.id});
  const blob=await encrypt('mail:'+id,{email:subscription.email,subject:notification.title,
    text:notification.detail,organization:identity.organization,principal:identity.principal});
  await q(env.DB,"INSERT OR IGNORE INTO notification_outbox VALUES(?,?,?,'PENDING',0,NULL,?,?)",
    id,identity.owner,blob,Date.now(),Date.now()).run();
  return {queued:true,id};
}
export async function drainMail(env,decrypt,fetcher=fetch,now=Date.now()){
  if(env.MAIL_SEND_ENABLED!=='yes'||!env.RESEND_API_KEY||!env.MAIL_FROM)return {enabled:false,sent:0};
  const rows=(await q(env.DB,"SELECT * FROM notification_outbox WHERE (state='PENDING' OR state='SENDING') AND retry_at<=? AND attempts<5 LIMIT 10",now).all()).results;
  let sent=0;
  for(const row of rows){
    if(now-row.created>3600000){
      await q(env.DB,"UPDATE notification_outbox SET state='FAILED',lease=NULL WHERE id=? AND state IN ('PENDING','SENDING')",row.id).run();
      continue;
    }
    const lease=crypto.randomUUID();
    const acquired=await q(env.DB,`UPDATE notification_outbox SET state='SENDING',lease=?,attempts=attempts+1,retry_at=?
      WHERE id=? AND retry_at<=? AND state IN ('PENDING','SENDING')`,lease,now+300000,row.id,now).run();
    if(acquired.meta.changes!==1)continue;
    let state='PENDING';
    try{
      const p=await decrypt('mail:'+row.id,row.blob);
      const sub=await q(env.DB,'SELECT 1 FROM mail_subscriptions s JOIN organization_members m ON s.organization=m.organization AND s.principal=m.principal WHERE s.organization=? AND s.principal=? AND s.enabled=1 AND m.active=1 AND s.email=?',p.organization,p.principal,p.email).first();
      if(!sub)state='CANCELLED';
      else{
        const response=await fetcher('https://api.resend.com/emails',{method:'POST',redirect:'error',
          signal:AbortSignal.timeout(15000),headers:{Authorization:'Bearer '+env.RESEND_API_KEY,'Content-Type':'application/json','Idempotency-Key':row.id},
          body:JSON.stringify({from:env.MAIL_FROM,to:[p.email],subject:p.subject,text:p.text})});
        state=response.ok?'DELIVERED':response.status===429||response.status>=500?'PENDING':'FAILED';
        if(response.ok)sent++;
      }
    }catch{state='PENDING';}
    if(state==='PENDING'&&row.attempts+1>=5)state='FAILED';
    await q(env.DB,'UPDATE notification_outbox SET state=?,lease=NULL,retry_at=? WHERE id=? AND lease=?',
      state,now+Math.min(86400000,60000*2**row.attempts),row.id,lease).run();
  }
  return {enabled:true,sent};
}

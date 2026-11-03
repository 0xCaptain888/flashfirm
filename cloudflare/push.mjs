import webpush from 'web-push';
import {hash} from '../src/protocol.mjs';
const q=(db,sql,...args)=>db.prepare(sql).bind(...args);
export function pushConfigured(env){
  return env.PUSH_SEND_ENABLED==='yes'&&!!env.VAPID_SUBJECT&&!!env.VAPID_PUBLIC_KEY&&!!env.VAPID_PRIVATE_KEY;
}
export function validatePushSubscription(input){
  const endpoint=input?.endpoint;
  if(typeof endpoint!=='string'||endpoint.length>4096)throw Error('INVALID_PUSH_SUBSCRIPTION');
  const url=new URL(endpoint),host=url.hostname;
  // Subscriptions may never turn the dispatcher into an arbitrary HTTP client.
  const allowed=['fcm.googleapis.com','updates.push.services.mozilla.com','web.push.apple.com'].includes(host)||
    /^[a-z0-9-]+\.notify\.windows\.com$/.test(host);
  if(url.protocol!=='https:'||url.username||url.password||url.port||url.hash||!allowed||
    typeof input.keys?.p256dh!=='string'||typeof input.keys?.auth!=='string'||
    !/^[A-Za-z0-9_-]{87}$/.test(input.keys.p256dh)||Buffer.from(input.keys.p256dh,'base64url').length!==65||
    Buffer.from(input.keys.p256dh,'base64url')[0]!==4||
    !/^[A-Za-z0-9_-]{22}$/.test(input.keys.auth)||Buffer.from(input.keys.auth,'base64url').length!==16)
    throw Error('INVALID_PUSH_SUBSCRIPTION');
  return {endpoint:url.href,keys:{p256dh:input.keys.p256dh,auth:input.keys.auth}};
}
export async function pushPreference(env,identity,input,encrypt,now=Date.now()){
  if(identity.legacy||!identity.organization||!identity.principal)throw Error('VERIFIED_ORGANIZATION_IDENTITY_REQUIRED');
  if(input.enabled===false){
    if(input.id!==undefined&&!/^[a-f0-9]{64}$/.test(input.id))throw Error('INVALID_PUSH_ID');
    await q(env.DB,`UPDATE push_subscriptions SET enabled=0 WHERE organization=? AND principal=?${input.id?' AND id=?':''}`,
      identity.organization,identity.principal,...(input.id?[input.id]:[])).run();
    return {enabled:false};
  }
  if(input.enabled!==true||!pushConfigured(env))throw Error('PUSH_NOT_CONFIGURED_OR_NO_CONSENT');
  const subscription=validatePushSubscription(input.subscription),id=hash(subscription.endpoint);
  // Validate the curve point with the standards implementation, without sending.
  webpush.generateRequestDetails(subscription,'validation-only',{vapidDetails:{
    subject:env.VAPID_SUBJECT,publicKey:env.VAPID_PUBLIC_KEY,privateKey:env.VAPID_PRIVATE_KEY},TTL:300});
  const current=await q(env.DB,'SELECT * FROM push_subscriptions WHERE id=?',id).first();
  if(current&&(current.organization!==identity.organization||current.principal!==identity.principal))
    throw Error('PUSH_ENDPOINT_ALREADY_BOUND_TO_DIFFERENT_IDENTITY');
  if(!current&&(await q(env.DB,'SELECT count(*) n FROM push_subscriptions WHERE organization=? AND principal=? AND enabled=1',
    identity.organization,identity.principal).first()).n>=3)throw Error('PUSH_DEVICE_LIMIT');
  const blob=await encrypt('subscription:'+id,subscription);
  const saved=await q(env.DB,`INSERT INTO push_subscriptions VALUES(?,?,?,?,1,?) ON CONFLICT(id) DO UPDATE SET blob=excluded.blob,enabled=1
    WHERE organization=excluded.organization AND principal=excluded.principal`,
    id,identity.organization,identity.principal,blob,now).run();
  if(saved.meta.changes!==1)throw Error('PUSH_SUBSCRIPTION_CONCURRENT_OWNERSHIP_CHANGE');
  return {enabled:true,id,scope:'Generic task alerts only; push-service acceptance is not device delivery.'};
}
export async function enqueuePush(env,subscription,firmId,notification,encrypt,now=Date.now()){
  const id=hash({subscription:subscription.id,firmId,notification:notification.id});
  const blob=await encrypt('push:'+id,{workspace:firmId});
  await q(env.DB,"INSERT OR IGNORE INTO push_outbox VALUES(?,?,?,'PENDING',0,NULL,?,?)",
    id,subscription.id,blob,now,now).run();
  return {id};
}
export async function drainPush(env,decrypt,fetcher=fetch,now=Date.now()){
  if(!pushConfigured(env))return {enabled:false,accepted:0};
  const rows=(await q(env.DB,`SELECT * FROM push_outbox WHERE state IN ('PENDING','SENDING')
    AND retry_at<=? AND attempts<5 LIMIT 2`,now).all()).results;
  let accepted=0;
  for(const row of rows){
    const lease=crypto.randomUUID();
    const acquired=await q(env.DB,`UPDATE push_outbox SET state='SENDING',lease=?,attempts=attempts+1,retry_at=?
      WHERE id=? AND retry_at<=? AND state IN ('PENDING','SENDING')`,lease,now+300000,row.id,now).run();
    if(acquired.meta.changes!==1)continue;
    let state='PENDING';
    try{
      const s=await q(env.DB,`SELECT p.* FROM push_subscriptions p JOIN organization_members m
        ON p.organization=m.organization AND p.principal=m.principal
        WHERE p.id=? AND p.enabled=1 AND m.active=1`,row.subscription).first();
      if(!s||now-row.created>3600000)state='CANCELLED';
      else{
        const subscription=validatePushSubscription(await decrypt('subscription:'+s.id,s.blob));
        const payload=await decrypt('push:'+row.id,row.blob);
        if(!/^[a-f0-9-]{36}$/.test(payload.workspace))throw Error('INVALID_PUSH_WORKSPACE');
        const request=webpush.generateRequestDetails(subscription,JSON.stringify({
          version:'flashfirm-push/1',workspace:payload.workspace,tag:row.id,
          title:'FlashFirm task update',body:'Open your private workspace to review a new task event.'
        }),{TTL:300,contentEncoding:'aes128gcm',urgency:'normal',topic:row.id.slice(0,32),
          vapidDetails:{subject:env.VAPID_SUBJECT,publicKey:env.VAPID_PUBLIC_KEY,privateKey:env.VAPID_PRIVATE_KEY}});
        const response=await fetcher(request.endpoint,{method:'POST',redirect:'error',
          signal:AbortSignal.timeout(15000),headers:request.headers,body:request.body});
        if(response.status===404||response.status===410){
          await q(env.DB,'UPDATE push_subscriptions SET enabled=0 WHERE id=?',s.id).run();state='CANCELLED';
        }else if(response.ok){state='ACCEPTED';accepted++;}
        else state=response.status===429||response.status>=500?'PENDING':'FAILED';
        await response.body?.cancel();
      }
    }catch{state='PENDING';}
    if(state==='PENDING'&&row.attempts+1>=5)state='FAILED';
    await q(env.DB,'UPDATE push_outbox SET state=?,lease=NULL,retry_at=? WHERE id=? AND lease=?',
      state,now+Math.min(3600000,60000*2**row.attempts),row.id,lease).run();
  }
  return {enabled:true,accepted,deviceDeliveryVerified:false};
}

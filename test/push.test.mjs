import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {createECDH,randomBytes,createPublicKey,verify} from 'node:crypto';
import {createRequire} from 'node:module';
import webpush from 'web-push';
import {sqliteAdapter} from '../src/sqlite-adapter.mjs';
import {pushPreference,enqueuePush,drainPush,validatePushSubscription} from '../cloudflare/push.mjs';
import {encrypt,decrypt} from '../cloudflare/api.mjs';
const require=createRequire(import.meta.url);
const ece=require(require.resolve('http_ece',{paths:[require.resolve('web-push')]}));
function fixture(){
 const db=new DatabaseSync(':memory:');
 for(const file of ['0001_workspace.sql','0002_task_cases.sql','0003_task_flow.sql','0004_organizations.sql','0005_operations.sql','0006_push.sql'])
  db.exec(readFileSync(new URL('../cloudflare/migrations/'+file,import.meta.url),'utf8'));
 db.prepare('INSERT INTO organizations VALUES(?,?,?)').run('org','Test team',1);
 db.prepare('INSERT INTO organization_members VALUES(?,?,?,?,1)').run('org','alice','test@example.com','VIEWER');
 const vapid=webpush.generateVAPIDKeys(),curve=createECDH('prime256v1');curve.generateKeys();
 const auth=randomBytes(16).toString('base64url');
 const env={DB:sqliteAdapter(db),VAULT_KEY:randomBytes(32).toString('hex'),
  VAPID_PUBLIC_KEY:vapid.publicKey,VAPID_PRIVATE_KEY:vapid.privateKey,
  VAPID_SUBJECT:'https://github.com/0xCaptain888/flashfirm',PUSH_SEND_ENABLED:'yes'};
 const who={organization:'org',principal:'alice',role:'VIEWER'},subscription={
  endpoint:'https://fcm.googleapis.com/fcm/send/synthetic-no-live-delivery',
  keys:{p256dh:curve.getPublicKey().toString('base64url'),auth}};
 return {db,env,who,subscription,curve,auth,encrypt:(id,v)=>encrypt(env,id,v),decrypt:(id,b)=>decrypt(env,id,b)};
}
test('push opt-in encrypts subscription, rejects SSRF and cross-person reuse, and enforces device caps',async()=>{
 const f=fixture();
 try{
  const {env,who,subscription}=f;
  for(const endpoint of ['http://fcm.googleapis.com/x','https://127.0.0.1/x','https://fcm.googleapis.com.attacker.invalid/x','https://fcm.googleapis.com:8443/x'])
   assert.throws(()=>validatePushSubscription({...subscription,endpoint}));
  await assert.rejects(pushPreference(env,{legacy:true},{enabled:true,subscription},f.encrypt),/ORGANIZATION/);
  const saved=await pushPreference(env,who,{enabled:true,subscription},f.encrypt);
  assert.equal(saved.enabled,true);
  const row=f.db.prepare('SELECT * FROM push_subscriptions').get();
  assert(!row.blob.includes(subscription.endpoint));assert(!row.blob.includes(f.auth));
  await assert.rejects(pushPreference(env,{...who,principal:'other'},{enabled:true,subscription},f.encrypt),/DIFFERENT_IDENTITY/);
  for(let i=0;i<2;i++)await pushPreference(env,who,{enabled:true,subscription:{...subscription,endpoint:subscription.endpoint+i}},f.encrypt);
  await assert.rejects(pushPreference(env,who,{enabled:true,subscription:{...subscription,endpoint:subscription.endpoint+'four'}},f.encrypt),/DEVICE_LIMIT/);
  assert.throws(()=>f.db.prepare('INSERT INTO push_subscriptions VALUES(?,?,?,?,1,?)').run('bypass','org','alice','test',1),/DEVICE_LIMIT/);
 }finally{f.db.close();}
});
test('encrypted background push has valid VAPID, no report content, stable retry topic and explicit service-only acceptance',async()=>{
 const f=fixture();
 try{
  await pushPreference(f.env,f.who,{enabled:true,subscription:f.subscription},f.encrypt);
  const s=f.db.prepare('SELECT * FROM push_subscriptions').get(),firm='12345678-1234-1234-1234-123456789abc',notification={id:'a'.repeat(64),title:'PRIVATE REPORT',detail:'PRIVATE FINANCIAL CONTENT'};
  await enqueuePush(f.env,s,firm,notification,f.encrypt);await enqueuePush(f.env,s,firm,notification,f.encrypt);
  assert.equal(f.db.prepare('SELECT count(*) n FROM push_outbox').get().n,1);
  const requests=[],now=Date.now()+100;
  const send=async(url,options)=>{
   assert.equal(url,f.subscription.endpoint);assert.equal(options.redirect,'error');
   const payload=JSON.parse(ece.decrypt(Buffer.from(options.body),{version:'aes128gcm',authSecret:f.auth,privateKey:f.curve}));
   assert.equal(payload.workspace,firm);assert(!JSON.stringify(payload).includes('PRIVATE'));
   const header=options.headers.Authorization??options.headers.authorization;
   const jwt=header.match(/t=([^, ]+)/)[1],parts=jwt.split('.');
   assert.equal(JSON.parse(Buffer.from(parts[1],'base64url')).aud,'https://fcm.googleapis.com');
   const raw=Buffer.from(f.env.VAPID_PUBLIC_KEY,'base64url');
   const key=createPublicKey({format:'jwk',key:{kty:'EC',crv:'P-256',x:raw.subarray(1,33).toString('base64url'),y:raw.subarray(33).toString('base64url')}});
   assert(verify('SHA256',Buffer.from(parts.slice(0,2).join('.')),{key,dsaEncoding:'ieee-p1363'},Buffer.from(parts[2],'base64url')));
   requests.push(options);
   return new Response('',{status:requests.length===1?503:201});
  };
  await drainPush(f.env,f.decrypt,send,now);
  const result=await drainPush(f.env,f.decrypt,send,now+60001);
  assert.equal(requests.length,2);assert.equal(requests[0].headers.Topic,requests[1].headers.Topic);
  assert.equal(result.accepted,1);assert.equal(result.deviceDeliveryVerified,false);
  assert.equal(f.db.prepare('SELECT state FROM push_outbox').get().state,'ACCEPTED');
 }finally{f.db.close();}
});
test('push rechecks membership and unsubscribe; 410 disables expired device without a new send',async()=>{
 const f=fixture();
 try{
  await pushPreference(f.env,f.who,{enabled:true,subscription:f.subscription},f.encrypt);
  const s=f.db.prepare('SELECT * FROM push_subscriptions').get(),firm='12345678-1234-1234-1234-123456789abc';
  await enqueuePush(f.env,s,firm,{id:'a'.repeat(64)},f.encrypt);
  let sends=0;
  const gone=async()=>{sends++;return new Response('',{status:410});};
  await drainPush(f.env,f.decrypt,gone,Date.now()+100);
  assert.equal(sends,1);assert.equal(f.db.prepare('SELECT enabled FROM push_subscriptions').get().enabled,0);
  await pushPreference(f.env,f.who,{enabled:true,subscription:f.subscription},f.encrypt);
  await enqueuePush(f.env,s,firm,{id:'b'.repeat(64)},f.encrypt);
  await pushPreference(f.env,f.who,{enabled:false},f.encrypt);
  await drainPush(f.env,f.decrypt,gone,Date.now()+200);
  assert.equal(sends,1);
  await pushPreference(f.env,f.who,{enabled:true,subscription:f.subscription},f.encrypt);
  await enqueuePush(f.env,s,firm,{id:'c'.repeat(64)},f.encrypt);
  f.db.exec('UPDATE organization_members SET active=0');
  await drainPush(f.env,f.decrypt,gone,Date.now()+300);
  assert.equal(sends,1);
 }finally{f.db.close();}
});

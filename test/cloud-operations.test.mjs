import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {generateKeyPairSync,randomBytes,sign} from 'node:crypto';
import {sqliteAdapter} from '../src/sqlite-adapter.mjs';
import {encryptedCloudSnapshot,decryptCloudSnapshot,cloudRestoreSql,backupTables} from '../src/cloud-backup.mjs';
import {cloudPrincipal,organizationOperation} from '../cloudflare/organizations.mjs';
import {mailSubscription,enqueueMail,drainMail} from '../cloudflare/operations.mjs';
import {verifyAccessIdentity} from '../src/access-identity.mjs';
function database(){
 const db=new DatabaseSync(':memory:');
 for(const file of ['0001_workspace.sql','0002_task_cases.sql','0003_task_flow.sql','0004_organizations.sql','0005_operations.sql'])
  db.exec(readFileSync(new URL('../cloudflare/migrations/'+file,import.meta.url),'utf8'));
 return db;
}
test('cloud snapshot is encrypted, excludes model/wallet keys and restores isolated data with sessions and jobs disabled',async()=>{
 const db=database(),target=database(),keys=generateKeyPairSync('rsa',{modulusLength:2048}),key=randomBytes(32).toString('hex');
 try{
  db.prepare('INSERT INTO tokens(hash,owner,expires) VALUES(?,?,?)').run('session','alice',Date.now()+60000);
  db.prepare('INSERT INTO firms VALUES(?,?,?,?,?)').run('firm','alice','Private task','ACTIVE',1);
  db.prepare('INSERT INTO task_flows VALUES(?,?,0)').run('firm',"ciphertext-only-'" .repeat(10000));
  db.prepare("INSERT INTO jobs VALUES(?,?,?,?,?,?,'QUEUED',NULL,?)").run('job','firm','key','hash','encrypted','VERIFY_RECEIPT',1);
  db.prepare("UPDATE firms SET state='CLOSED'").run();
  const env={DB:sqliteAdapter(db),VAULT_KEY:key,BACKUP_PUBLIC_KEY:keys.publicKey.export({type:'spki',format:'pem'})};
  const envelope=await encryptedCloudSnapshot(env);
  assert(!JSON.stringify(envelope).includes('Private task'));assert(!JSON.stringify(envelope).includes(key));
  const payload=decryptCloudSnapshot(envelope,keys.privateKey);
  assert.equal(payload.tables.firms[0].title,'Private task');
  const columns=Object.fromEntries(backupTables.map(t=>[t,target.prepare(`PRAGMA table_info(${t})`).all().map(c=>c.name)]));
  target.exec(cloudRestoreSql(payload,columns));
  assert.equal(target.prepare('SELECT blob FROM task_flows').get().blob,"ciphertext-only-'".repeat(10000));
  assert.equal(target.prepare('SELECT revoked FROM tokens').get().revoked,1);
  assert.equal(target.prepare('SELECT state FROM jobs').get().state,'CANCELLED');
  assert.equal(target.prepare('SELECT state FROM firms').get().state,'CLOSED');
  assert.equal(target.prepare('SELECT firm FROM recovery_holds').get().firm,'firm');
  assert.equal(target.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
  const tampered={...envelope,tag:randomBytes(16).toString('base64')};
  assert.throws(()=>decryptCloudSnapshot(tampered,keys.privateKey));
 }finally{db.close();target.close();}
});
test('Access login verifies issuer audience signature expiry and cannot be replaced by caller key URLs',async()=>{
 const keys=generateKeyPairSync('rsa',{modulusLength:2048}),now=Date.now(),kid=randomBytes(8).toString('hex');
 const config={issuer:'https://flashfirm-test.cloudflareaccess.com',audience:'app-audience'};
 const jwk={...keys.publicKey.export({format:'jwk'}),kid,use:'sig',alg:'RS256'};
 const encode=v=>Buffer.from(JSON.stringify(v)).toString('base64url');
 const jwt=(p,h={alg:'RS256',kid})=>{const raw=encode(h)+'.'+encode(p);return raw+'.'+sign('RSA-SHA256',Buffer.from(raw),keys.privateKey).toString('base64url');};
 const p={iss:config.issuer,aud:[config.audience],sub:'alice',email:'Alice@example.com',iat:Math.floor(now/1000),exp:Math.floor(now/1000)+60};
 const fetcher=async url=>{assert.equal(url,config.issuer+'/cdn-cgi/access/certs');return Response.json({keys:[jwk]});};
 assert.equal((await verifyAccessIdentity(jwt(p),config,fetcher,now)).email,'alice@example.com');
 await assert.rejects(verifyAccessIdentity(jwt({...p,aud:['other']}),config,fetcher,now),/CLAIMS/);
 await assert.rejects(verifyAccessIdentity(jwt({...p,exp:1}),config,fetcher,now),/CLAIMS/);
 await assert.rejects(verifyAccessIdentity(jwt(p,{alg:'RS256',kid,jku:'https://attacker.invalid'}),config,fetcher,now),/CLAIMS/);
 const altered=jwt(p).split('.');altered[1]=encode({...p,sub:'mallory'});
 await assert.rejects(verifyAccessIdentity(altered.join('.'),config,fetcher,now),/SIGNATURE/);
});
test('organization session membership is checked on every request; viewers and revoked members cannot administer',async()=>{
 const db=database(),DB=sqliteAdapter(db);
 try{
  db.prepare('INSERT INTO organizations VALUES(?,?,?)').run('org','Team',1);
  db.prepare('INSERT INTO organization_members VALUES(?,?,?,?,1)').run('org','person','alice@example.com','VIEWER');
  db.prepare('INSERT INTO tokens(hash,owner,expires) VALUES(?,?,?)').run('token','org:org',Date.now()+60000);
  db.prepare('INSERT INTO organization_sessions VALUES(?,?,?)').run('token','org','person');
  const person=await cloudPrincipal(DB,'token');assert.equal(person.role,'VIEWER');
  await assert.rejects(organizationOperation({DB},person,'invite',{email:'x@example.com',role:'EDITOR'}),/ADMIN/);
  db.prepare("UPDATE organization_members SET active=0").run();
  assert.equal(await cloudPrincipal(DB,'token'),null);
 }finally{db.close();}
});
test('notification outbox requires verified opt-in, retries same id and cancels on unsubscribe',async()=>{
 const db=database(),DB=sqliteAdapter(db),who={organization:'org',principal:'person',owner:'org:org',email:'alice@example.com'};
 try{
  db.prepare('INSERT INTO organizations VALUES(?,?,?)').run('org','Team',1);
  db.prepare('INSERT INTO organization_members VALUES(?,?,?,?,1)').run('org','person',who.email,'ADMIN');
  const env={DB,MAIL_SEND_ENABLED:'yes',MAIL_FROM:'verified@example.com',RESEND_API_KEY:'synthetic-test-only'};
  const notification={id:'a'.repeat(64),title:'Review required',detail:'Open the workspace to inspect the bound report.'};
  assert.equal((await enqueueMail(env,who,notification,async(_,v)=>JSON.stringify(v))).queued,false);
  await mailSubscription(env,who,{enabled:true});
  await enqueueMail(env,who,notification,async(_,v)=>JSON.stringify(v));
  await enqueueMail(env,who,notification,async(_,v)=>JSON.stringify(v));
  assert.equal(db.prepare('SELECT count(*) n FROM notification_outbox').get().n,1);
  const now=Date.now()+100,ids=[];
  const send=async(url,options)=>{assert.equal(url,'https://api.resend.com/emails');ids.push(options.headers['Idempotency-Key']);return new Response('',{status:ids.length===1?503:200});};
  await drainMail(env,async(_,b)=>JSON.parse(b),send,now);
  await drainMail(env,async(_,b)=>JSON.parse(b),send,now+60001);
  assert.equal(ids.length,2);assert.equal(ids[0],ids[1]);
  assert.equal(db.prepare('SELECT state FROM notification_outbox').get().state,'DELIVERED');
  await enqueueMail(env,who,{...notification,id:'b'.repeat(64)},async(_,v)=>JSON.stringify(v));
  await mailSubscription(env,who,{enabled:false});
  await drainMail(env,async(_,b)=>JSON.parse(b),send,now+120000);
  assert.equal(ids.length,2);
 }finally{db.close();}
});

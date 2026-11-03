import {readFile,writeFile,mkdir,mkdtemp} from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
import {spawn} from 'node:child_process';
import {decryptCloudSnapshot,cloudRestoreSql,backupTables} from '../src/cloud-backup.mjs';
import {hash} from '../src/protocol.mjs';
if(process.env.FLASHFIRM_USE_SYSTEM_PROXY==='1'){
 const {ProxyAgent,setGlobalDispatcher}=await import('../cloudflare/node_modules/undici/index.js');
 setGlobalDispatcher(new ProxyAgent('http://127.0.0.1:7897'));
}
const root=new URL('../',import.meta.url),base=new URL('.runtime/offsite-backup/',root);
await mkdir(base,{recursive:true,mode:0o700});
const setup=JSON.parse(await readFile(new URL('setup.json',base),'utf8'));
const resume=process.argv.find(a=>a.startsWith('--readback-from='))?.slice(16);
if(resume&&!/^\.runtime\/offsite-backup\/drill-[A-Za-z0-9]+$/.test(resume))throw Error('ISOLATED_DRILL_DIRECTORY_REQUIRED');
let encrypted;
if(resume)encrypted=JSON.parse(await readFile(new URL(resume+'/encrypted-backup.json',root),'utf8'));
else{
 const response=await fetch('https://flashfirm-api.fluoridated-rhinoceros.workers.dev/api/operations/backup',{
  headers:{Authorization:'Bearer '+setup.token},redirect:'error',signal:AbortSignal.timeout(60000)});
 if(!response.ok)throw Error('REMOTE_ENCRYPTED_BACKUP_UNAVAILABLE');
 encrypted=await response.json();
}
const snapshot=decryptCloudSnapshot(encrypted,setup.privateKey);
const dir=await mkdtemp(new URL('drill-',base).pathname);
const db=new DatabaseSync(dir+'/restore.sqlite');
const files=['0001_workspace.sql','0002_task_cases.sql','0003_task_flow.sql','0004_organizations.sql','0005_operations.sql'];
let schema='';
for(const file of files){const sql=await readFile(new URL('cloudflare/migrations/'+file,root),'utf8');schema+=sql+'\n';db.exec(sql);}
const columns=Object.fromEntries(backupTables.map(t=>[t,db.prepare(`PRAGMA table_info(${t})`).all().map(c=>c.name)]));
const sql=cloudRestoreSql(snapshot,columns);db.exec(sql);
if(db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok'||db.prepare('PRAGMA foreign_key_check').all().length||
 db.prepare('SELECT count(*) n FROM tokens WHERE revoked=0').get().n)
 throw Error('ISOLATED_RESTORE_VALIDATION_FAILED');
const counts=Object.fromEntries(backupTables.map(t=>[t,db.prepare(`SELECT count(*) n FROM ${t}`).get().n]));
const fingerprint=rows=>hash(rows.map(row=>hash(row)).sort());
const expected=Object.fromEntries(backupTables.map(t=>[t,fingerprint(db.prepare(`SELECT * FROM ${t}`).all())]));
db.close();
await writeFile(dir+'/encrypted-backup.json',JSON.stringify(encrypted),{flag:'wx',mode:0o600});
const remoteFile=dir+'/restore.sql';
await writeFile(remoteFile,schema+'\n'+sql.replace(/^BEGIN;$/m,'').replace(/^COMMIT;$/m,''),{flag:'wx',mode:0o600});
const result={version:'flashfirm-cloud-restore/1',checkedAt:new Date().toISOString(),source:'LIVE_D1_ENCRYPTED_SNAPSHOT',
 snapshotHash:encrypted.payloadHash,isolatedSqliteRestore:true,sqliteIntegrity:'ok',sessionsRevoked:true,
 queuedJobsCancelled:true,notificationsDisabled:true,taskPaymentsHeldForReconciliation:true,
 databaseCounts:counts,cloudRestoreExecuted:false,productionDatabaseModified:false,paidCalls:0,financialTransactions:0};
if(process.argv.includes('--remote')){
 const existing=process.argv.find(a=>a.startsWith('--database='))?.slice(11);
 if(existing&&!/^flashfirm-drill-[a-z0-9]+$/.test(existing))throw Error('ISOLATED_DRILL_DATABASE_NAME_REQUIRED');
 const name=existing??'flashfirm-drill-'+Date.now().toString(36);
 if(resume&&!existing)throw Error('READBACK_REQUIRES_EXISTING_ISOLATED_DATABASE');
 const wrangler='cloudflare/node_modules/wrangler/bin/wrangler.js';
 const command=(args)=>new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,[wrangler,...args,'--config','cloudflare/wrangler.jsonc'],{
   cwd:root,env:{...process.env,HTTPS_PROXY:'http://127.0.0.1:7897'},stdio:['ignore','pipe','pipe']});
  let text='',errors='';child.stdout.on('data',v=>text+=v);child.stderr.on('data',v=>errors+=v);
  child.on('error',reject);child.on('exit',async code=>{
   if(code===0)return resolve(text);
   await writeFile(dir+'/failed-command.log',text+'\n'+errors,{mode:0o600});
   reject(Error('ISOLATED_CLOUD_RESTORE_COMMAND_FAILED_'+args[1]));
  });
 });
 const parsed=text=>{
  const clean=text.replace(/\x1b\[[0-9;]*m/g,''),start=clean.search(/^\[\s*\{/m),end=clean.lastIndexOf(']');
  if(start<0||end<start)throw Error('WRANGLER_JSON_RESULT_MISSING');
  return JSON.parse(clean.slice(start,end+1));
 };
 if(!resume){
  if(!existing)await command(['d1','create',name]);
  const empty=parsed(await command(['d1','execute',name,'--remote','--command',"SELECT count(*) n FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%';",'--json']));
  if(empty[0]?.results?.[0]?.n!==0)throw Error('DRILL_DATABASE_MUST_BE_EMPTY_NO_OVERWRITE');
  await command(['d1','execute',name,'--remote','--file',remoteFile,'--yes']);
 }
 // D1 does not permit integrity_check through the remote query API. Verify
 // every restored row against the locally integrity-checked sanitized snapshot.
 const rows=parsed(await command(['d1','execute',name,'--remote','--command',
  backupTables.map(t=>`SELECT * FROM ${t};`).join(' '),'--json']));
 if(rows.length!==backupTables.length||rows.some((r,i)=>r.success!==true||
  fingerprint(r.results)!==expected[backupTables[i]]))throw Error('CLOUD_RESTORE_READBACK_FAILED');
 result.cloudRestoreExecuted=true;result.isolatedCloudDatabase=name;
 result.cloudReadbackVerified=true;result.retainedCloudDrillDatabase=true;
 result.cloudReadbackMethod='ALL_BUSINESS_TABLE_ROW_HASHES';
 result.cloudTableHashes=expected;
}
await writeFile(new URL('evidence/cloud-restore-upgrade.json',root),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result));

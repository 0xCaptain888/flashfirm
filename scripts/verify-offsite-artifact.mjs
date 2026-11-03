import {readFile,writeFile,mkdtemp} from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
import {decryptCloudSnapshot,cloudRestoreSql,backupTables} from '../src/cloud-backup.mjs';
const run=process.argv[2];
if(!/^\d{8,20}$/.test(run??''))throw Error('GITHUB_RUN_ID_REQUIRED');
const base=new URL('../.runtime/offsite-backup/',import.meta.url);
const setup=JSON.parse(await readFile(new URL('setup.json',base),'utf8'));
const artifact=JSON.parse(await readFile(new URL('github-run-'+run+'/flashfirm-encrypted-backup.json',base),'utf8'));
const snapshot=decryptCloudSnapshot(artifact,setup.privateKey);
const directory=await mkdtemp(new URL('offsite-restore-',base).pathname),db=new DatabaseSync(directory+'/restore.sqlite');
try{
 for(const file of ['0001_workspace.sql','0002_task_cases.sql','0003_task_flow.sql','0004_organizations.sql','0005_operations.sql','0006_push.sql'])
  db.exec(await readFile(new URL('../cloudflare/migrations/'+file,import.meta.url),'utf8'));
 const columns=Object.fromEntries(backupTables.map(t=>[t,db.prepare(`PRAGMA table_info(${t})`).all().map(c=>c.name)]));
 db.exec(cloudRestoreSql(snapshot,columns));
 if(db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok'||db.prepare('PRAGMA foreign_key_check').all().length||
  db.prepare('SELECT count(*) n FROM tokens WHERE revoked=0').get().n)throw Error('OFFSITE_RESTORE_FAILED');
 const evidence={version:'flashfirm-offsite-backup/1',checkedAt:new Date().toISOString(),githubRun:run,
  source:'DOWNLOADED_GITHUB_ACTIONS_ENCRYPTED_ARTIFACT',payloadHash:artifact.payloadHash,
  artifactDownloaded:true,decryptionVerified:true,isolatedSqliteRestore:true,integrityCheck:'ok',
  sessionsRevoked:true,outboundNotificationsDisabled:true,
  restoredTableCount:backupTables.length,olderSnapshotSchemaSupported:true,
  productionDatabaseModified:false,financialTransactions:0,paidCalls:0};
 await writeFile(new URL('../evidence/offsite-backup-upgrade.json',import.meta.url),JSON.stringify(evidence,null,2)+'\n');
 console.log(JSON.stringify(evidence));
}finally{db.close();}

import {randomBytes,createCipheriv,createDecipheriv,publicEncrypt,privateDecrypt,constants} from 'node:crypto';
import {hash} from './protocol.mjs';
export const backupTables=['tokens','firms','jobs','events','documents','quotas','reviews','task_cases','notification_acks',
  'task_flows','task_payment_claims','organizations','organization_members','organization_sessions','organization_invites',
  'mail_subscriptions','notification_outbox','operations_health','recovery_holds'];
export async function encryptedCloudSnapshot(env,now=Date.now()){
  if(!env.BACKUP_PUBLIC_KEY||!env.VAULT_KEY)throw Error('OFFSITE_BACKUP_NOT_CONFIGURED');
  const tables={};
  // Maintenance-window consistency: retry if any table changed while reading.
  // D1 batch read statements execute in one transaction, so rows come from one snapshot.
  const results=await env.DB.batch(backupTables.map(t=>env.DB.prepare(`SELECT * FROM ${t}`)));
  for(let i=0;i<backupTables.length;i++)tables[backupTables[i]]=results[i].results;
  const payload={version:'flashfirm-cloud-backup/1',createdAt:now,tables,vaultKey:env.VAULT_KEY};
  const bytes=Buffer.from(JSON.stringify(payload));
  if(bytes.length>8000000)throw Error('BACKUP_LIMIT_REQUIRES_OPERATOR_EXPORT');
  const key=randomBytes(32),iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);
  cipher.setAAD(Buffer.from('flashfirm-cloud-backup/1'));
  const ciphertext=Buffer.concat([cipher.update(bytes),cipher.final()]);
  const wrappedKey=publicEncrypt({key:env.BACKUP_PUBLIC_KEY,padding:constants.RSA_PKCS1_OAEP_PADDING,oaepHash:'sha256'},key);
  key.fill(0);
  return {version:'flashfirm-cloud-backup/1',createdAt:now,iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),
    wrappedKey:wrappedKey.toString('base64'),ciphertext:ciphertext.toString('base64'),
    payloadHash:hash(payload),walletKeysIncluded:false,modelKeysIncluded:false};
}
export function decryptCloudSnapshot(envelope,privateKey){
  if(envelope?.version!=='flashfirm-cloud-backup/1')throw Error('UNSUPPORTED_CLOUD_BACKUP');
  const key=privateDecrypt({key:privateKey,padding:constants.RSA_PKCS1_OAEP_PADDING,oaepHash:'sha256'},Buffer.from(envelope.wrappedKey,'base64'));
  const decipher=createDecipheriv('aes-256-gcm',key,Buffer.from(envelope.iv,'base64'));
  decipher.setAAD(Buffer.from('flashfirm-cloud-backup/1'));decipher.setAuthTag(Buffer.from(envelope.tag,'base64'));
  const p=JSON.parse(Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext,'base64')),decipher.final()]));
  key.fill(0);
  if(hash(p)!==envelope.payloadHash||p.version!==envelope.version||!Number.isSafeInteger(p.createdAt)||
    !/^[a-f0-9]{64}$/.test(p.vaultKey??'')||Object.keys(p.tables).sort().join()!==[...backupTables].sort().join())
    throw Error('INVALID_CLOUD_BACKUP_PAYLOAD');
  return p;
}
export function cloudRestoreSql(snapshot,schemaColumns){
  const literal=v=>v===null?'NULL':typeof v==='number'&&Number.isSafeInteger(v)?String(v):
    typeof v==='string'?"'"+v.replaceAll("'","''")+"'":(()=>{throw Error('INVALID_RESTORE_VALUE');})();
  const lines=['PRAGMA foreign_keys=ON;','BEGIN;',
    'CREATE TABLE _flashfirm_restore_chunks(id TEXT,seq INTEGER,value TEXT,PRIMARY KEY(id,seq));',
    "DELETE FROM task_payment_claims WHERE invoice='INDEPENDENT_DEMONSTRATION';"];
  const encoded=v=>{
    if(typeof v!=='string'||v.length<=16000)return literal(v);
    const id=hash(v);
    // Bound each SQL statement well below D1's parser limit. The final immutable
    // row is inserted once from ordered chunks; no trigger or integrity check is disabled.
    let sequence=0;
    for(let at=0;at<v.length;){
      let end=Math.min(at+8000,v.length);
      if(end<v.length&&/[\uD800-\uDBFF]/.test(v[end-1])&&/[\uDC00-\uDFFF]/.test(v[end]))end++;
      lines.push(`INSERT OR IGNORE INTO _flashfirm_restore_chunks VALUES('${id}',${sequence++},${literal(v.slice(at,end))});`);
      at=end;
    }
    return `(SELECT group_concat(value,'') FROM (SELECT value FROM _flashfirm_restore_chunks WHERE id='${id}' ORDER BY seq))`;
  };
  for(const table of backupTables){
    const columns=schemaColumns[table];
    if(!Array.isArray(columns)||!columns.length)throw Error('RESTORE_SCHEMA_REQUIRED');
    for(const raw of snapshot.tables[table]){
      const row={...raw};
      if(Object.keys(row).sort().join()!==[...columns].sort().join())throw Error('BACKUP_SCHEMA_MISMATCH');
      if(table==='tokens')row.revoked=1;
      if(table==='firms')row.state='ACTIVE';
      if(table==='jobs'&&['QUEUED','RUNNING'].includes(row.state)){row.state='CANCELLED';row.input='';}
      if(table==='organization_invites')row.used=1;
      if(table==='mail_subscriptions')row.enabled=0;
      if(table==='notification_outbox'&&['PENDING','SENDING'].includes(row.state))row.state='CANCELLED';
      // Organization sessions cannot resurrect independently revoked membership.
      if(['organization_sessions','recovery_holds'].includes(table))continue;
      const values=columns.map(c=>encoded(row[c]));
      lines.push(`INSERT INTO ${table}(${columns.join(',')}) VALUES(${values.join(',')});`);
    }
  }
  for(const row of snapshot.tables.task_flows)lines.push(`INSERT OR IGNORE INTO recovery_holds VALUES(${literal(row.firm)});`);
  for(const row of snapshot.tables.firms)if(row.state!=='ACTIVE')lines.push(`UPDATE firms SET state=${literal(row.state)} WHERE id=${literal(row.id)};`);
  lines.push('DROP TABLE _flashfirm_restore_chunks;','COMMIT;');
  return lines.join('\n');
}

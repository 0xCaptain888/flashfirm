import { DatabaseSync } from 'node:sqlite';
import { randomBytes, createCipheriv, createDecipheriv, createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
const digest = value => createHash('sha256').update(value).digest('hex');
function requireKey(key) { if (!Buffer.isBuffer(key) || key.length !== 32) throw Error('32-byte offline backup key required'); }
export async function createBackup(runtime, outputFile, key) {
  requireKey(key);
  const temp = await mkdtemp(path.join(tmpdir(), 'flashfirm-backup-'));
  let db;
  try {
    db = new DatabaseSync(path.join(runtime, 'workspace.sqlite'), { readOnly: true });
    db.prepare('VACUUM INTO ?').run(path.join(temp, 'snapshot.sqlite')); db.close(); db = null;
    const data = await readFile(path.join(temp, 'snapshot.sqlite')), vaultKey = await readFile(path.join(runtime, 'vault.key'));
    if (vaultKey.length !== 32) throw Error('Invalid vault key');
    const payload = Buffer.from(JSON.stringify({ version: 1, createdAt: new Date().toISOString(), database: data.toString('base64'), vaultKey: vaultKey.toString('base64'), databaseHash: digest(data) }));
    const nonce = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, nonce);
    cipher.setAAD(Buffer.from('flashfirm-backup/1'));
    const ciphertext = Buffer.concat([cipher.update(payload), cipher.final()]);
    await writeFile(outputFile, JSON.stringify({ version: 1, nonce: nonce.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64') }), { flag: 'wx', mode: 0o600 });
    return { status: 'ENCRYPTED_BACKUP_CREATED', databaseHash: digest(data), includesProviderCredentials: false, includesWalletKeys: false };
  } finally { db?.close(); await rm(temp, { recursive: true, force: true }); }
}
export async function restoreBackup(backupFile, freshDirectory, key) {
  requireKey(key);
  const envelope = JSON.parse(await readFile(backupFile, 'utf8'));
  if (envelope.version !== 1) throw Error('Unsupported backup');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.nonce, 'base64'));
  decipher.setAAD(Buffer.from('flashfirm-backup/1')); decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
  const contents = JSON.parse(Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, 'base64')), decipher.final()]));
  const data = Buffer.from(contents.database, 'base64'), vaultKey = Buffer.from(contents.vaultKey, 'base64');
  if (contents.version !== 1 || digest(data) !== contents.databaseHash || vaultKey.length !== 32) throw Error('Corrupted backup payload');
  // Never overwrite a live runtime or its current cumulative spending ledger.
  await mkdir(freshDirectory, { mode: 0o700 });
  await writeFile(path.join(freshDirectory, 'workspace.sqlite'), data, { flag: 'wx', mode: 0o600 });
  await writeFile(path.join(freshDirectory, 'vault.key'), vaultKey, { flag: 'wx', mode: 0o600 });
  const db = new DatabaseSync(path.join(freshDirectory, 'workspace.sqlite'));
  try {
    if (db.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok') throw Error('Restored database failed integrity check');
    // Restored bearer sessions must never resurrect revoked access.
    db.exec('UPDATE tokens SET revoked=1');
    // A historical lease may refer to an already billed call; fail closed.
    db.exec("UPDATE jobs SET state='FAILED',lease=NULL,expires=NULL WHERE state IN ('QUEUED','RUNNING')");
  } finally { db.close(); }
  return { status: 'RESTORE_VERIFIED', sessionsRevoked: true, queuedWorkDisabled: true, paidCallsEnabled: false, note: 'Provider policy and current spending ledger must be reconciled separately before enabling paid work' };
}

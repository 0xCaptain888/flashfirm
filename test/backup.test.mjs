import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { WorkspaceStore } from '../src/workspace-store.mjs';
import { createBackup, restoreBackup } from '../src/backup.mjs';
import { IntegrationLedger } from '../src/integration-ledger.mjs';
import {verifyCaseExport} from '../src/task-case.mjs';
test('encrypted backup restores notes, revokes sessions and refuses overwrite/tampering', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'flashfirm-backup-test-')), vault = randomBytes(32), key = randomBytes(32);
  await writeFile(path.join(dir,'vault.key'),vault);
  const store = new WorkspaceStore(path.join(dir,'workspace.sqlite'),vault), firm=store.create('owner','Test'), token=store.issueToken('owner');
  const note=store.put('owner',firm.id,{text:'confidential source note'});
  const revision=JSON.parse(await readFile(new URL('../evidence/revised-live-receipt.json',import.meta.url),'utf8'));
  store.attachCase('owner',firm.id,revision);
  const reminder=store.notifications('owner',firm.id).items[0];
  store.acknowledge('owner',firm.id,reminder.id);
  const integrations=new IntegrationLedger(store,{routes:{test:{chainId:'0x1',token:'0x'+'1'.repeat(40),recipient:'0x'+'2'.repeat(40),minimumAmount:'1',rpc:()=>{throw Error('No network in backup test');}}},tee:{pcrs:{},rootPem:'mock'}});
  integrations.createDelivery('owner',firm.id,'test');
  const challenge=integrations.challenge('owner',firm.id,{taskDigest:'a'.repeat(64),publicKey:'b'.repeat(64)});
  const archive=path.join(dir,'backup.json');
  await createBackup(dir,archive,key);store.close();
  assert(!String(await readFile(archive)).includes('confidential source note'));
  await assert.rejects(restoreBackup(archive,path.join(dir,'wrong'),randomBytes(32)));
  const restored=path.join(dir,'restored'); await restoreBackup(archive,restored,key);
  const recovered=new WorkspaceStore(path.join(restored,'workspace.sqlite'),vault);
  try {
    assert.equal(recovered.authenticate(token),null);assert.equal(recovered.get('owner',firm.id,note).text,'confidential source note');
    assert.equal(recovered.db.prepare('SELECT used FROM attestation_challenges WHERE nonce=?').get(challenge.nonce).used,1);
    assert.equal(recovered.db.prepare('SELECT state FROM delivery_requests').get().state,'RECONCILIATION_REQUIRED');
    assert.equal(verifyCaseExport(recovered.exportCase('owner',firm.id)).valid,true);
    assert.equal(recovered.notifications('owner',firm.id).unread,0);
  }finally{recovered.close();}
  await assert.rejects(restoreBackup(archive,restored,key),/EEXIST/);
});

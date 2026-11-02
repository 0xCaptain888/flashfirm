import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { WorkspaceStore } from '../src/workspace-store.mjs';
import { createBackup, restoreBackup } from '../src/backup.mjs';
test('encrypted backup restores notes, revokes sessions and refuses overwrite/tampering', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'flashfirm-backup-test-')), vault = randomBytes(32), key = randomBytes(32);
  await writeFile(path.join(dir,'vault.key'),vault);
  const store = new WorkspaceStore(path.join(dir,'workspace.sqlite'),vault), firm=store.create('owner','Test'), token=store.issueToken('owner');
  const note=store.put('owner',firm.id,{text:'confidential source note'});
  const archive=path.join(dir,'backup.json');
  await createBackup(dir,archive,key);store.close();
  assert(!String(await readFile(archive)).includes('confidential source note'));
  await assert.rejects(restoreBackup(archive,path.join(dir,'wrong'),randomBytes(32)));
  const restored=path.join(dir,'restored'); await restoreBackup(archive,restored,key);
  const recovered=new WorkspaceStore(path.join(restored,'workspace.sqlite'),vault);
  try {assert.equal(recovered.authenticate(token),null);assert.equal(recovered.get('owner',firm.id,note).text,'confidential source note');}finally{recovered.close();}
  await assert.rejects(restoreBackup(archive,restored,key),/EEXIST/);
});

import { mkdir, readFile, writeFile, chmod } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { WorkspaceStore } from './workspace-store.mjs';
export async function openStore(runtime) {
  await mkdir(runtime,{recursive:true,mode:0o700});await chmod(runtime,0o700);
  const filename=path.join(runtime,'vault.key');
  try { await writeFile(filename,randomBytes(32),{flag:'wx',mode:0o600}); } catch(e){if(e.code!=='EEXIST')throw e;}
  return new WorkspaceStore(path.join(runtime,'workspace.sqlite'),await readFile(filename));
}

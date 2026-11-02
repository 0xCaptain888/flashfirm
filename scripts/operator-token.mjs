import { writeFile, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { openStore } from '../src/local-store.mjs';
const runtime=process.env.FLASHFIRM_RUNTIME || fileURLToPath(new URL('../.runtime/',import.meta.url));
const store=await openStore(runtime),file=runtime.replace(/\/$/,'')+'/operator-token.txt';
try {
  try{store.revoke((await readFile(file,'utf8')).trim());}catch(e){if(e.code!=='ENOENT')throw e;}
  await writeFile(file,store.issueToken('local-operator')+'\n',{mode:0o600});
  console.log('Operator token saved privately to .runtime/operator-token.txt; valid for 24 hours. Prior token revoked. Never commit this file.');
}finally{store.close();}

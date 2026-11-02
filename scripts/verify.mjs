import { readFile } from 'node:fs/promises';
import { verifyReceipt } from '../src/protocol.mjs';
import { verifyLiveReceipt } from '../src/live.mjs';
try {
  if (!process.argv[2]) throw Error('Usage: npm run verify -- /absolute/path/to/receipt.json');
  const receipt=JSON.parse(await readFile(process.argv[2], 'utf8'));
  const result = receipt?.payload?.version==='flashfirm-live/0.1'?verifyLiveReceipt(receipt):verifyReceipt(receipt);
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.valid ? 0 : 1;
} catch (e) { console.error(e.message); process.exitCode = 1; }

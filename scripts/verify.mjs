import { readFile } from 'node:fs/promises';
import { verifyReceipt } from '../src/protocol.mjs';
import { verifyLiveReceipt } from '../src/live.mjs';
import {verifyReport} from '../src/report-revision.mjs';
import {verifyCaseExport} from '../src/task-case.mjs';
try {
  if (!process.argv[2]) throw Error('Usage: npm run verify -- /absolute/path/to/receipt.json');
  const receipt=JSON.parse(await readFile(process.argv[2], 'utf8'));
  const result = receipt?.payload?.version==='flashfirm-dossier/1'?verifyCaseExport(receipt):
    ['flashfirm-live/0.1','flashfirm-revision/1'].includes(receipt?.payload?.version)?verifyReport(receipt):verifyReceipt(receipt);
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.valid ? 0 : 1;
} catch (e) { console.error(e.message); process.exitCode = 1; }

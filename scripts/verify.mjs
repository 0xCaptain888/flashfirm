import { readFile } from 'node:fs/promises';
import { verifyReceipt } from '../src/protocol.mjs';
try {
  if (!process.argv[2]) throw Error('Usage: npm run verify -- /absolute/path/to/receipt.json');
  const result = verifyReceipt(JSON.parse(await readFile(process.argv[2], 'utf8')));
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.valid ? 0 : 1;
} catch (e) { console.error(e.message); process.exitCode = 1; }

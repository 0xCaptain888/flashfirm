import path from 'node:path';
import {startReviewerConsole} from '../src/reviewer-console.mjs';
const directory=path.resolve(process.argv[2]??'.runtime/my-independent-review');
const consoleService=await startReviewerConsole({directory});
console.log(JSON.stringify({state:'LOCAL_REVIEWER_CONSOLE_READY',url:consoleService.url,
 keyCreated:false,privateKeysShared:false,independenceCertified:false,
 instruction:'Run on the actual reviewer’s own computer. Create their own off-chain key, enroll its public part before the plan, and compare plan/buyer fingerprints through a trusted channel.'}));
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,async()=>{await consoleService.close();process.exit(0);});

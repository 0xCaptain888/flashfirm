import {readFile,writeFile,stat} from 'node:fs/promises';
import {createPrivateKey,createPublicKey} from 'node:crypto';
import {seal} from '../src/protocol.mjs';
const [payloadFile,keyFile,outputFile]=process.argv.slice(2);
if(!payloadFile||!keyFile||!outputFile)throw Error('Usage: node scripts/task-envelope.mjs payload.json existing-offchain-key.pem output.json');
const payload=JSON.parse(await readFile(payloadFile,'utf8'));
if(!['flashfirm-task-plan/1','flashfirm-quality-evaluation/1','flashfirm-task-invoice/1','flashfirm-task-invoice/2',
 'flashfirm-native-settlement/1','flashfirm-native-settlement/2','flashfirm-identity/1',
 'flashfirm-contribution-claim/1','flashfirm-secret-release/1','flashfirm-aci-release/1','flashfirm-aci-runtime-audit/1'].includes(payload.version))
 throw Error('UNSUPPORTED_TASK_ENVELOPE');
const info=await stat(keyFile);
if(!info.isFile()||(info.mode&0o077)||info.size>10000)throw Error('PRIVATE_OFFCHAIN_KEY_FILE_PERMISSIONS_REQUIRED');
const privateKey=createPrivateKey(await readFile(keyFile));
if(privateKey.asymmetricKeyType!=='ed25519')throw Error('EXISTING_ED25519_OFFCHAIN_KEY_REQUIRED');
const key={privateKey,publicKey:createPublicKey(privateKey).export({type:'spki',format:'pem'})};
await writeFile(outputFile,JSON.stringify(seal(payload,key),null,2)+'\n',{flag:'wx',mode:0o600});
console.log('Signed off-chain task envelope saved without replacing an existing file. No wallet request or transaction performed.');

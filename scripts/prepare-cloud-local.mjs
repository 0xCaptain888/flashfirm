import {randomBytes,createHash} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
const root=new URL('../',import.meta.url);await mkdir(new URL('.runtime/cloudflare/',root),{recursive:true,mode:0o700});
const token=randomBytes(32).toString('base64url'),hash=createHash('sha256').update(token).digest('hex');
await writeFile(new URL('cloudflare/.dev.vars',root),`VAULT_KEY=${randomBytes(32).toString('hex')}\n`,{flag:'wx',mode:0o600});
await writeFile(new URL('.runtime/cloudflare/local-test-token.txt',root),token,{flag:'wx',mode:0o600});
await writeFile(new URL('.runtime/cloudflare/local-test-token.sql',root),`INSERT INTO tokens(hash,owner,expires) VALUES('${hash}','local-smoke',${Date.now()+86400000});\n`,{flag:'wx',mode:0o600});
console.log('Isolated local cloud test credentials created, no credential printed. Never deploy .dev.vars.');

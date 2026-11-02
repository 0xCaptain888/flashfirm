import {randomBytes,createHash} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
// Produces a private token and a SQL provisioning file containing only its hash.
// Apply SQL through authenticated Wrangler; never print the bearer credential.
const owner=process.argv[2]??'captain';
if(!/^[a-z0-9-]{1,40}$/.test(owner))throw Error('Simple owner name required');
const dir=new URL('../.runtime/cloudflare/',import.meta.url);await mkdir(dir,{recursive:true,mode:0o700});
const token=randomBytes(32).toString('base64url'),hash=createHash('sha256').update(token).digest('hex'),expires=Date.now()+86400000;
await writeFile(new URL(`${owner}-token.txt`,dir),token,{flag:'wx',mode:0o600});
await writeFile(new URL(`${owner}-token.sql`,dir),`INSERT INTO tokens(hash,owner,expires) VALUES('${hash}','${owner}',${expires});\n`,{flag:'wx',mode:0o600});
console.log(`Created private token and provisioning SQL for ${owner}; expires ${new Date(expires).toISOString()}. Token not printed.`);

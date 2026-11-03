import {randomBytes} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=new URL('../',import.meta.url),dir=new URL('.runtime/cloudflare/',root);
await mkdir(dir,{recursive:true,mode:0o700});
const file=new URL('production-vault.key',dir);
try{await writeFile(file,randomBytes(32).toString('hex'),{flag:'wx',mode:0o600});}
catch(error){if(error.code!=='EEXIST')throw error;}
const key=(await readFile(file,'utf8')).trim();
if(!/^[a-f0-9]{64}$/.test(key))throw Error('Invalid saved vault key; stop without replacing it');
const child=spawn(process.execPath,['cloudflare/node_modules/wrangler/bin/wrangler.js','secret','put','VAULT_KEY','--config','cloudflare/wrangler.jsonc'],{cwd:fileURLToPath(root),stdio:['pipe','inherit','inherit']});
child.stdin.end(key+'\n');
const code=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',resolve);});
if(code!==0)throw Error('Secret provisioning failed; private backup preserved for retry');
console.log('Production vault configured. Private backup preserved; key not printed.');

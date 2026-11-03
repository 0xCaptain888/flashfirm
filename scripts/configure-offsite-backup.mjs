import {generateKeyPairSync,randomBytes} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {hash} from '../src/protocol.mjs';
const dir=new URL('../.runtime/offsite-backup/',import.meta.url);
await mkdir(dir,{recursive:true,mode:0o700});
let credentials;
try{credentials=JSON.parse(await readFile(new URL('setup.json',dir),'utf8'));}
catch(e){
 if(e.code!=='ENOENT')throw e;
 const keys=generateKeyPairSync('rsa',{modulusLength:3072});
 credentials={token:randomBytes(32).toString('base64url'),
  publicKey:keys.publicKey.export({type:'spki',format:'pem'}),privateKey:keys.privateKey.export({type:'pkcs8',format:'pem'})};
 await writeFile(new URL('setup.json',dir),JSON.stringify(credentials),{flag:'wx',mode:0o600});
 await writeFile(new URL('restore-private.pem',dir),credentials.privateKey,{flag:'wx',mode:0o600});
}
if(!process.argv.includes('--apply')){console.log('Offline restore key and separate backup token prepared privately. Add --apply to configure Cloudflare secrets and the repository backup secret.');process.exit();}
async function command(binary,args,value){
 return new Promise((resolve,reject)=>{
  const child=spawn(binary,args,{stdio:['pipe','pipe','pipe'],env:{...process.env,HTTPS_PROXY:process.env.HTTPS_PROXY??'http://127.0.0.1:7897'}});
  child.stdout.resume();child.stderr.resume();
  child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(Error('Backup configuration command failed; no credentials printed.')));
  child.stdin.end(value);
 });
}
const wrangler='cloudflare/node_modules/wrangler/bin/wrangler.js';
for(const [name,value]of [['BACKUP_PUBLIC_KEY',credentials.publicKey],['BACKUP_AUTH_HASH',hash(credentials.token)]])
 await command(process.execPath,[wrangler,'secret','put',name,'--config','cloudflare/wrangler.jsonc'],value);
await command('gh',['secret','set','FLASHFIRM_BACKUP_TOKEN','--repo','0xCaptain888/flashfirm'],credentials.token);
console.log('Cloudflare encryption public key/auth hash and GitHub backup token configured. Private restore key remains in .runtime/offsite-backup/restore-private.pem; copy it to offline storage.');

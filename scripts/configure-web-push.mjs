import webpush from 'web-push';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
const dir=new URL('../.runtime/web-push/',import.meta.url);
await mkdir(dir,{recursive:true,mode:0o700});
let keys;
try{keys=JSON.parse(await readFile(new URL('vapid.json',dir),'utf8'));}
catch(error){
 if(error.code!=='ENOENT')throw error;
 keys={...webpush.generateVAPIDKeys(),subject:'https://github.com/0xCaptain888/flashfirm'};
 await writeFile(new URL('vapid.json',dir),JSON.stringify(keys),{flag:'wx',mode:0o600});
}
if(!process.argv.includes('--apply')){console.log('VAPID keys prepared privately. Add --apply to configure the existing worker. No notification sent.');process.exit();}
for(const [name,value]of [['VAPID_PUBLIC_KEY',keys.publicKey],['VAPID_PRIVATE_KEY',keys.privateKey],['VAPID_SUBJECT',keys.subject],['PUSH_SEND_ENABLED','yes']]){
 await new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,['cloudflare/node_modules/wrangler/bin/wrangler.js','secret','put',name,'--config','cloudflare/wrangler.jsonc'],
   {stdio:['pipe','pipe','pipe'],env:{...process.env,HTTPS_PROXY:process.env.HTTPS_PROXY??'http://127.0.0.1:7897'}});
  child.stdout.resume();child.stderr.resume();child.on('error',reject);
  child.on('exit',code=>code===0?resolve():reject(Error('VAPID_CONFIGURATION_FAILED_NO_KEY_PRINTED')));
  child.stdin.end(value);
 });
}
console.log('VAPID configured for the existing worker. Only verified organization users who opt in can subscribe. No notification sent.');

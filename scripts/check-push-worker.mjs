import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
const child=spawn(process.execPath,['cloudflare/node_modules/wrangler/bin/wrangler.js','dev',
  '--config','test-support/push-worker.wrangler.jsonc','--local','--ip','127.0.0.1','--port','43185'],
  {stdio:['ignore','pipe','pipe']});
let diagnostics='';
child.stdout.on('data',v=>diagnostics+=v);child.stderr.on('data',v=>diagnostics+=v);
child.on('error',()=>{});
try{
 let result;
 for(let i=0;i<30;i++){
  try{
   const response=await fetch('http://127.0.0.1:43185/',{signal:AbortSignal.timeout(1500)});
   if(response.ok){result=await response.json();break;}
  }catch{}
  if(child.exitCode!==null)throw Error('PUSH_COMPATIBILITY_WORKER_EXITED');
  await delay(500);
 }
 assert.equal(result?.encrypted,true);assert.equal(result.vapidSigned,true);assert.equal(result.networkCalls,0);
 await writeFile(new URL('../evidence/push-channel-upgrade.json',import.meta.url),JSON.stringify({
  version:'flashfirm-push-runtime/1',checkedAt:new Date().toISOString(),
  workerCryptoCompatibilityChecked:true,syntheticSubscription:true,
  encryptedPayloadGenerated:true,vapidHeaderGenerated:true,networkCalls:0,realPushSent:false,
  deviceDeliveryVerified:false,scope:'Local Workers runtime encryption/signing compatibility only; no subscribed device or push service was contacted.'
 },null,2)+'\n');
 console.log(JSON.stringify({status:'WORKER_PUSH_CRYPTO_COMPATIBLE',encrypted:true,vapidSigned:true,realPushSent:false}));
}catch(error){console.error(diagnostics);throw error;}
finally{child.kill('SIGTERM');}

import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const base='https://flashfirm-api.fluoridated-rhinoceros.workers.dev';
const token=(await readFile(new URL('../.runtime/cloudflare/captain-token.txt',import.meta.url),'utf8')).trim();
const revoked=(await readFile(new URL('../.runtime/cloudflare/flow-qa-upgrade-1103-token.txt',import.meta.url),'utf8')).trim();
const get=async(path,credential)=>{
 const response=await fetch(base+path,{redirect:'error',signal:AbortSignal.timeout(20000),
  headers:credential?{Authorization:'Bearer '+credential}:{}});
 assert.equal(response.status,200);return response.json();
};
const health=await get('/healthz'),operations=await get('/api/workspaces/operations',token);
assert.equal(health.status,'READY');assert.equal(health.storage,'D1');assert.equal(health.paidCallsEnabled,false);
assert.equal(operations.offsiteExportConfigured,true);assert.equal(operations.cloudPushConfigured,true);
assert.equal(operations.identityProviderConfigured,false);assert.equal(operations.emailConfigured,false);
assert.equal(operations.mainnetAutomaticSigning,false);assert.equal(operations.teeInstanceEnabled,false);
assert.equal((await fetch(base+'/api/workspaces',{redirect:'error',signal:AbortSignal.timeout(20000),
 headers:{Authorization:'Bearer '+revoked}})).status,401);
const config=await get('/api/workspaces/push-config',token);
assert.equal(config.configured,false);assert.equal(config.reason,'VERIFIED_ORGANIZATION_IDENTITY_REQUIRED');
const worker=await fetch(base+'/push-worker.js',{redirect:'error',signal:AbortSignal.timeout(20000)});
assert.equal(worker.status,200);assert((await worker.text()).includes('push'));
const proof={version:'flashfirm-public-operations/1',checkedAt:new Date().toISOString(),endpoint:base,
 storage:'D1',healthReady:true,offsiteExportConfigured:true,backgroundPushKeysConfigured:true,
 legacyTokenPushSubscriptionBlocked:true,revokedQaTokenRejected:true,pushWorkerServed:true,
 organizationLoginConfigured:false,emailConfigured:false,paidCallsEnabled:false,teeInstanceEnabled:false,
 mainnetAutomaticSigning:false,realPushSent:false,deviceDeliveryVerified:false,
 scope:'Read-only public deployment check. No device subscription, notification, model call or financial transaction.'};
await writeFile(new URL('../evidence/public-operations-upgrade.json',import.meta.url),JSON.stringify(proof,null,2)+'\n');
console.log(JSON.stringify(proof));

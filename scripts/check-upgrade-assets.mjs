import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
if(process.env.FLASHFIRM_USE_SYSTEM_PROXY==='1'){
 const {ProxyAgent,setGlobalDispatcher}=await import('../cloudflare/node_modules/undici/index.js');
 setGlobalDispatcher(new ProxyAgent('http://127.0.0.1:7897'));
}
const targets=process.argv.includes('--pages')?[
 ['https://0xcaptain888.github.io/flashfirm/delivery.html','dist/delivery.html'],
 ['https://0xcaptain888.github.io/flashfirm/revised-live-receipt.json','dist/revised-live-receipt.json'],
 ['https://0xcaptain888.github.io/flashfirm/cloudflare-case-upgrade.json','dist/cloudflare-case-upgrade.json']
]:[
 ['https://flashfirm-api.fluoridated-rhinoceros.workers.dev/workspace.js','web/workspace.js'],
 ['https://flashfirm-api.fluoridated-rhinoceros.workers.dev/operations.css','web/operations.css'],
 ['https://flashfirm-api.fluoridated-rhinoceros.workers.dev/revised-live-receipt.json','evidence/revised-live-receipt.json']
];
const checks=[],sha=v=>createHash('sha256').update(v).digest('hex');
for(const [url,file]of targets){
 const response=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(20000),headers:{'Cache-Control':'no-cache'}});
 if(!response.ok)throw Error(`UPGRADE_ASSET_HTTP_${response.status}:${file}`);
 const actual=sha(Buffer.from(await response.arrayBuffer())),expected=sha(await readFile(file));
 if(actual!==expected)throw Error('DEPLOYED_ASSET_MISMATCH:'+file);
 checks.push({file,sha256:actual});
}
console.log(JSON.stringify({status:'DEPLOYED_UPGRADE_ASSETS_MATCH',target:process.argv.includes('--pages')?'GITHUB_PAGES':'CLOUDFLARE',checks,paidCalls:0}));

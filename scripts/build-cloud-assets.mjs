import {mkdir,readFile,writeFile,copyFile} from 'node:fs/promises';
const root=new URL('../',import.meta.url),out=new URL('../.runtime/cloud-assets/',import.meta.url);
await mkdir(new URL('api/',out),{recursive:true});
for(const file of ['workspace.js','push-worker.js','style.css','operations.css','favicon.svg','review-guide.html'])await copyFile(new URL('web/'+file,root),new URL(file,out));
let html=await readFile(new URL('web/workspace.html',root),'utf8');
html=html.replace('Local development','Cloudflare free preview').replace('LOCAL · PAID RUNS REQUIRE EXPLICIT ACTION','PUBLIC BACKEND · PAID MODEL CALLS DISABLED').replace('Run a bounded source review, verify its evidence, and keep a durable activity trail.','Verify signed evidence, save encrypted notes and retain task history in D1. Paid AI runs are disabled.').replace('Run <code>npm run operator:token</code>, then paste the token from <code>.runtime/operator-token.txt</code>. It expires in 24 hours and stays only in this page\'s memory.','Use your separately issued workspace access token. It expires and stays only in this page’s memory. Do not share it publicly.').replace('AES-256-GCM encryption on this computer.','AES-256-GCM encryption before D1 storage. The service operator holds the encryption key.').replace('href="/treasury.html"','href="https://0xcaptain888.github.io/flashfirm/treasury.html"').replace('href="/"','href="https://0xcaptain888.github.io/flashfirm/"');
html=html.replace('href="/live.html"','href="https://0xcaptain888.github.io/flashfirm/live.html"')
 .replace('href="/">Sample console','href="https://0xcaptain888.github.io/flashfirm/">Sample console')
 .replace('Local operations · no automatic wallet transactions','Cloud workspace · no automatic wallet transactions')
 .replace('<h3>Analyze approved public sources</h3>','<h3>Recorded AI development budget</h3>')
 .replace('Three specialist calls and one same-provider critique of pinned OpenZeppelin sources. This is a paid model run, not independent review. Private notes are never sent to the model by this action.','New paid AI runs are disabled in this cloud workspace. You can verify an existing signed AI report below. The recorded local budget is a historical snapshot.')
 .replace('Run public-source AI review</button>','Paid AI runs disabled</button>')
 .replace('maxlength="100000"','maxlength="10000"')
 .replace('An already dispatched model request can still incur cost. Retains audit metadata and partial public-source outputs.','Retains audit metadata and verification results.');
await writeFile(new URL('index.html',out),html);
await writeFile(new URL('workspace.html',out),html);
await copyFile(new URL('evidence/queued-live-receipt.json',root),new URL('api/live-receipt',out));
await copyFile(new URL('evidence/revised-live-receipt.json',root),new URL('revised-live-receipt.json',out));
await writeFile(new URL('_headers',out),'/*\n  Cache-Control: no-store\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: no-referrer\n  Content-Security-Policy: default-src \'self\'; script-src \'self\'; style-src \'self\'; connect-src \'self\'; img-src \'self\' data:; frame-ancestors \'none\'; base-uri \'none\'\n/api/live-receipt\n  Content-Type: application/json\n');
console.log('Cloud assets prepared; only public evidence included.');

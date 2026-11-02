import { mkdir, writeFile, copyFile, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { Engine, createTask } from '../src/engine.mjs';
import { verifyReceipt } from '../src/protocol.mjs';
import { verifyLiveReceipt } from '../src/live.mjs';
import './build-wallet.mjs';

const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const out=path.join(root,'dist');
const engine=new Engine();
const task=createTask({title:'ExampleCo · sample recovery',budget:1000,fault:true});
while(task.state!=='PLANNED')engine.advance(task);
if(!verifyReceipt(task.receipt).valid)throw Error('Refusing to publish invalid sample');
const p=task.receipt.payload;
const money=n=>`$${(n/100).toFixed(2)}`;
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
await mkdir(out,{recursive:true});
await copyFile(path.join(root,'web/favicon.svg'),path.join(out,'favicon.svg'));
await writeFile(path.join(out,'.nojekyll'),'');
await writeFile(path.join(out,'receipt.json'),JSON.stringify(task.receipt,null,2));
await copyFile(path.join(root,'web/style.css'),path.join(out,'style.css'));
for (const file of ['treasury.html', 'treasury.bundle.js', 'treasury.bundle.js.LEGAL.txt', 'operations.css']) await copyFile(path.join(root,'web',file),path.join(out,file));
// Content-address the wallet assets so cached scripts cannot lag behind new HTML.
let treasuryHtml = await readFile(path.join(out, 'treasury.html'), 'utf8');
for (const file of ['treasury.bundle.js', 'operations.css', 'style.css']) {
  const bytes = await readFile(path.join(out, file));
  const digest = createHash('sha256').update(bytes).digest('hex').slice(0, 16);
  const versioned = file.replace(/(\.[^.]+)$/, `.${digest}$1`);
  await writeFile(path.join(out, versioned), bytes);
  treasuryHtml = treasuryHtml.replaceAll(`./${file}`, `./${versioned}`);
}
await writeFile(path.join(out, 'treasury.html'), treasuryHtml);
await writeFile(path.join(out,'index.html'),`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>FlashFirm — Proof before payout</title><link rel="icon" href="./favicon.svg"><link rel="stylesheet" href="./style.css"></head><body><aside class="sidebar"><a class="brand" href="./"><span class="brand-icon">ϟ</span>FlashFirm<span class="beta">PREVIEW</span></a><div class="workspace">Public sample evidence</div><nav><a class="nav active" href="#outcome">Task outcome</a><a class="nav" href="#allocation">Contribution allocation</a><a class="nav" href="#evidence">Verify evidence</a></nav><div class="side-bottom">Static preview<small>No connected model or wallet</small></div></aside><main><header><div class="breadcrumb">FlashFirm / Public preview</div><span class="mode">BUILD-TIME SNAPSHOT</span></header><div class="notice">Synthetic public inputs · Fixture workers · No funds moved · No live backend</div><section id="outcome"><div class="hero"><div><p class="eyebrow">ONE OUTCOME. THE RIGHT TEAM.</p><h1>Great work.<br><span>Accounted for.</span></h1><p class="intro">A failed agent should not make the whole team fail.<br>Inspect how FlashFirm replaces bad evidence and allocates value.</p></div></div><div class="panel"><h2>ExampleCo technical due diligence</h2><p class="muted">This snapshot was generated during the website build. It is not a live AI run. The source checker rejected a fabricated citation, the reserve worker filled the missing role, and the allocation plan was signed. NEAR settlement remains unconnected.</p><div class="metrics"><div class="metric"><span class="mini-label">SAMPLE BUDGET</span><strong>$10.00</strong></div><div class="metric"><span class="mini-label">ACCEPTED WORK</span><strong>03</strong></div><div class="metric"><span class="mini-label">REJECTED WORK</span><strong>01</strong></div><div class="metric"><span class="mini-label">SETTLEMENT</span><strong>Not executed</strong></div></div></div></section><section class="panel allocation" id="allocation"><h2>Value, made visible.</h2><p class="muted">Coverage lost when each contribution is removed. This fixture metric does not establish real-world quality or fair market compensation.</p><table><thead><tr><th>Worker</th><th>Marginal coverage</th><th>Planned share</th></tr></thead><tbody>${p.scores.map(s=>`<tr><td>${escape(s.id.split(':')[0])}${s.eligible?'':' · rejected'}</td><td>${s.marginal} points</td><td>${money(p.allocation.payouts.find(r=>r.id===s.id).amount)}</td></tr>`).join('')}<tr><td>Protocol fee</td><td>2%</td><td>${money(p.allocation.fee)}</td></tr></tbody></table></section><section class="panel allocation" id="evidence"><h2>Verify, don't assume.</h2><p class="muted">The receipt contains signed work, source hashes, score inputs and exact integer allocation. All signing identities in this sample are controlled by one local coordinator. No TEE, external identity or blockchain transaction is certified.</p><a class="button primary" href="./receipt.json" download="flashfirm-sample-receipt.json">Download signed sample ↓</a><p class="muted">With the FlashFirm repository checked out locally, run:</p><pre>npm run verify -- /path/to/flashfirm-sample-receipt.json</pre><details><summary>Evidence identifiers</summary><pre>Task: ${task.id}\nWork root: ${p.workRoot}\nBuild time: ${task.createdAt}</pre></details></section><section class="panel allocation"><h2>Run the interactive console locally</h2><p class="muted">GitHub Pages hosts this static preview. Creating tasks, model calls, private data storage and transaction coordination require a separate backend. No API key belongs in this site.</p><pre>npm start\n# Open http://127.0.0.1:43180</pre></section><footer>FlashFirm <span>Proof before payout.</span><span>Development preview · v0.1.0</span></footer></main></body></html>`);
console.log(JSON.stringify({status:'STATIC_PREVIEW_BUILT',directory:out,mode:'BUILD_TIME_FIXTURE',receiptVerified:true,paidCalls:0}));
const live=JSON.parse(await readFile(path.join(root,'evidence/live-review.json'),'utf8'));
if(!verifyLiveReceipt(live.receipt).valid)throw Error('Public live receipt failed verification');
await copyFile(path.join(root,'evidence/live-review.json'),path.join(out,'live-review.json'));
await copyFile(path.join(root,'evidence/live-receipt.json'),path.join(out,'live-receipt.json'));
await copyFile(path.join(root,'evidence/sandbox.json'),path.join(out,'sandbox.json'));
for (const file of ['testnet-config.json', 'testnet-deployment.json']) await copyFile(path.join(root, 'evidence', file), path.join(out, file));
await copyFile(path.join(root,'web/live.js'),path.join(out,'live.js'));
const liveHtml=(await readFile(path.join(root,'web/live.html'),'utf8')).replaceAll('href="/','href="./').replaceAll('src="/','src="./').replace('<body>','<body data-static="true">');
await writeFile(path.join(out,'live.html'),liveHtml);
const index=(await readFile(path.join(out,'index.html'),'utf8')).replace('NEAR settlement remains unconnected.', 'This sample is not settled. A separate testnet treasury is deployed; buyer payment remains pending.');
await writeFile(path.join(out,'index.html'),index.replace('<section id="outcome">','<section class="panel allocation"><h2>Inspect a real model run</h2><p class="muted">Recorded DeepSeek analysis of pinned OpenZeppelin sources. Public quotations, signed outputs and critique history. Viewing makes no paid calls.</p><a class="button primary" href="./live.html">Open real AI evidence ↗</a> <a class="button secondary" href="./sandbox.json">NEAR sandbox test evidence ↗</a> <a class="button secondary" href="./treasury.html">Testnet wallet console ↗</a><p class="muted">The wallet console requires your public deployment configuration. No treasury or real payment is preconfigured.</p></section><section id="outcome">'));

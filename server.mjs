import http from 'node:http';
import { readFile, writeFile, mkdir, rename, chmod } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Engine, createTask, agents } from './src/engine.mjs';
import { verifyReceipt, rubric } from './src/protocol.mjs';
import { verifyLiveReceipt } from './src/live.mjs';
import { openStore } from './src/local-store.mjs';
import { commitPolicy, assessReview, resolveAppeal, selectSignedOffers } from './src/governance.mjs';
import { scoreContributions } from './src/contribution.mjs';
import { executeLiveJob, modelAvailability } from './src/live-job.mjs';
import { serverPolicy } from './src/server-policy.mjs';
import { verifyReviewerBinding } from './src/reviewer-binding.mjs';
import { IntegrationLedger } from './src/integration-ledger.mjs';
import { loadIntegrationConfig } from './src/integration-config.mjs';
import { verifyReport } from './src/report-revision.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const policy = serverPolicy();
const runtime = process.env.FLASHFIRM_RUNTIME || path.join(root, '.runtime');
await mkdir(runtime, { recursive: true, mode: 0o700 });
await chmod(runtime, 0o700);
const store=await openStore(runtime);
const integrations=new IntegrationLedger(store,await loadIntegrationConfig(process.env.FLASHFIRM_INTEGRATION_CONFIG));
const limiter=new Map();
let workerBusy=false;
let workerLastTick=Date.now(), shuttingDown=false;
const worker=setInterval(async ()=>{
  if(workerBusy||shuttingDown)return;workerBusy=true;workerLastTick=Date.now();
  try {
    const job=store.claim();if(!job)return;
    try {
      const receipt=job.input.receipt;
      const result=job.input.kind==='LIVE_PUBLIC_REVIEW' ? await executeLiveJob(store,job,runtime) : ['flashfirm-live/0.1','flashfirm-revision/1'].includes(receipt?.payload?.version)?verifyReport(receipt):verifyReceipt(receipt);
      store.finish(job.id,job.lease,result);
    }catch(error){store.finish(job.id,job.lease,{error:/^[A-Z0-9_]+$/.test(error.message)?error.message:'Job failed; inspect local configuration and retained partial work'},true);}
  }catch(error){console.error('Background verifier failed:',error.code??'INTERNAL_ERROR');}
  finally{workerBusy=false;}
},500);
worker.unref();
const readJson = async name => { try { return JSON.parse(await readFile(path.join(runtime, name), 'utf8')); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } };
const save = async (name, value) => { const target = path.join(runtime, name); await writeFile(target + '.tmp', JSON.stringify(value), { mode: 0o600 }); await rename(target + '.tmp', target); };
const engine = new Engine(await readJson('identities.json'));
await save('identities.json', engine.keys);
const tasks = new Map((await readJson('tasks.json') ?? []).map(t => [t.id, t]));
let mutation = Promise.resolve();
const exclusive = fn => { const next = mutation.then(fn); mutation = next.catch(() => {}); return next; };
const send = (res, code, body) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); };
const body = async req => { let value = ''; for await (const chunk of req) { value += chunk; if (Buffer.byteLength(value) > 500000) throw Error('Request too large'); } return JSON.parse(value || '{}'); };
const port = policy.port;
const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self' https://rpc.testnet.near.org; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  try {
    const host = req.headers.host;
    if (!policy.hosts.includes(host)) return send(res, 403, { error: 'Host denied' });
    if (req.headers.origin && !policy.origins.includes(req.headers.origin)) return send(res, 403, { error: 'Origin denied' });
    const url = new URL(req.url, `http://${host}`);
    if(req.method==='GET'&&url.pathname==='/healthz') {
      const healthy=!shuttingDown&&(workerBusy||Date.now()-workerLastTick<10000);
      try { store.db.prepare('SELECT 1').get(); } catch { return send(res,503,{status:'UNAVAILABLE'}); }
      return send(res,healthy?200:503,{status:healthy?'READY':'DRAINING',workerBusy});
    }
    if(url.pathname.startsWith('/api/workspaces')) {
      const token=req.headers.authorization?.replace(/^Bearer /,'');
      const owner=store.authenticate(token);
      if(!owner)return send(res,401,{error:'Valid operator token required'});
      const now=Date.now(),window=limiter.get(owner);
      if(!window||window.until<=now)limiter.set(owner,{until:now+60000,count:1});
      else if(++window.count>120){res.setHeader('Retry-After','60');return send(res,429,{error:'Request limit reached'});}
      if(req.method==='GET'&&url.pathname==='/api/workspaces/model-status')return send(res,200,await modelAvailability(runtime));
      if(req.method==='GET'&&url.pathname==='/api/workspaces/integration-status')return send(res,200,integrations.status());
      const casePath=url.pathname.match(/^\/api\/workspaces\/([a-f0-9-]+)\/(case|case-export|notifications)(?:\/([a-f0-9]{64}))?$/);
      if(casePath){
        const [,firm,action,id]=casePath;
        if(req.method==='GET'&&!id&&action==='case')return send(res,200,store.case(owner,firm));
        if(req.method==='POST'&&!id&&action==='case')return send(res,201,store.attachCase(owner,firm,(await body(req)).receipt));
        if(req.method==='GET'&&!id&&action==='case-export')return send(res,200,store.exportCase(owner,firm));
        if(req.method==='GET'&&!id&&action==='notifications')return send(res,200,store.notifications(owner,firm));
        if(req.method==='POST'&&id&&action==='notifications')return send(res,200,store.acknowledge(owner,firm,id));
        return send(res,404,{error:'Unknown task case operation'});
      }
      const integrationPath=url.pathname.match(/^\/api\/workspaces\/([a-f0-9-]+)\/(deliveries|attestations)(?:\/([a-f0-9-]+))?$/);
      if(integrationPath){
        const [,firmId,kind,id]=integrationPath;
        if(kind==='deliveries'){
          if(req.method==='GET'&&!id)return send(res,200,integrations.deliveries(owner,firmId));
          if(req.method==='POST'){const input=await body(req);return send(res,id?200:201,id?await integrations.verifyDelivery(owner,firmId,id,input.hash):integrations.createDelivery(owner,firmId,input.routeId));}
        }
        if(kind==='attestations'&&req.method==='POST'){
          const input=await body(req);
          if(!id)return send(res,201,integrations.challenge(owner,firmId,input));
          if(typeof input.document!=='string'||input.document.length>43692||! /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input.document))throw Error('INVALID_DOCUMENT');
          return send(res,200,await integrations.attest(owner,firmId,id,Buffer.from(input.document,'base64')));
        }
        return send(res,404,{error:'Unknown integration operation'});
      }
      if(req.method==='POST'&&url.pathname==='/api/workspaces/reviewer-challenge')return send(res,201,store.reviewerChallenge(owner,await body(req),policy.public?policy.origins[0]:'https://flashfirm.local'));
      if(req.method==='POST'&&url.pathname==='/api/workspaces/reviewer-revoke')return send(res,200,store.revokeReviewer(owner,await body(req)));
      if(req.method==='POST'&&url.pathname==='/api/workspaces/reviewer-recheck')return send(res,200,await store.recheckReviewer(owner,await body(req)));
      if(url.pathname==='/api/workspaces/reviewer-bindings'){
        if(req.method==='GET')return send(res,200,store.reviewerBindings(owner));
        if(req.method==='POST')return send(res,201,await store.bindReviewer(owner,await body(req)));
      }
      if(req.method==='POST'&&url.pathname==='/api/workspaces/evaluate'){
        const input=await body(req);let result;
        switch(input.operation){
          case 'COMMIT_POLICY':result=commitPolicy(input.policy);break;
          case 'REVIEW':result=assessReview(input.commitment,input.resultRoot,input.decisions,Date.now());break;
          case 'APPEAL':result=resolveAppeal(input.commitment,input.resultRoot,input.decisions,input.appeal,input.resolution,Date.now());break;
          case 'SELECT_TEAM':result=selectSignedOffers({...input.tender,now:Date.now()});break;
          case 'SCORE':result=scoreContributions(input.scoring);break;
          case 'VERIFY_REVIEWER_BINDING':result=await verifyReviewerBinding(input.binding,input.expected);break;
          default:throw Error('Unknown evaluation operation');
        }
        return send(res,200,{result,settlementExecuted:false,scope:'Stateless validation of supplied commitments; no external identity certification or transaction authorization'});
      }
      if(url.pathname==='/api/workspaces') {
        if(req.method==='GET')return send(res,200,store.list(owner));
        if(req.method==='POST')return send(res,201,store.create(owner,(await body(req)).title));
      }
      const m=url.pathname.match(/^\/api\/workspaces\/([a-f0-9-]+)(?:\/(events|documents|jobs|dissolve|review|decision|appeal|resolution)(?:\/([a-f0-9-]+))?)?$/);
      if(m) {
        const [,id,action,item]=m;
        if(req.method==='GET'&&!action)return send(res,200,store.access(owner,id));
        if(action==='review'&&!item){
          if(req.method==='GET')return send(res,200,store.review(owner,id));
          if(req.method==='POST'){const input=await body(req);return send(res,201,store.pinReview(owner,id,input.policy,input.resultRoot));}
        }
        if(req.method==='POST'&&!item&&['decision','appeal','resolution'].includes(action)){
          const input=await body(req),operation={decision:'decide',appeal:'appeal',resolution:'resolve'}[action];return send(res,200,store[operation](owner,id,input));
        }
        if(req.method==='GET'&&action==='events')return send(res,200,store.events(owner,id));
        if(req.method==='POST'&&action==='documents'&&!item)return send(res,201,{id:store.put(owner,id,await body(req))});
        if(req.method==='GET'&&action==='documents'&&item)return send(res,200,store.get(owner,id,item));
        if(req.method==='POST'&&action==='jobs'&&!item)return send(res,202,store.enqueue(owner,id,req.headers['idempotency-key'],await body(req)));
        if(req.method==='GET'&&action==='jobs'&&!item)return send(res,200,store.jobs(owner,id));
        if(req.method==='GET'&&action==='jobs'&&item)return send(res,200,store.job(owner,id,item));
        if(req.method==='POST'&&action==='dissolve'&&!item)return send(res,200,store.dissolve(owner,id));
      }
      return send(res,404,{error:'Unknown workspace operation'});
    }
    if(req.method==='GET'&&['/api/live-review','/api/live-receipt'].includes(url.pathname)){
      let receipt=await readJson('live-review.json');
      let recordedBudget=null;
      if(!receipt){try{const exported=JSON.parse(await readFile(path.join(root,'evidence/live-review.json'),'utf8'));receipt=exported.receipt;recordedBudget=exported.budget;}catch(e){if(e.code!=='ENOENT')throw e;}}
      if(!receipt)return send(res,404,{error:'No completed live model review yet'});
      const verification=verifyLiveReceipt(receipt);
      if(!verification.valid)return send(res,409,{error:'Live receipt integrity check failed',verification});
      if(url.pathname==='/api/live-receipt'){res.setHeader('Content-Disposition','attachment; filename="flashfirm-live-receipt.json"');return send(res,200,receipt);}
      const budget=await readJson('provider-budget.json');
      return send(res,200,{receipt,verification,budget:recordedBudget??{capCny:20,reservedCny:(budget?.reservedFen??0)/100,calls:budget?.calls?.length??0,actualInvoiceCost:null}});
    }
    if (req.method === 'GET' && url.pathname === '/api/status') return send(res, 200, { version: '0.1.0', mode: 'LOCAL_FIXTURE', agents, rubric, capabilities: { signatures: true, persistentTasks: true, liveAgents: false, recordedLiveReview: !!(await readJson('live-review.json')), nearSettlement: false, tee: false, independentQuorum: false } });
    if (policy.public && url.pathname.startsWith('/api/tasks')) return send(res,403,{error:'Use authenticated workspaces; local fixture storage is not public'});
    if (req.method === 'GET' && url.pathname === '/api/tasks') return send(res, 200, [...tasks.values()].reverse());
    // The public service must not expose unauthenticated mutable demo storage.
    if (req.method === 'POST' && url.pathname === '/api/tasks') {
      const input = await body(req);
      return await exclusive(async () => { if (tasks.size >= 200) return send(res, 409, { error: 'Local task limit reached (200)' }); const t = createTask(input); tasks.set(t.id, t); await save('tasks.json', [...tasks.values()]); send(res, 201, t); });
    }
    if (req.method === 'POST' && url.pathname === '/api/verify') return send(res, 200, verifyReceipt(await body(req)));
    const match = url.pathname.match(/^\/api\/tasks\/([a-f0-9-]+)(?:\/(advance|receipt))?$/);
    if (match) {
      if (!tasks.has(match[1])) return send(res, 404, { error: 'Task not found' });
      if (req.method === 'POST' && match[2] === 'advance') return await exclusive(async () => {
        const t = structuredClone(tasks.get(match[1])); engine.advance(t); tasks.set(t.id, t); await save('tasks.json', [...tasks.values()]); send(res, 200, t);
      });
      const t = tasks.get(match[1]);
      if (req.method === 'GET' && match[2] === 'receipt') {
        if (!t.receipt) return send(res, 409, { error: 'Receipt not ready' });
        res.setHeader('Content-Disposition', `attachment; filename="flashfirm-${t.id}.json"`); return send(res, 200, t.receipt);
      }
      if (req.method === 'GET' && !match[2]) return send(res, 200, t);
    }
    const staticFiles = { '/': ['index.html','text/html'], '/live.html':['live.html','text/html'], '/live.js':['live.js','text/javascript'], '/app.js': ['app.js','text/javascript'], '/style.css': ['style.css','text/css'], '/favicon.svg': ['favicon.svg','image/svg+xml'] };
    staticFiles['/workspace.html']=['workspace.html','text/html'];
    staticFiles['/workspace.js']=['workspace.js','text/javascript'];
    staticFiles['/operations.css']=['operations.css','text/css'];
    staticFiles['/revised-live-receipt.json']=['../evidence/revised-live-receipt.json','application/json'];
    staticFiles['/treasury.html']=['treasury.html','text/html'];
    staticFiles['/treasury.bundle.js']=['treasury.bundle.js','text/javascript'];
    staticFiles['/treasury.bundle.js.LEGAL.txt']=['treasury.bundle.js.LEGAL.txt','text/plain'];
    if (req.method === 'GET' && staticFiles[url.pathname]) {
      const [file, type] = staticFiles[url.pathname]; res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' }); return res.end(await readFile(path.join(root, 'web', file)));
    }
    send(res, 404, { error: 'Not found' });
  } catch (error) { send(res, 400, { error: policy.public ? 'Request rejected; check input and authorization' : error.message }); }
});
server.requestTimeout=30000;server.headersTimeout=15000;
server.listen(port, policy.host, () => console.log(`FlashFirm ${policy.public?'managed':'local'} service on port ${port}`));
for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>{
  shuttingDown=true;clearInterval(worker);server.close();
  const drain=setInterval(()=>{if(!workerBusy){clearInterval(drain);store.close();process.exit(0);}},250);
  setTimeout(()=>process.exit(1),110000).unref();
});

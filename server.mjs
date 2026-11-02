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

const root = path.dirname(fileURLToPath(import.meta.url));
const runtime = path.join(root, '.runtime');
await mkdir(runtime, { recursive: true, mode: 0o700 });
await chmod(runtime, 0o700);
const store=await openStore(runtime);
const limiter=new Map();
let workerBusy=false;
const worker=setInterval(()=>{
  if(workerBusy)return;workerBusy=true;
  try {
    const job=store.claim();if(!job)return;
    try {
      const receipt=job.input.receipt;
      const result=receipt?.payload?.version==='flashfirm-live/0.1'?verifyLiveReceipt(receipt):verifyReceipt(receipt);
      store.finish(job.id,job.lease,result);
    }catch{store.finish(job.id,job.lease,{error:'Receipt verification failed'},true);}
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
const port = Number(process.env.PORT || 43180);
const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  try {
    const host = req.headers.host;
    if (![`127.0.0.1:${port}`, `localhost:${port}`].includes(host)) return send(res, 403, { error: 'Local host required' });
    if (req.headers.origin && ![`http://127.0.0.1:${port}`, `http://localhost:${port}`].includes(req.headers.origin)) return send(res, 403, { error: 'Origin denied' });
    const url = new URL(req.url, `http://${host}`);
    if(url.pathname.startsWith('/api/workspaces')) {
      const token=req.headers.authorization?.replace(/^Bearer /,'');
      const owner=store.authenticate(token);
      if(!owner)return send(res,401,{error:'Valid operator token required'});
      const now=Date.now(),window=limiter.get(owner);
      if(!window||window.until<=now)limiter.set(owner,{until:now+60000,count:1});
      else if(++window.count>120){res.setHeader('Retry-After','60');return send(res,429,{error:'Request limit reached'});}
      if(req.method==='POST'&&url.pathname==='/api/workspaces/evaluate'){
        const input=await body(req);let result;
        switch(input.operation){
          case 'COMMIT_POLICY':result=commitPolicy(input.policy);break;
          case 'REVIEW':result=assessReview(input.commitment,input.resultRoot,input.decisions,Date.now());break;
          case 'APPEAL':result=resolveAppeal(input.commitment,input.resultRoot,input.decisions,input.appeal,input.resolution,Date.now());break;
          case 'SELECT_TEAM':result=selectSignedOffers({...input.tender,now:Date.now()});break;
          case 'SCORE':result=scoreContributions(input.scoring);break;
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
    if (req.method === 'GET' && url.pathname === '/api/tasks') return send(res, 200, [...tasks.values()].reverse());
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
    if (req.method === 'GET' && staticFiles[url.pathname]) {
      const [file, type] = staticFiles[url.pathname]; res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' }); return res.end(await readFile(path.join(root, 'web', file)));
    }
    send(res, 404, { error: 'Not found' });
  } catch (error) { send(res, 400, { error: error.message }); }
});
server.listen(port, '127.0.0.1', () => console.log(`FlashFirm local console: http://127.0.0.1:${port}`));

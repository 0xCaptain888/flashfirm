import http from 'node:http';
import { readFile, writeFile, mkdir, rename, chmod } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Engine, createTask, agents } from './src/engine.mjs';
import { verifyReceipt, rubric } from './src/protocol.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const runtime = path.join(root, '.runtime');
await mkdir(runtime, { recursive: true, mode: 0o700 });
await chmod(runtime, 0o700);
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
    if (req.method === 'GET' && url.pathname === '/api/status') return send(res, 200, { version: '0.1.0', mode: 'LOCAL_FIXTURE', agents, rubric, capabilities: { signatures: true, persistentTasks: true, liveAgents: false, nearSettlement: false, tee: false, independentQuorum: false } });
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
    const staticFiles = { '/': ['index.html','text/html'], '/app.js': ['app.js','text/javascript'], '/style.css': ['style.css','text/css'], '/favicon.svg': ['favicon.svg','image/svg+xml'] };
    if (req.method === 'GET' && staticFiles[url.pathname]) {
      const [file, type] = staticFiles[url.pathname]; res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' }); return res.end(await readFile(path.join(root, 'web', file)));
    }
    send(res, 404, { error: 'Not found' });
  } catch (error) { send(res, 400, { error: error.message }); }
});
server.listen(port, '127.0.0.1', () => console.log(`FlashFirm local console: http://127.0.0.1:${port}`));

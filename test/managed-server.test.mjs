import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
test('managed backend enforces host/origin/auth, provides health and drains cleanly', async () => {
  const runtime = await mkdtemp(path.join(tmpdir(),'flashfirm-managed-'));
  const reservation=createServer(); reservation.listen(0,'127.0.0.1');await once(reservation,'listening');const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
  const child=spawn(process.execPath,['server.mjs'],{cwd:new URL('../',import.meta.url),env:{...process.env,PORT:String(port),FLASHFIRM_PUBLIC_ORIGIN:'https://service.example',FLASHFIRM_RUNTIME:runtime,FLASHFIRM_BIND:'127.0.0.1'},stdio:['ignore','pipe','pipe']});
  const exited=once(child,'exit');
  try {
    await Promise.race([once(child.stdout,'data'),exited.then(()=>{throw Error('Server exited before ready');}),new Promise((_,reject)=>{const timer=setTimeout(()=>reject(Error('Startup timeout')),10000);timer.unref();})]);
    const request=(route,options={})=>new Promise((resolve,reject)=>{
      const req=httpRequest(`http://127.0.0.1:${port}${route}`,{...options,headers:{host:'service.example',...options.headers}},res=>{res.resume();res.on('end',()=>resolve({status:res.statusCode}));});
      req.on('error',reject);req.end(options.body);
    });
    assert.equal((await request('/healthz')).status,200);
    assert.equal((await request('/healthz',{headers:{host:'evil.example'}})).status,403);
    assert.equal((await request('/healthz',{headers:{Origin:'https://evil.example'}})).status,403);
    assert.equal((await request('/api/workspaces')).status,401);
    assert.equal((await request('/api/tasks',{method:'POST',body:'{}'})).status,403);
    assert.equal((await request('/api/tasks')).status,403);
  } finally {child.kill('SIGTERM');await exited;}
});

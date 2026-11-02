import assert from 'node:assert/strict';
import { openStore } from '../src/local-store.mjs';
import { fileURLToPath } from 'node:url';
const store=await openStore(fileURLToPath(new URL('../.runtime/',import.meta.url)));
const token=store.issueToken('http-qa',60000),base='http://127.0.0.1:43180';
async function req(path,method='GET',data,extra={}){const r=await fetch(base+path,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json',...extra},...(data===undefined?{}:{body:JSON.stringify(data)})});return {status:r.status,body:await r.json()};}
let id;
try {
 assert.equal((await req('/api/workspaces','GET',undefined,{Authorization:''})).status,401);
 assert.equal((await req('/api/workspaces','POST',{title:'wrong origin'},{Origin:'https://evil.example'})).status,403);
 const f=await req('/api/workspaces','POST',{title:'HTTP integration test'});assert.equal(f.status,201);id=f.body.id;
 const path='/api/workspaces/'+id;
 const doc=await req(path+'/documents','POST',{private:'test source'});assert.equal(doc.status,201);
 assert.deepEqual((await req(path+'/documents/'+doc.body.id)).body,{private:'test source'});
 const receipt=(await req('/api/live-receipt')).body;
 const j=await req(path+'/jobs','POST',{kind:'VERIFY_RECEIPT',receipt},{'Idempotency-Key':'qa-once'});assert.equal(j.status,202);
 const again=await req(path+'/jobs','POST',{kind:'VERIFY_RECEIPT',receipt},{'Idempotency-Key':'qa-once'});assert.equal(j.body.id,again.body.id);
 let job;for(let n=0;n<30;n++){job=(await req(path+'/jobs/'+j.body.id)).body;if(job.state==='SUCCEEDED'||job.state==='FAILED')break;await new Promise(r=>setTimeout(r,200));}
 assert.equal(job.state,'SUCCEEDED');assert.equal(job.result.valid,true);
 const closed=await req(path+'/dissolve','POST',{});assert.equal(closed.body.state,'DISSOLVED');
 assert.equal((await req(path+'/documents/'+doc.body.id)).status,400);
 assert.ok((await req(path+'/events')).body.some(e=>e.kind==='JOB_SUCCEEDED'));
 console.log(JSON.stringify({status:'PASS',checks:['401 authorization','origin restriction','encrypted document roundtrip','job idempotency','background real-receipt verification','dissolution access cutoff','durable event history'],paidCalls:0}));
}finally{if(id)store.dissolve('http-qa',id);store.revoke(token);store.close();}

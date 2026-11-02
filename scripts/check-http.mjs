import assert from 'node:assert/strict';
import { verifyReceipt } from '../src/protocol.mjs';
const base = 'http://127.0.0.1:43180';
const request = async (path, options = {}) => {
  const response = await fetch(base + path, { ...options, headers: { 'Content-Type': 'application/json', ...options.headers } });
  return { status: response.status, body: await response.json() };
};
const checks = [];
const status = await request('/api/status');
assert.equal(status.body.capabilities.nearSettlement, false); checks.push('capabilities honestly report no live settlement');
const denied = await request('/api/tasks', { method:'POST', headers:{Origin:'https://untrusted.example'}, body:'{}' });
assert.equal(denied.status,403); checks.push('cross-origin writes rejected');
const invalid = await request('/api/tasks', { method:'POST', body:JSON.stringify({budget:-1}) });
assert.equal(invalid.status,400); checks.push('invalid budget rejected');
for (const fault of [true,false]) {
  const created = await request('/api/tasks', { method:'POST', body:JSON.stringify({title:`HTTP QA ${fault ? 'recovery' : 'success'}`,budget:1001,fault}) });
  assert.equal(created.status,201);
  let task = created.body;
  for(let i=0;i<8;i++) {
    const response=await request(`/api/tasks/${task.id}/advance`,{method:'POST',body:'{}'});
    assert.equal(response.status,200);task=response.body;
  }
  assert.equal(task.state,'PLANNED');assert.equal(verifyReceipt(task.receipt).valid,true);
  const loaded=await request(`/api/tasks/${task.id}`);assert.deepEqual(loaded.body,task);
  const repeated=await request(`/api/tasks/${task.id}/advance`,{method:'POST',body:'{}'});assert.deepEqual(repeated.body,task);
  const downloaded=await request(`/api/tasks/${task.id}/receipt`);assert.deepEqual(downloaded.body,task.receipt);
  const checked=await request('/api/verify',{method:'POST',body:JSON.stringify(downloaded.body)});assert.equal(checked.body.valid,true);
  const forged=structuredClone(downloaded.body);forged.payload.allocation.payouts[0].amount++;
  const rejected=await request('/api/verify',{method:'POST',body:JSON.stringify(forged)});assert.equal(rejected.body.valid,false);
  checks.push(`${fault?'recovery':'success'} path: create, advance, persistence, idempotency, receipt export, integrity replay and tamper rejection`);
}
console.log(JSON.stringify({status:'PASS',checks},null,2));

import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { WorkspaceStore } from '../src/workspace-store.mjs';
import { executeLiveJob, preflightLiveJob } from '../src/live-job.mjs';

const input = { kind: 'LIVE_PUBLIC_REVIEW', preset: 'openzeppelin-pinned', approvedCapFen: 2000 };
function setup() {
  let now = 1000;
  const store = new WorkspaceStore(':memory:', randomBytes(32), () => now);
  const firm = store.create('operator', 'Public review');
  const queued = store.enqueue('operator', firm.id, 'once', input);
  return { store, firm, queued, tick: delta => now += delta };
}
test('paid jobs cannot replay after lease expiry; stale completion cannot succeed', () => {
  const { store, firm, queued, tick } = setup();
  try {
    const job = store.claim(); store.markPaidStarted(job.id, job.lease);
    tick(30001);
    assert.equal(store.claim(), null);
    assert.equal(store.finish(job.id, job.lease, {}), false);
    assert.equal(store.job('operator', firm.id, queued.id).state, 'FAILED');
    assert.equal(store.enqueue('operator', firm.id, 'once', input).id, queued.id);
    assert.equal(store.claim(), null);
  } finally { store.close(); }
});
test('heartbeat renews live lease; dissolution blocks subsequent calls', async () => {
  const { store, firm, tick } = setup();
  const runtime = await mkdtemp(path.join(os.tmpdir(), 'flashfirm-job-'));
  try {
    const job = store.claim(); tick(20000); assert.equal(store.renew(job.id, job.lease), true); tick(20000);
    assert.equal(store.claim(), null);
    let calls = 0;
    await assert.rejects(executeLiveJob(store, job, runtime, {
      preflight: async () => {}, collect: async () => [],
      provider: { complete: async () => { calls++; return {}; } },
      run: async (_output, provider) => { await provider.complete([], 'first'); store.dissolve('operator', firm.id); await provider.complete([], 'second'); }
    }), /JOB_NO_LONGER_ACTIVE/);
    assert.equal(calls, 1);
    assert.equal(store.job('operator', firm.id, job.id).state, 'CANCELLED');
  } finally { store.close(); }
});
test('live job returns verified output without bypassing shared provider', async () => {
  const { store, firm } = setup();
  const runtime = await mkdtemp(path.join(os.tmpdir(), 'flashfirm-job-'));
  try {
    const job = store.claim(); let calls = 0;
    const result = await executeLiveJob(store, job, runtime, {
      preflight: async () => {}, collect: async () => [], provider: { complete: async () => { calls++; return {}; } },
      run: async (_output, provider) => { for (let i = 0; i < 4; i++) await provider.complete([], 'mock'); return { mock: true }; },
      verify: () => ({ valid: true })
    });
    assert.equal(calls, 4); assert.equal(result.settlementExecuted, false);
    assert.equal(store.finish(job.id, job.lease, result), true);
    assert.equal(store.job('operator', firm.id, job.id).state, 'SUCCEEDED');
  } finally { store.close(); }
});
test('complete-run preflight refuses insufficient calls and missing cumulative ledger', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'flashfirm-preflight-'));
  await writeFile(path.join(dir, 'provider-policy.json'), JSON.stringify({ enabled: true, capFen: 2000, model: 'deepseek-flash', baseUrl: 'https://api.apikey.fan/v1', conservativeCnyPerMillion: 100 }));
  await assert.rejects(preflightLiveJob(dir), /ENOENT/);
  await writeFile(path.join(dir, 'provider-budget.json'), JSON.stringify({ reservedFen: 992, calls: Array(6).fill({}) }));
  await assert.rejects(preflightLiveJob(dir), /INSUFFICIENT_BUDGET/);
  await writeFile(path.join(dir, 'provider-budget.json'), JSON.stringify({ reservedFen: 0, calls: [] }));
  assert.equal((await preflightLiveJob(dir)).callsRequired, 4);
});

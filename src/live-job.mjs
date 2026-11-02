import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { BudgetedProvider, collectSources, runLiveReview, verifyLiveReceipt } from './live.mjs';

// Four calls, each bounded at 20,000 input bytes + 4,096 overhead + 1,600 output tokens.
// A conservative preflight, not a new budget and not a provider billing estimate.
export async function preflightLiveJob(runtime) {
  const policy = JSON.parse(await readFile(path.join(runtime, 'provider-policy.json'), 'utf8'));
  if (policy.enabled !== true || policy.capFen !== 2000 || policy.model !== 'deepseek-flash' || policy.baseUrl !== 'https://api.apikey.fan/v1' || policy.conservativeCnyPerMillion !== 100) throw Error('UNAPPROVED_PROVIDER_POLICY');
  // Require an existing ledger. A missing/corrupt ledger must not reset cumulative spend.
  const ledger = JSON.parse(await readFile(path.join(runtime, 'provider-budget.json'), 'utf8'));
  if (!Number.isSafeInteger(ledger.reservedFen) || ledger.reservedFen < 0 || !Array.isArray(ledger.calls)) throw Error('INVALID_BUDGET_LEDGER');
  if (ledger.calls.length + 4 > 8 || ledger.reservedFen + 1028 > 2000) throw Error('INSUFFICIENT_BUDGET_FOR_COMPLETE_RUN');
  return { callsRequired: 4, maxReservationFen: 1028, remainingCalls: 8 - ledger.calls.length, remainingFen: 2000 - ledger.reservedFen };
}

export async function modelAvailability(runtime) {
  let budget = null;
  try {
    const ledger = JSON.parse(await readFile(path.join(runtime, 'provider-budget.json'), 'utf8'));
    if (!Number.isSafeInteger(ledger.reservedFen) || ledger.reservedFen < 0 || !Array.isArray(ledger.calls)) throw Error('INVALID_BUDGET_LEDGER');
    budget = { capFen: 2000, reservedFen: ledger.reservedFen, calls: ledger.calls.length, maxCalls: 8, actualInvoiceCost: null };
    await preflightLiveJob(runtime);
    return { enabled: true, budget, requiredCalls: 4, preset: 'openzeppelin-pinned' };
  } catch (error) {
    return { enabled: false, budget, requiredCalls: 4, reason: /^[A-Z0-9_]+$/.test(error.message) ? error.message : 'MODEL_CONFIG_UNAVAILABLE' };
  }
}

export async function executeLiveJob(store, job, runtime, dependencies = {}) {
  if (job.input.kind !== 'LIVE_PUBLIC_REVIEW' || job.input.preset !== 'openzeppelin-pinned' || job.input.approvedCapFen !== 2000) throw Error('INVALID_PUBLIC_REVIEW_JOB');
  await (dependencies.preflight ?? preflightLiveJob)(runtime);
  if (!store.renew(job.id, job.lease)) throw Error('JOB_NO_LONGER_ACTIVE');
  const output = path.join(runtime, 'model-jobs', job.id);
  await mkdir(output, { recursive: true, mode: 0o700 });
  let active = true;
  const heartbeat = setInterval(() => { try { active = store.renew(job.id, job.lease); } catch { active = false; } }, 5000);
  heartbeat.unref();
  try {
    const sources = await (dependencies.collect ?? collectSources)();
    await writeFile(path.join(output, 'sources.json'), JSON.stringify(sources), { mode: 0o600 });
    const provider = dependencies.provider ?? new BudgetedProvider(runtime);
    const guardedProvider = { complete: async (...args) => {
      if (!active || !store.renew(job.id, job.lease)) throw Error('JOB_NO_LONGER_ACTIVE');
      // Persist before dispatch: a crash must not trigger automatic paid retries.
      store.markPaidStarted(job.id, job.lease);
      return provider.complete(...args);
    } };
    const receipt = await (dependencies.run ?? runLiveReview)(output, guardedProvider, sources);
    const verification = (dependencies.verify ?? verifyLiveReceipt)(receipt);
    if (!verification.valid) throw Error('LIVE_RECEIPT_INTEGRITY_FAILURE');
    return { receipt, verification, settlementExecuted: false, outputScope: 'Approved public source analysis; not independent operator review' };
  } finally { clearInterval(heartbeat); }
}

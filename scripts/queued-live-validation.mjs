import { fileURLToPath } from 'node:url';
import { writeFile } from 'node:fs/promises';
import { openStore } from '../src/local-store.mjs';
import { preflightLiveJob } from '../src/live-job.mjs';
const runtime = fileURLToPath(new URL('../.runtime/', import.meta.url));
await preflightLiveJob(runtime);
const store = await openStore(runtime);
try {
  const owner = 'authorized-queue-validation';
  let firm = store.list(owner).find(f => f.title === 'Public full review 2026-11-02');
  firm ??= store.create(owner, 'Public full review 2026-11-02');
  const queued = store.enqueue(owner, firm.id, 'full-run-2026-11-02-v1', { kind: 'LIVE_PUBLIC_REVIEW', preset: 'openzeppelin-pinned', approvedCapFen: 2000 });
  if (queued.state !== 'QUEUED') throw Error('Existing job retained; inspect it instead of replaying');
  // Shared SQLite leases let the running server claim this job too. Never take its lease.
  for (let count = 0; count < 120; count++) {
    const current = store.job(owner, firm.id, queued.id);
    if (['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(current.state)) {
      const report = { jobId: current.id, state: current.state, attempts: current.attempts, receiptValid: current.result?.verification?.valid === true, receipt: current.result?.receipt ?? null, error: current.result?.error ?? null, settlementExecuted: false };
      await writeFile(new URL('../.runtime/queued-live-validation.json', import.meta.url), JSON.stringify(report, null, 2), { mode: 0o600 });
      console.log(JSON.stringify({ ...report, receipt: report.receipt ? 'Saved privately; export after verification' : null }));
      if (current.state !== 'SUCCEEDED') process.exitCode = 1;
      break;
    }
    if (current.state === 'QUEUED') {
      // Existing background server owns the queue; do not claim unrelated jobs.
      console.log('Queued; waiting for background worker.');
    }
    await new Promise(resolve => setTimeout(resolve, 3000));
    if (count === 119) throw Error('Still running; inspect retained job without replay');
  }
} finally { store.close(); }

import {hash} from './protocol.mjs';
import {verifyReport, citationLocations} from './report-revision.mjs';
import {assessReview, resolveAppeal} from './governance.mjs';

export function createCase(receipt) {
  const checked = verifyReport(receipt);
  if (!checked.valid) throw Error('INVALID_CASE_REPORT');
  return {version: 'flashfirm-case/1', receipt, receiptHash: checked.receiptHash, taskRoot: checked.taskRoot};
}

export function assertCaseReview(record, commitment, resultRoot) {
  if (record && (record.taskRoot !== commitment.policy.taskRoot || record.receiptHash !== resultRoot))
    throw Error('REVIEW_MUST_BIND_EXACT_CASE_REPORT');
}

export function caseStatus(firm, record, review = null, now = Date.now()) {
  if (!record) return {attached: false, nextAction: 'Import a signed model report or an operator revision.', settlementExecuted: false};
  const rebuilt = createCase(record.receipt);
  if (record.version !== rebuilt.version || record.receiptHash !== rebuilt.receiptHash || record.taskRoot !== rebuilt.taskRoot)
    throw Error('CASE_INTEGRITY_FAILED');
  const checked = verifyReport(record.receipt);
  let assessment = null;
  if (review) {
    assertCaseReview(record, review.commitment, review.resultRoot);
    assessment = assessReview(review.commitment, review.resultRoot, review.decisions, now);
    if (review.appeal) assessment = {...assessment, state: 'APPEAL_PENDING'};
    if (review.resolution) assessment = {...assessment, ...resolveAppeal(review.commitment, review.resultRoot, review.decisions, review.appeal, review.resolution, now)};
  }
  const qualityBlocked = checked.citationState !== 'PASS' || checked.qualityState === 'CHALLENGED';
  const state = firm.state !== 'ACTIVE' ? 'CLOSED' : qualityBlocked ? 'REWORK_REQUIRED' : assessment?.state ?? 'AWAITING_REVIEW';
  const nextAction = state === 'CLOSED' ? 'Read or export the retained evidence; closure does not refund blockchain funds.' :
    qualityBlocked ? 'Create a separate signed revision. Preserve this challenged artifact.' :
    !assessment ? 'Pin a review policy to this exact task root and report hash; collect real reviewer decisions.' :
    assessment.state === 'RELEASE_ELIGIBLE' ? 'Key quorum reached. Independently establish reviewer identity and verify settlement separately.' :
    'Resolve the review or appeal under the pinned policy. No payment is triggered.';
  return {attached: true, version: record.version, workspaceId: firm.id, sourceTaskId: checked.sourceTaskId,
    taskRoot: record.taskRoot, receiptHash: record.receiptHash, parentHash: checked.parentHash, kind: checked.kind,
    state, citationState: checked.citationState, qualityState: checked.qualityState, review: assessment, nextAction,
    gates: [
      {id: 'delivery', state: checked.kind, detail: 'Recorded model delivery or explicitly labeled editorial revision.'},
      {id: 'sources', state: checked.citationState, detail: 'Exact text matching; conclusions still need review.'},
      {id: 'review', state: assessment?.state ?? 'AWAITING_REVIEW', detail: 'Key signatures do not establish independent people.'},
      {id: 'privacy', state: 'NO_TASK_BOUND_TEE_PROOF', detail: 'The separate Phala demonstration is not evidence for this task.'},
      {id: 'settlement', state: 'NOT_EXECUTED', detail: 'Other testnet payments and cross-chain quotes are not this task’s settlement.'}
    ], claims: citationLocations(record.receipt), independentOperatorsVerified: false,
    settlementExecuted: false, confidentialInferenceVerified: false};
}

export function exportCase(firm, record, review = null, now = Date.now()) {
  const status = caseStatus(firm, record, review, now);
  if (!status.attached) throw Error('CASE_REQUIRED');
  const payload = {version: 'flashfirm-dossier/1', exportedAt: now,
    workspace: {id: firm.id, title: firm.title, state: firm.state}, record, review,
    settlementExecuted: false, independentOperatorsVerified: false};
  return {payload, digest: hash(payload), status, integrity: 'Digest plus embedded signed artifacts; the export itself is not independently signed.'};
}

export function verifyCaseExport(envelope) {
  try {
    const p = envelope.payload;
    if (p.version !== 'flashfirm-dossier/1' || hash(p) !== envelope.digest ||
      p.settlementExecuted !== false || p.independentOperatorsVerified !== false ||
      !Number.isSafeInteger(p.exportedAt)) throw Error('INVALID_DOSSIER');
    const status = caseStatus(p.workspace, p.record, p.review, p.exportedAt);
    return {valid: true, status, scope: 'Embedded artifacts and bound review rechecked. Workspace metadata/digest is not an independent identity or payment proof.'};
  } catch (e) { return {valid: false, errors: [e.message]}; }
}

// Notifications are derived from durable evidence, not arbitrary caller messages.
// Stable IDs let acknowledgement survive refresh without hiding later evidence.
export function caseNotifications(firm, record, review, jobs, acknowledged = [], now = Date.now()) {
  const status = caseStatus(firm, record, review, now), rows = [], seen = new Set(acknowledged);
  const add = (key, severity, title, detail) => {
    const id = hash({firm: firm.id, key});
    rows.push({id, severity, title, detail, acknowledged: seen.has(id), channel: 'IN_APP'});
  };
  if (status.attached) {
    if (status.state === 'REWORK_REQUIRED') add(`report:${status.receiptHash}`, 'warning', 'Report needs correction', 'The report remains challenged. Verification completion does not approve its quality.');
    else if (!status.review) add(`review:${status.receiptHash}`, 'info', 'Review required', 'Pin a policy and collect signatures for this exact report. No previous approval is inherited.');
    if (status.review) add(`review:${status.receiptHash}:${status.review.reviewHash}:${status.review.state}`, status.review.challenged ? 'warning' : 'info',
      `Review: ${status.review.state.replaceAll('_', ' ')}`, 'This is a signature-policy result; real-world independence and settlement remain separate.');
  }
  for (const job of jobs) {
    if (['FAILED', 'CANCELLED'].includes(job.state)) add(`job:${job.id}:${job.state}`, 'warning', `Task ${job.state.toLowerCase()}`, 'Inspect retained evidence before retrying. No paid work is automatically repeated.');
    if (job.state === 'SUCCEEDED') add(`job:${job.id}:complete`, job.result?.valid === false ? 'warning' : 'info',
      job.result?.valid === false ? 'Receipt verification failed' : 'Verification task completed', 'Open the result. A completed job alone proves neither report quality nor payment.');
  }
  return {items: rows, unread: rows.filter(n => !n.acknowledged).length, channels: ['IN_APP'], emailDeliveryEnabled: false};
}

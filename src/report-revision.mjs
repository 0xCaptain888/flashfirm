import {hash, canonical, seal, validSeal} from './protocol.mjs';
import {validateAnalysis, verifyLiveReceipt} from './live.mjs';

// Editorial corrections are new artifacts. They never overwrite a model response,
// inherit its review approval, spend a model budget or authorize a payment.
export function applyReportEdits(parent, edits) {
  if (!verifyLiveReceipt(parent).valid) throw Error('INVALID_PARENT_RECEIPT');
  if (!Array.isArray(edits) || !edits.length || edits.length > 12) throw Error('INVALID_EDITS');
  const workers = structuredClone(parent.payload.workers), seen = new Set();
  for (const edit of edits) {
    const worker = workers.find(w => w.worker.id === edit?.workerId);
    const index = edit?.claimIndex, pointer = `${edit?.workerId}:${index}`;
    if (!worker || !Number.isInteger(index) || index < 0 || index >= worker.analysis.claims.length ||
      seen.has(pointer) || !['REPLACE_QUOTE', 'RETRACT_CLAIM'].includes(edit.operation) ||
      typeof edit.reason !== 'string' || !edit.reason.trim() || edit.reason.length > 1000) throw Error('INVALID_EDIT');
    seen.add(pointer);
    const claim = worker.analysis.claims[index];
    if (edit.operation === 'REPLACE_QUOTE') {
      const source = parent.payload.sources.find(s => s.id === claim.sourceId);
      if (typeof edit.quote !== 'string' || edit.quote.length < 20 || edit.quote.length > 600 ||
        edit.quote === claim.quote || !source?.excerpt.includes(edit.quote)) throw Error('REPLACEMENT_NOT_IN_SOURCE');
      claim.quote = edit.quote;
    } else {
      // Mark first; remove after all indices have been interpreted against the parent.
      claim.retracted = true;
    }
  }
  for (const worker of workers) {
    worker.analysis.claims = worker.analysis.claims.filter(c => !c.retracted);
    if (!worker.analysis.claims.length) throw Error('EMPTY_WORKER_AFTER_RETRACTION');
    worker.checks = validateAnalysis(worker.analysis, parent.payload.sources);
  }
  return workers;
}

export function reviseReport(parent, edits, editor, createdAt = new Date().toISOString()) {
  const workers = applyReportEdits(parent, edits);
  if (!Number.isFinite(Date.parse(createdAt)) || Date.parse(createdAt) < Date.parse(parent.payload.completedAt)) throw Error('INVALID_REVISION_TIME');
  return seal({
    version: 'flashfirm-revision/1', mode: 'OPERATOR_EDITED_PUBLIC_REPORT',
    taskId: parent.payload.taskId, parentHash: hash(parent), parentReceipt: parent,
    createdAt, edits: structuredClone(edits), workers, editorKey: editor.publicKey,
    citationState: workers.every(w => w.checks.valid) ? 'PASS' : 'CHALLENGED',
    state: 'AWAITING_NEW_REVIEW', modelCalls: 0, settlement: {status: 'NOT_EXECUTED'},
    inheritedSummariesRequireReview: true,
    trust: 'Operator editorial correction; not a new model output or independent approval. Original summaries and model critique do not certify this revision.'
  }, editor);
}

export function verifyReport(receipt) {
  const errors = [];
  let original, workers, revision = false;
  try {
    if (receipt?.payload?.version === 'flashfirm-live/0.1') {
      const checked = verifyLiveReceipt(receipt);
      errors.push(...checked.errors);
      original = receipt; workers = receipt.payload.workers;
    } else if (receipt?.payload?.version === 'flashfirm-revision/1') {
      revision = true;
      const p = receipt.payload;
      original = p.parentReceipt;
      if (!validSeal(receipt, p.editorKey)) errors.push('INVALID_EDITOR_SIGNATURE');
      workers = applyReportEdits(original, p.edits);
      if (p.mode !== 'OPERATOR_EDITED_PUBLIC_REPORT' || p.parentHash !== hash(original) ||
        p.taskId !== original.payload.taskId || canonical(workers) !== canonical(p.workers) ||
        p.citationState !== (workers.every(w => w.checks.valid) ? 'PASS' : 'CHALLENGED') ||
        p.state !== 'AWAITING_NEW_REVIEW' || p.modelCalls !== 0 ||
        p.settlement?.status !== 'NOT_EXECUTED' || p.inheritedSummariesRequireReview !== true ||
        !Number.isFinite(Date.parse(p.createdAt)) || Date.parse(p.createdAt) < Date.parse(original.payload.completedAt)) errors.push('INVALID_REVISION_BINDING');
    } else errors.push('UNSUPPORTED_REPORT');
  } catch { errors.push('MALFORMED_REPORT'); }
  const valid = errors.length === 0;
  return {
    valid, errors,
    ...(valid ? {
      receiptHash: hash(receipt), sourceTaskId: original.payload.taskId,
      taskRoot: hash({version: 'flashfirm-task/1', taskId: original.payload.taskId, project: original.payload.project}),
      kind: revision ? 'OPERATOR_REVISION' : 'RECORDED_MODEL_REPORT',
      parentHash: revision ? hash(original) : null,
      citationState: workers.every(w => w.checks.valid) ? 'PASS' : 'CHALLENGED',
      qualityState: revision ? 'AWAITING_NEW_REVIEW' : original.payload.state,
      modelReviewApplies: !revision, independentReviewVerified: false
    } : {}),
    scope: 'Signed artifact consistency and exact source quotations. No semantic assurance, independent identity, confidential inference or settlement.'
  };
}

export function citationLocations(receipt) {
  const checked = verifyReport(receipt);
  if (!checked.valid) throw Error('INVALID_REPORT');
  const original = receipt.payload.parentReceipt ?? receipt;
  return receipt.payload.workers.flatMap(w => w.analysis.claims.map((c, claimIndex) => {
    const source = original.payload.sources.find(s => s.id === c.sourceId);
    const start = source?.excerpt.indexOf(c.quote) ?? -1;
    return {workerId: w.worker.id, claimIndex, sourceId: c.sourceId, kind: c.kind,
      statement: c.statement, quote: c.quote, exact: start >= 0,
      start: start < 0 ? null : start, end: start < 0 ? null : start + c.quote.length,
      excerptLine: start < 0 ? null : source.excerpt.slice(0, start).split('\n').length,
      semanticSupport: 'REQUIRES_REVIEW'};
  }));
}

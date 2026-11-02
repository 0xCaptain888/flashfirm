import { createHash, generateKeyPairSync, sign, verify, createPublicKey } from 'node:crypto';

export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
export const hash = value => createHash('sha256').update(canonical(value)).digest('hex');
export function identity() {
  const pair = generateKeyPairSync('ed25519');
  return { privateKey: pair.privateKey.export({ type: 'pkcs8', format: 'pem' }), publicKey: pair.publicKey.export({ type: 'spki', format: 'pem' }) };
}
export function seal(payload, key) {
  return { payload, publicKey: key.publicKey, signature: sign(null, Buffer.from(canonical(payload)), key.privateKey).toString('base64') };
}
export function validSeal(envelope, trustedKey) {
  try { return envelope.publicKey === trustedKey && verify(null, Buffer.from(canonical(envelope.payload)), createPublicKey(trustedKey), Buffer.from(envelope.signature, 'base64')); } catch { return false; }
}
// Integer largest-remainder allocation. IDs break ties deterministically.
export function allocate(budget, rows, feeBps = 200) {
  if (!Number.isSafeInteger(budget) || budget < 0 || budget > 100_000_000 || !Number.isInteger(feeBps) || feeBps < 0 || feeBps > 10000) throw Error('Invalid budget or fee');
  if (new Set(rows.map(r => r.id)).size !== rows.length || rows.some(r => !Number.isSafeInteger(r.score) || r.score < 0 || r.score > 10000)) throw Error('Invalid scores');
  const eligible = rows.filter(r => r.eligible && r.score > 0);
  if (!eligible.length) return { budget, fee: 0, refund: budget, payouts: rows.map(r => ({ id: r.id, amount: 0 })) };
  const fee = Math.floor(budget * feeBps / 10000), pool = BigInt(budget - fee);
  const total = BigInt(eligible.reduce((s, r) => s + r.score, 0));
  const parts = eligible.map(r => ({ id: r.id, amount: Number(pool * BigInt(r.score) / total), remainder: pool * BigInt(r.score) % total }));
  let leftover = Number(pool) - parts.reduce((s, r) => s + r.amount, 0);
  parts.sort((a,b) => a.remainder === b.remainder ? a.id.localeCompare(b.id) : a.remainder > b.remainder ? -1 : 1);
  for (const p of parts) if (leftover-- > 0) p.amount++;
  return { budget, fee, refund: 0, payouts: rows.map(r => ({ id: r.id, amount: parts.find(p => p.id === r.id)?.amount ?? 0 })) };
}
export const rubric = [
  { id: 'access', label: 'Privileged access identified', weight: 30 },
  { id: 'dependency', label: 'Dependency exposure checked', weight: 20 },
  { id: 'terms', label: 'Commercial terms reviewed', weight: 25 },
  { id: 'market', label: 'Market evidence reconciled', weight: 25 }
];
export const sources = {
  'fixture:access': { id: 'fixture:access', text: 'ExampleCo: administrator can change the billing recipient without a timelock.' },
  'fixture:dependency': { id: 'fixture:dependency', text: 'ExampleCo: the supplier inventory has no pinned version for its billing dependency.' },
  'fixture:terms': { id: 'fixture:terms', text: 'ExampleCo: customer cancellation takes effect at the next monthly renewal.' },
  'fixture:market': { id: 'fixture:market', text: 'ExampleCo: supplied sample shows 80 active accounts and 20 cancelled accounts.' }
};
export function gate(artifact, prior = []) {
  if (!artifact || !Array.isArray(artifact.claims) || artifact.claims.length === 0) return { ok: false, reason: 'Empty artifact' };
  for (const c of artifact.claims) {
    const source = sources[c.source];
    if (!source || hash(source) !== c.sourceHash) return { ok: false, reason: 'Citation is absent from the committed sample source set' };
    if (!rubric.some(r => r.id === c.criterion) || c.source !== `fixture:${c.criterion}` || c.quote !== source.text) return { ok: false, reason: 'Claim does not match its source and rubric clause' };
  }
  if (prior.some(a => hash(a) === hash(artifact))) return { ok: false, reason: 'Duplicate artifact' };
  return { ok: true, reason: 'Exact sample citation and rubric checks passed' };
}
// Objective fixture coverage only; not a semantic quality or fairness oracle.
export function scores(work) {
  const accepted = work.filter(w => w.accepted);
  const quality = list => rubric.filter(r => list.some(w => w.artifact.claims.some(c => c.criterion === r.id))).reduce((n, r) => n + r.weight, 0);
  const full = quality(accepted);
  return work.map(w => {
    const without = quality(accepted.filter(a => a.id !== w.id));
    return { id: w.id, eligible: w.accepted, full, without, marginal: w.accepted ? full - without : 0, score: w.accepted ? (full - without) * 100 : 0 };
  });
}
export function verifyReceipt(receipt) {
  const errors = [];
  try {
    const p = receipt.payload;
    if (p.version !== 'flashfirm/0.1' || p.mode !== 'LOCAL_FIXTURE') errors.push('Unsupported protocol');
    if (!validSeal(receipt, p.coordinatorKey)) errors.push('Receipt signature invalid');
    if (p.sourceRoot !== hash(sources) || p.rubricRoot !== hash(rubric)) errors.push('Source or rubric root invalid');
    if (new Set(p.work.map(w => w.id)).size !== p.work.length) errors.push('Duplicate work identity');
    if (new Set(p.work.map(w => w.agent)).size !== p.work.length) errors.push('Duplicate agent identity');
    if (p.work.length < 3 || p.work.length > 4) errors.push('Incomplete sample coalition');
    const prior = [], seen = new Set();
    for (const [index, w] of p.work.entries()) {
      if (!validSeal(w.envelope, p.agentKeys[w.agent]) || hash(w.envelope.payload) !== w.digest) errors.push(`Invalid signature: ${w.id}`);
      const v = w.envelope.payload;
      if (v.taskId !== p.taskId || v.id !== w.id || v.agent !== w.agent || v.nonce !== index + 1 || v.artifactHash !== hash(w.artifact) || !v.dependencies.every(d => seen.has(d)) || new Set(v.dependencies).size !== v.dependencies.length) errors.push(`Invalid work graph: ${w.id}`);
      const assigned = { sentinel: ['access','dependency'], accord: ['terms'], signal: ['market'], 'signal-backup': ['market'] }[w.agent];
      if (!assigned || canonical(w.artifact.claims.map(c => c.criterion).sort()) !== canonical([...assigned].sort())) errors.push(`Invalid role assignment: ${w.id}`);
      const checked = gate(w.artifact, prior);
      if (checked.ok !== w.accepted) errors.push(`Invalid eligibility: ${w.id}`);
      if (w.accepted) prior.push(w.artifact);
      seen.add(w.digest);
    }
    if (p.workRoot !== hash(p.work.map(w => w.digest))) errors.push('Work root mismatch');
    const recomputed = scores(p.work);
    if (!recomputed.length || recomputed[0].full !== 100) errors.push('Acceptance rubric incomplete');
    if (canonical(recomputed) !== canonical(p.scores)) errors.push('Scores mismatch');
    if (canonical(allocate(p.budget, recomputed)) !== canonical(p.allocation)) errors.push('Allocation mismatch');
    if (p.settlement.status !== 'NOT_EXECUTED') errors.push('Unsupported settlement claim');
    if (p.privacy !== 'SYNTHETIC_PUBLIC_FIXTURE') errors.push('Unsupported privacy claim');
  } catch { errors.push('Malformed receipt'); }
  return { valid: errors.length === 0, errors, scope: 'Cryptographic integrity and deterministic sample replay only; embedded keys are not independent identities; no chain settlement or TEE verified.' };
}

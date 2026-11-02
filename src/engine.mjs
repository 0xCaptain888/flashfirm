import { randomUUID } from 'node:crypto';
import { hash, identity, seal, rubric, sources, gate, scores, allocate, verifyReceipt } from './protocol.mjs';

export const agents = [
  { id: 'sentinel', name: 'Sentinel', role: 'Security', bid: 250, criteria: ['access','dependency'] },
  { id: 'accord', name: 'Accord', role: 'Commercial risk', bid: 200, criteria: ['terms'] },
  { id: 'signal', name: 'Signal', role: 'Market evidence', bid: 150, criteria: ['market'] },
  { id: 'lens', name: 'Lens', role: 'Evidence verification', bid: 100, criteria: [] },
  { id: 'signal-backup', name: 'Signal / Reserve', role: 'Market evidence', bid: 170, criteria: ['market'] }
];
export function createTask({ title = 'ExampleCo technical due diligence', budget = 1000, fault = true } = {}) {
  if (typeof title !== 'string' || title.trim().length < 3 || title.length > 120) throw Error('Title must contain 3–120 characters');
  if (!Number.isSafeInteger(budget) || budget < 100 || budget > 100000) throw Error('Sample budget must be 100–100000 cents');
  if (typeof fault !== 'boolean') throw Error('Invalid failure scenario');
  return { id: randomUUID(), title: title.trim(), budget, fault, state: 'DRAFT', mode: 'LOCAL_FIXTURE', createdAt: new Date().toISOString(), work: [], events: [], step: 0, receipt: null };
}
const transitions = { DRAFT: ['FORMING'], FORMING: ['ACTIVE'], ACTIVE: ['CHALLENGED','ACCEPTED'], CHALLENGED: ['REPLACED'], REPLACED: ['ACCEPTED'], ACCEPTED: ['PLANNED'] };
export function transition(task, next) {
  if (!transitions[task.state]?.includes(next)) throw Error(`Invalid transition ${task.state} → ${next}`);
  task.state = next;
}
export class Engine {
  constructor(keys) { this.keys = keys ?? Object.fromEntries(['coordinator',...agents.map(a => a.id)].map(id => [id, identity()])); }
  event(t, message, kind = 'info') { t.events.push({ seq: t.events.length + 1, at: new Date().toISOString(), state: t.state, kind, message }); }
  contribute(t, agentId, faulty = false) {
    const agent = agents.find(a => a.id === agentId);
    const artifact = { claims: agent.criteria.map(criterion => ({ criterion, source: faulty ? 'fixture:invented' : `fixture:${criterion}`, sourceHash: hash(sources[`fixture:${criterion}`]), quote: sources[`fixture:${criterion}`].text })) };
    const id = `${agentId}:${t.work.length + 1}`;
    const payload = { taskId: t.id, id, agent: agentId, artifactHash: hash(artifact), dependencies: t.work.filter(w => w.accepted).map(w => w.digest), nonce: t.work.length + 1 };
    const result = gate(artifact, t.work.filter(w => w.accepted).map(w => w.artifact));
    t.work.push({ id, agent: agentId, artifact, envelope: seal(payload, this.keys[agentId]), digest: hash(payload), accepted: result.ok, reason: result.reason });
    this.event(t, `${agent.name}: ${result.reason}`, result.ok ? 'success' : 'danger');
  }
  advance(t) {
    if (t.state === 'PLANNED') return t;
    switch (t.step++) {
      case 0: transition(t, 'FORMING'); this.event(t, 'Sample budget reserved in the local ledger. No funds moved.'); break;
      case 1: transition(t, 'ACTIVE'); this.event(t, 'Fixed sample coalition assigned: security, commercial risk, market evidence and deterministic verifier.'); break;
      case 2: this.contribute(t, 'sentinel'); break;
      case 3: this.contribute(t, 'accord'); break;
      case 4: this.contribute(t, 'signal', t.fault); if (t.fault) transition(t, 'CHALLENGED'); break;
      case 5: if (t.fault) { transition(t, 'REPLACED'); this.contribute(t, 'signal-backup'); } else this.event(t, 'All three specialist artifacts passed source checks.'); break;
      case 6: {
        const covered = new Set(t.work.filter(w => w.accepted).flatMap(w => w.artifact.claims.map(c => c.criterion)));
        if (!rubric.every(r => covered.has(r.id))) throw Error('Rubric incomplete');
        transition(t, 'ACCEPTED'); this.event(t, 'All four sample rubric clauses covered. Evidence checker passed; independent evaluator quorum is not configured.', 'success'); break;
      }
      case 7: {
        transition(t, 'PLANNED');
        const contributionScores = scores(t.work);
        const payload = { version: 'flashfirm/0.1', taskId: t.id, mode: t.mode, budget: t.budget, sourceRoot: hash(sources), rubricRoot: hash(rubric), work: t.work, workRoot: hash(t.work.map(w => w.digest)), scores: contributionScores, allocation: allocate(t.budget, contributionScores), agentKeys: Object.fromEntries(agents.map(a => [a.id, this.keys[a.id].publicKey])), coordinatorKey: this.keys.coordinator.publicKey, privacy: 'SYNTHETIC_PUBLIC_FIXTURE', settlement: { status: 'NOT_EXECUTED', network: null, transaction: null } };
        t.receipt = seal(payload, this.keys.coordinator);
        if (!verifyReceipt(t.receipt).valid) throw Error('Internal receipt verification failed');
        this.event(t, 'Signed allocation plan ready. NEAR settlement and authority revocation remain pending.', 'success'); break;
      }
      default: throw Error('Invalid step');
    }
    return t;
  }
}

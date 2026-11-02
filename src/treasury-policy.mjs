// Shared browser/Node policy. No key storage, signing, network, or Node imports.
const U64 = (1n << 64n) - 1n, U128 = (1n << 128n) - 1n;
const MIN_WINDOW = 60_000_000_000n, MAX_WINDOW = 604_800_000_000_000n;
const fields = ['buyer', 'evaluators', 'recipients', 'task_root', 'deadline_ns', 'arbiter', 'policy_hash', 'appeal_window_ns', 'arbitration_window_ns'];
function integer(value, max = U64) {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,38})$/.test(value) || BigInt(value) > max) throw Error('Expected canonical unsigned decimal string');
  return BigInt(value);
}
function account(value) {
  if (typeof value !== 'string' || value.length > 64 || !/^(?:[a-z0-9]+(?:[-_][a-z0-9]+)*\.)+testnet$/.test(value)) throw Error('Named .testnet account required');
}
function hash(value) { if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) throw Error('SHA256 commitment required'); return value; }
export function prepareTestnet(config, nowNs = BigInt(Date.now()) * 1_000_000n) {
  if (!config || config.network !== 'testnet') throw Error('Testnet only');
  account(config.contractId);
  const args = config.init;
  if (!args || Object.keys(args).some(key => !fields.includes(key)) || fields.some(key => !(key in args))) throw Error('Exact treasury v0.2 initialization fields required');
  if (!Array.isArray(args.evaluators) || args.evaluators.length !== 3 || !Array.isArray(args.recipients) || args.recipients.length < 1 || args.recipients.length > 16) throw Error('Invalid participant counts');
  const participants = [args.buyer, args.arbiter, ...args.evaluators, ...args.recipients];
  participants.forEach(account);
  if (!args.recipients.includes(args.buyer) || new Set(args.recipients).size !== args.recipients.length || new Set(args.evaluators).size !== 3) throw Error('Duplicate participant or missing refund buyer');
  if (participants.includes(config.contractId) || args.evaluators.some(id => args.recipients.includes(id)) || args.arbiter === args.buyer || args.recipients.includes(args.arbiter) || args.evaluators.includes(args.arbiter)) throw Error('Overlapping treasury roles');
  hash(args.task_root); hash(args.policy_hash);
  const deadline = integer(args.deadline_ns), appeal = integer(args.appeal_window_ns), arbitration = integer(args.arbitration_window_ns);
  if (deadline <= nowNs || appeal < MIN_WINDOW || appeal > MAX_WINDOW || arbitration < MIN_WINDOW || arbitration > MAX_WINDOW || deadline + appeal + arbitration > U64) throw Error('Invalid deadline or review windows');
  return { network: 'testnet', contractId: config.contractId, init: structuredClone(args), arbitrationDeadlineNs: String(deadline + appeal + arbitration), signed: false, broadcast: false };
}
export function pinnedMismatches(plan, status) {
  const errors = [];
  if (status.version !== 'flashfirm-treasury/0.2') errors.push('version');
  for (const key of ['buyer', 'evaluators', 'recipients', 'task_root', 'policy_hash', 'arbiter', 'deadline_ns', 'appeal_window_ns']) {
    if (JSON.stringify(status[key]) !== JSON.stringify(plan.init[key])) errors.push(key);
  }
  if (status.arbitration_deadline_ns !== plan.arbitrationDeadlineNs) errors.push('arbitration_deadline_ns');
  return errors;
}
export function treasuryAction(plan, status, actor, method, input, nowNs) {
  account(actor);
  if (pinnedMismatches(plan, status).length) throw Error('Treasury configuration mismatch');
  if (typeof nowNs !== 'bigint' || nowNs < 0n) throw Error('Verified chain timestamp required');
  const phase = status.phase, buyer = actor === status.buyer;
  let args = {}, deposit = '0';
  const require = (condition, message) => { if (!condition) throw Error(message); };
  switch (method) {
    case 'fund': {
      require(buyer && phase === 'Empty' && nowNs < BigInt(status.deadline_ns), 'Only buyer may fund an unexpired empty treasury');
      const amount = integer(input.amount_yocto, U128);
      require(amount > 0n && amount <= 10n ** 22n, 'Browser test deposit must be between 1 yocto and 0.01 NEAR');
      deposit = String(amount); break;
    }
    case 'propose': {
      require(buyer && phase === 'Funded' && nowNs < BigInt(status.deadline_ns), 'Buyer proposal unavailable');
      require(Array.isArray(input.amounts_yocto) && input.amounts_yocto.length === status.recipients.length, 'One amount per pinned recipient required');
      const total = input.amounts_yocto.reduce((sum, n) => sum + integer(n, U128), 0n);
      require(total === integer(status.funded_yocto, U128), 'Allocation must equal funded amount');
      args = { amounts_yocto: [...input.amounts_yocto], evidence_root: hash(input.evidence_root) }; break;
    }
    case 'approve': {
      const index = status.evaluators.indexOf(actor);
      require(phase === 'Reviewing' && index >= 0 && !status.approvals[index] && nowNs < BigInt(status.deadline_ns), 'Evaluator approval unavailable');
      args = { plan_hash: hash(status.plan_hash) }; break;
    }
    case 'challenge':
      require(['Reviewing', 'Approved'].includes(phase) && [...status.recipients, ...status.evaluators].includes(actor) && !status.challenge_root && nowNs < BigInt(status.release_at_ns ?? status.deadline_ns), 'Challenge unavailable');
      args = { plan_hash: hash(status.plan_hash), reason_root: hash(input.reason_root) }; break;
    case 'resolve_challenge':
      require(actor === status.arbiter && ['Reviewing', 'Approved'].includes(phase) && !!status.challenge_root && !status.resolution_root && nowNs < BigInt(status.arbitration_deadline_ns), 'Pinned arbiter resolution unavailable');
      require(typeof input.uphold === 'boolean' && (!input.uphold || status.release_at_ns !== null), 'Uphold requires quorum');
      args = { plan_hash: hash(status.plan_hash), challenge_root: hash(status.challenge_root), uphold: input.uphold, resolution_root: hash(input.resolution_root) }; break;
    case 'make_refund_available': {
      const timeout = !!status.challenge_root && !status.resolution_root && nowNs >= BigInt(status.arbitration_deadline_ns);
      require(buyer && (timeout && ['Reviewing', 'Approved'].includes(phase) || !status.challenge_root && ['Funded', 'Reviewing'].includes(phase) && nowNs >= BigInt(status.deadline_ns)), 'Refund unavailable');
      break;
    }
    case 'claim_for': {
      const index = status.recipients.indexOf(input.recipient);
      require(index >= 0 && (phase === 'RefundAvailable' || phase === 'Approved' && status.release_allowed === true), 'Claim blocked by review or recipient policy');
      require(integer(status.credits_yocto[index], U128) > 0n && integer(status.pending_yocto[index], U128) === 0n, 'No available credit');
      args = { recipient: input.recipient }; break;
    }
    default: throw Error('Unsupported treasury operation');
  }
  return { signerId: actor, receiverId: plan.contractId, actions: [{ type: 'FunctionCall', params: { methodName: method, args, gas: '100000000000000', deposit } }] };
}

// A wallet popup result is not a payment proof. Check final RPC outcome separately.
export function checkTransaction(outcome, expected) {
  const tx = outcome?.transaction;
  if (!tx || tx.signer_id !== expected.signerId || tx.receiver_id !== expected.receiverId || tx.actions?.length !== 1) throw Error('Transaction identity mismatch');
  const action = tx.actions[0].FunctionCall, requested = expected.actions[0].params;
  const decoded = action && JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(action.args), c => c.charCodeAt(0))));
  const canonical = value => Array.isArray(value) ? `[${value.map(canonical)}]` : value && typeof value === 'object' ? `{${Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',')}}` : JSON.stringify(value);
  if (!action || action.method_name !== requested.methodName || String(action.deposit) !== requested.deposit || String(action.gas) !== requested.gas || canonical(decoded) !== canonical(requested.args)) throw Error('Transaction action mismatch');
  if (outcome.final_execution_status !== 'FINAL') throw Error('Transaction not final');
  if (!outcome.status || !Object.hasOwn(outcome.status, 'SuccessValue') || outcome.receipts_outcome?.some(r => r.outcome?.status?.Failure) || outcome.transaction_outcome?.outcome?.status?.Failure) throw Error('Transaction or receipt failed');
  if (!Array.isArray(outcome.receipts_outcome) || outcome.receipts_outcome.length === 0) throw Error('Missing execution receipts');
  if (requested.methodName === 'claim_for' && outcome.status.SuccessValue !== btoa('true')) throw Error('Transfer callback did not confirm payment');
  return { final: true, transactionHash: tx.hash, transferCallbackSucceeded: requested.methodName === 'claim_for' };
}

import { createHash } from 'node:crypto';
import { canonical } from './protocol.mjs';

const U64 = (1n << 64n) - 1n;
const MIN_WINDOW = 60_000_000_000n, MAX_WINDOW = 604_800_000_000_000n;
const fields = ['buyer', 'evaluators', 'recipients', 'task_root', 'deadline_ns', 'arbiter', 'policy_hash', 'appeal_window_ns', 'arbitration_window_ns'];
function integer(value) {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,19})$/.test(value) || BigInt(value) > U64) throw Error('Expected canonical u64 decimal string');
  return BigInt(value);
}
function account(value) {
  // Restrict this deployment helper to named testnet accounts, never mainnet.
  if (typeof value !== 'string' || value.length > 64 || !/^(?:[a-z0-9]+(?:[-_][a-z0-9]+)*\.)+testnet$/.test(value)) throw Error('Named .testnet account required');
}
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
  for (const key of ['task_root', 'policy_hash']) if (!/^[a-f0-9]{64}$/.test(args[key])) throw Error('SHA256 commitment required');
  const deadline = integer(args.deadline_ns), appeal = integer(args.appeal_window_ns), arbitration = integer(args.arbitration_window_ns);
  if (deadline <= nowNs || appeal < MIN_WINDOW || appeal > MAX_WINDOW || arbitration < MIN_WINDOW || arbitration > MAX_WINDOW || deadline + appeal + arbitration > U64) throw Error('Invalid deadline or review windows');
  return { network: 'testnet', contractId: config.contractId, init: structuredClone(args), arbitrationDeadlineNs: String(deadline + appeal + arbitration), signed: false, broadcast: false };
}
export function base58(bytes) {
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let value = BigInt('0x' + Buffer.from(bytes).toString('hex')), result = '';
  while (value > 0n) { result = alphabet[Number(value % 58n)] + result; value /= 58n; }
  for (const byte of bytes) { if (byte !== 0) break; result = '1' + result; }
  return result;
}
export function verifyDeployment(plan, wasm, accountView, status) {
  const expectedCodeHash = base58(createHash('sha256').update(wasm).digest());
  const mismatches = [];
  if (accountView.code_hash !== expectedCodeHash) mismatches.push('code_hash');
  if (status.version !== 'flashfirm-treasury/0.2') mismatches.push('version');
  for (const key of ['buyer', 'evaluators', 'recipients', 'task_root', 'policy_hash', 'arbiter', 'deadline_ns', 'appeal_window_ns']) {
    if (canonical(status[key]) !== canonical(plan.init[key])) mismatches.push(key);
  }
  if (status.arbitration_deadline_ns !== plan.arbitrationDeadlineNs) mismatches.push('arbitration_deadline_ns');
  return { valid: mismatches.length === 0, mismatches, expectedCodeHash, paymentVerified: false, independentOperatorsVerified: false };
}

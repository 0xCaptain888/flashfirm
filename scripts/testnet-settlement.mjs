// Same-operator development settlement. Never signs for the buyer wallet.
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { connect, keyStores, KeyPair, transactions } from 'near-api-js';
import { validateIndependentSetup, verifyRoleKey, requireFinalSuccess, DEVELOPER_ACCOUNT } from '../src/independent-deployment.mjs';
import { nearRpc, FASTNEAR_TESTNET_RPC, inspectTreasury } from '../src/near-rpc.mjs';
import { treasuryAction, checkTransaction } from '../src/treasury-policy.mjs';
import { base58 } from '../src/near-deployment.mjs';
import { verifyLiveReceipt } from '../src/live.mjs';

const mode = process.argv[2];
if (!['verify', 'topup', 'approve', 'claim'].includes(mode)) throw Error('Expected verify|topup|approve|claim');
const folder = new URL('../.runtime/independent-testnet/', import.meta.url);
const read = async file => JSON.parse(await readFile(new URL(file, folder), 'utf8'));
const save = (file, value, exclusive = false) => writeFile(new URL(file, folder), JSON.stringify(value, null, 2), { mode: 0o600, flag: exclusive ? 'wx' : 'w' });
const setup = await read('setup-public.json'), plan = validateIndependentSetup(setup);
const build = JSON.parse(await readFile(new URL('../artifacts/contract-build.json', import.meta.url), 'utf8'));
const receiptBytes = await readFile(new URL('../evidence/live-receipt.json', import.meta.url));
const root = createHash('sha256').update(receiptBytes).digest('hex');
if (root !== plan.init.task_root || !verifyLiveReceipt(JSON.parse(receiptBytes)).valid) throw Error('Live receipt mismatch or invalid signature');
const amount = '1000000000000000000000', worker = plan.init.recipients[1];
const fundingHash = 'G5hbCx8FqcW5Fux7ew1m3sHTbQRF7PpzLRiRF6H4gzc1';
const proposalHash = 'BTzQkokdgPgJsXdpGUwymzcdscGZh74fdoEUicuMVRtG';
let lastRead = 0;
async function rpc(method, params) {
  for (let retry = 0; ; retry++) {
    await delay(Math.max(0, 1000 - (Date.now() - lastRead))); lastRead = Date.now();
    try { return await nearRpc(method, params, fetch, FASTNEAR_TESTNET_RPC); }
    catch (e) { if (e.message !== 'Testnet RPC HTTP 429' || retry >= 3) throw e; await delay(2000 * 2 ** retry); }
  }
}
const snapshot = () => inspectTreasury(plan, base58(Buffer.from(build.sha256, 'hex')), rpc);
function expected(signer, method, args, deposit = '0') {
  return { signerId: signer, receiverId: plan.contractId, actions: [{ type: 'FunctionCall', params: { methodName: method, args, gas: '100000000000000', deposit } }] };
}
async function verifyHash(hash, tx, file) {
  const outcome = await rpc('tx', { tx_hash: hash, sender_account_id: tx.signerId, wait_until: 'FINAL' });
  if (outcome.transaction?.hash !== hash) throw Error('Unexpected transaction hash');
  checkTransaction(outcome, tx); await save(file, outcome); return outcome;
}
if ((await rpc('status', [])).chain_id !== 'testnet') throw Error('Wrong network');
await verifyHash(fundingHash, expected(plan.init.buyer, 'fund', {}, amount), 'fund-final-public.json');
await verifyHash(proposalHash, expected(plan.init.buyer, 'propose', { amounts_yocto: ['0', amount], evidence_root: root }), 'proposal-final-public.json');
function validateAllocation(state) {
  const s = state.status;
  if (s.funded_yocto !== amount || s.evidence_root !== root || !/^[a-f0-9]{64}$/.test(s.plan_hash || '') || s.challenge_root || s.resolution_root) throw Error('Unexpected allocation or challenge; stop');
  if (s.paid_yocto === '0' && (JSON.stringify(s.credits_yocto) !== JSON.stringify(['0', amount]) || s.pending_yocto.some(n => n !== '0'))) throw Error('Unexpected credits or pending transfer');
}
async function execute(actor, method, input, journal) {
  const state = await snapshot(); validateAllocation(state);
  const tx = treasuryAction(plan, state.status, actor, method, input, state.timestampNs);
  const role = setup.accounts.find(a => a.accountId === actor);
  if (!role || actor === plan.init.buyer) throw Error('Only pinned local test roles may sign');
  verifyRoleKey(role, await rpc('query', { request_type: 'view_access_key_list', finality: 'final', account_id: actor }));
  const keys = await read('role-keys.json'), pair = KeyPair.fromString(keys[actor]);
  if (pair.getPublicKey().toString() !== role.publicKey) throw Error('Local role key mismatch');
  const keyStore = new keyStores.InMemoryKeyStore(); await keyStore.setKey('testnet', actor, pair);
  const account = await (await connect({ networkId: 'testnet', nodeUrl: FASTNEAR_TESTNET_RPC, keyStore })).account(actor);
  await save(`${journal}-attempt.json`, { tx, planHash: state.status.plan_hash, at: new Date().toISOString() }, true);
  const p = tx.actions[0].params;
  const outcome = await account.signAndSendTransaction({ receiverId: tx.receiverId, actions: [transactions.functionCall(p.methodName, p.args, BigInt(p.gas), BigInt(p.deposit))] });
  const hash = outcome.transaction?.hash;
  if (!hash) throw Error('No hash returned; inspect before retrying');
  await save(`${journal}-hash.json`, { hash, tx });
  await verifyHash(hash, tx, `${journal}-final-public.json`);
  console.log(JSON.stringify({ status: 'FINAL_TRANSACTION_VERIFIED', actor, method, transactionHash: hash, independentOperators: false }));
}
let state = await snapshot(); validateAllocation(state);
// First review-a attempt was definitively rejected with NotEnoughBalance before execution.
// Preserve that attempt and use a separate journal after topping up the test role.
const approvalJournal = index => index === 0 ? 'approve-0-funded' : `approve-${index}`;
if (mode === 'topup') {
  const credentials = await read('developer-key.json');
  if (credentials.accountId !== DEVELOPER_ACCOUNT || credentials.network !== 'testnet') throw Error('Wrong faucet-funded sponsor');
  verifyRoleKey(credentials, await rpc('query', { request_type: 'view_access_key_list', finality: 'final', account_id: DEVELOPER_ACCOUNT }));
  const pair = KeyPair.fromString(credentials.privateKey);
  if (pair.getPublicKey().toString() !== credentials.publicKey) throw Error('Sponsor key mismatch');
  const keyStore = new keyStores.InMemoryKeyStore(); await keyStore.setKey('testnet', DEVELOPER_ACCOUNT, pair);
  const sponsor = await (await connect({ networkId: 'testnet', nodeUrl: FASTNEAR_TESTNET_RPC, keyStore })).account(DEVELOPER_ACCOUNT);
  for (const actor of [...plan.init.evaluators.slice(0, 2), worker]) {
    const role = setup.accounts.find(a => a.accountId === actor);
    verifyRoleKey(role, await rpc('query', { request_type: 'view_access_key_list', finality: 'final', account_id: actor }));
    const journal = `gas-topup-${actor.split('.')[0]}`;
    let previous;
    try { previous = await read(`${journal}-hash.json`); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    if (previous) {
      const final = await rpc('tx', { tx_hash: previous.hash, sender_account_id: DEVELOPER_ACCOUNT, wait_until: 'FINAL' });
      requireFinalSuccess(final, DEVELOPER_ACCOUNT, actor); continue;
    }
    await save(`${journal}-attempt.json`, { signer: DEVELOPER_ACCOUNT, receiver: actor, amountYocto: '200000000000000000000000' }, true);
    const outcome = await sponsor.signAndSendTransaction({ receiverId: actor, actions: [transactions.transfer(200000000000000000000000n)] });
    if (!outcome.transaction?.hash) throw Error('Missing topup hash');
    await save(`${journal}-hash.json`, { hash: outcome.transaction.hash });
    const final = await rpc('tx', { tx_hash: outcome.transaction.hash, sender_account_id: DEVELOPER_ACCOUNT, wait_until: 'FINAL' });
    requireFinalSuccess(final, DEVELOPER_ACCOUNT, actor); await save(`${journal}-final-public.json`, final);
    console.log(JSON.stringify({ status: 'TEST_ROLE_GAS_TOPUP_FINAL', actor, testnetNear: '0.2', hash: outcome.transaction.hash }));
  }
}
if (mode === 'approve') {
  for (const index of [0, 1]) {
    state = await snapshot(); validateAllocation(state);
    if (state.status.approvals[index]) continue;
    await execute(plan.init.evaluators[index], 'approve', {}, approvalJournal(index));
  }
}
if (mode === 'claim' && state.status.paid_yocto === '0') {
  if (!state.status.release_allowed) throw Error(`Release not allowed yet; release_at_ns=${state.status.release_at_ns}`);
  await execute(worker, 'claim_for', { recipient: worker }, 'worker-claim');
}
state = await snapshot(); validateAllocation(state);
const approvalEvidence = [];
for (const index of [0, 1]) {
  if (!state.status.approvals[index]) continue;
  const saved = await read(`${approvalJournal(index)}-hash.json`);
  await verifyHash(saved.hash, expected(plan.init.evaluators[index], 'approve', { plan_hash: state.status.plan_hash }), `approve-${index}-final-public.json`);
  approvalEvidence.push({ accountId: plan.init.evaluators[index], transactionHash: saved.hash });
}
let payoutHash = null;
if (state.status.paid_yocto !== '0') {
  if (state.status.paid_yocto !== amount || state.status.credits_yocto.some(n => n !== '0') || state.status.pending_yocto.some(n => n !== '0')) throw Error('Incomplete or unexpected settlement');
  const saved = await read('worker-claim-hash.json');
  const outcome = await verifyHash(saved.hash, expected(worker, 'claim_for', { recipient: worker }), 'worker-claim-final-public.json');
  if (!outcome.receipts_outcome.some(r => r.outcome.executor_id === worker && Object.hasOwn(r.outcome.status, 'SuccessValue'))) throw Error('Missing worker execution receipt');
  payoutHash = saved.hash;
}
const evidence = { status: payoutHash ? 'TESTNET_PAYOUT_VERIFIED' : 'TESTNET_PLAN_VERIFIED', network: 'testnet', contractId: plan.contractId, buyer: plan.init.buyer, recipient: worker, fundingHash, proposalHash, evidenceRoot: root, planHash: state.status.plan_hash, approvals: approvalEvidence, payoutHash, fundedYocto: state.status.funded_yocto, paidYocto: state.status.paid_yocto, phase: state.status.phase, releaseAtNs: state.status.release_at_ns, releaseAllowed: state.status.release_allowed, blockHash: state.blockHash, blockHeight: state.blockHeight, checkedAt: new Date().toISOString(), independentOperators: false, semanticQualityIndependentlyVerified: false, paymentVerified: !!payoutHash };
await save('settlement-public.json', evidence); console.log(JSON.stringify(evidence));

// Disposable developer-funded TESTNET scenarios. No buyer-wallet signing.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import assert from 'node:assert/strict';
import { connect, keyStores, KeyPair, transactions } from 'near-api-js';
import { DEVELOPER_ACCOUNT, verifyRoleKey, requireFinalSuccess } from '../src/independent-deployment.mjs';
import { nearRpc, FASTNEAR_TESTNET_RPC, inspectTreasury } from '../src/near-rpc.mjs';
import { prepareTestnet, treasuryAction, checkTransaction } from '../src/treasury-policy.mjs';
import { base58 } from '../src/near-deployment.mjs';

const mode = process.argv[2];
if (!['prepare', 'replace-expiry', 'run', 'verify'].includes(mode)) throw Error('Expected prepare|replace-expiry|run|verify');
const directory = new URL('../.runtime/testnet-exceptions/', import.meta.url);
const original = new URL('../.runtime/independent-testnet/', import.meta.url);
await mkdir(directory, { recursive: true, mode: 0o700 });
const read = async (name, root = directory) => JSON.parse(await readFile(new URL(name, root), 'utf8'));
const save = (name, value, exclusive = false) => writeFile(new URL(name, directory), JSON.stringify(value, null, 2), { mode: 0o600, flag: exclusive ? 'wx' : 'w' });
const hash = value => createHash('sha256').update(value).digest('hex');
const amount = '1000000000000000000000', gas = 100000000000000n;
let lastRead = 0;
async function rpc(method, params) {
  for (let retry = 0; ; retry++) {
    await delay(Math.max(0, 1100 - (Date.now() - lastRead))); lastRead = Date.now();
    try { return await nearRpc(method, params, fetch, FASTNEAR_TESTNET_RPC); }
    catch (error) { if (error.message !== 'Testnet RPC HTTP 429' || retry === 3) throw error; await delay(2000 * 2 ** retry); }
  }
}
const setup = await read('setup-public.json', original);
const credentials = await read('developer-key.json', original);
if (credentials.accountId !== DEVELOPER_ACCOUNT || credentials.network !== 'testnet') throw Error('Wrong developer');
if (mode === 'prepare') {
  const records = ['dispute', 'expiry'].map(name => {
    const pair = KeyPair.fromRandom('ed25519');
    return { scenario: name, accountId: `exception-${name}.${DEVELOPER_ACCOUNT}`, publicKey: pair.getPublicKey().toString(), privateKey: pair.toString() };
  });
  await save('keys.json', records, true);
  await save('plan.json', { network: 'testnet', sponsor: DEVELOPER_ACCOUNT, accounts: records.map(({ privateKey, ...publicData }) => publicData), storagePerContractYocto: '2000000000000000000000000', fundingPerContractYocto: amount, sameOperator: true }, true);
  console.log('Prepared two new developer-only testnet scenarios; no transaction sent.'); process.exit(0);
}
if ((await rpc('status', [])).chain_id !== 'testnet') throw Error('Wrong network');
const records = await read('keys.json');
assert.equal(records.length, 2);
assert.equal(records[0].accountId, `exception-dispute.${DEVELOPER_ACCOUNT}`);
assert.ok([`exception-expiry.${DEVELOPER_ACCOUNT}`, `exception-expiry2.${DEVELOPER_ACCOUNT}`].includes(records[1].accountId));
if (mode === 'replace-expiry') {
  assert.equal(records[1].accountId, `exception-expiry.${DEVELOPER_ACCOUNT}`);
  const balance = await rpc('query', { request_type: 'view_account', account_id: DEVELOPER_ACCOUNT, finality: 'final' });
  // 2 NEAR storage funding + 0.13 NEAR retained for the 100-Tgas sponsor
  // call prepayment, existing storage and the 0.001 refundable test deposit.
  if (BigInt(balance.amount) < 213n * 10n ** 22n) throw Error('Insufficient developer reserve for separate recovery account');
  const pair = KeyPair.fromRandom('ed25519');
  await save('original-keys-retained.json', records, true);
  records[1] = { scenario: 'expiry2', accountId: `exception-expiry2.${DEVELOPER_ACCOUNT}`, publicKey: pair.getPublicKey().toString(), privateKey: pair.toString() };
  await save('replacement-reason.json', { reason: 'RPC 429 during original expiry deployment; no hash returned. Original intent and account preserved; never replayed.', original: `exception-expiry.${DEVELOPER_ACCOUNT}`, replacement: records[1].accountId }, true);
  await save('keys.json', records);
  console.log('Prepared separate expiry recovery account; old keys, account and pending intent preserved.'); process.exit(0);
}
const roleKeys = await read('role-keys.json', original), keyStore = new keyStores.InMemoryKeyStore();
const known = [{ ...credentials }, ...setup.accounts.map(role => ({ ...role, privateKey: roleKeys[role.accountId] })), ...records];
for (const role of known) {
  const key = KeyPair.fromString(role.privateKey);
  assert.equal(key.getPublicKey().toString(), role.publicKey);
  await keyStore.setKey('testnet', role.accountId, key);
}
const near = await connect({ networkId: 'testnet', nodeUrl: FASTNEAR_TESTNET_RPC, keyStore });
const wasm = await readFile(new URL('../artifacts/flashfirm_treasury.wasm', import.meta.url));
const build = JSON.parse(await readFile(new URL('../artifacts/contract-build.json', import.meta.url), 'utf8'));
assert.equal(hash(wasm), build.sha256);
const codeHash = base58(Buffer.from(build.sha256, 'hex'));
await verifyRoleKey(credentials, await rpc('query', { request_type: 'view_access_key_list', finality: 'final', account_id: DEVELOPER_ACCOUNT }));
async function submit(label, actor, receiver, actions, expected) {
  let receipt;
  try { receipt = await read(`${label}-hash.json`); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  if (!receipt) {
    if (mode !== 'run') throw Error(`Missing recorded transaction ${label}`);
    // Exclusive intent is a fence: no replay after an ambiguous transport failure.
    await save(`${label}-intent.json`, { actor, receiver, at: new Date().toISOString() }, true);
    const outcome = await (await near.account(actor)).signAndSendTransaction({ receiverId: receiver, actions });
    if (!outcome.transaction?.hash) throw Error('Missing transaction hash; inspect manually');
    receipt = { hash: outcome.transaction.hash, actor, receiver }; await save(`${label}-hash.json`, receipt);
  }
  assert.equal(receipt.actor, actor); assert.equal(receipt.receiver, receiver);
  const final = await rpc('tx', { tx_hash: receipt.hash, sender_account_id: actor, wait_until: 'FINAL' });
  assert.equal(final.transaction.hash, receipt.hash);
  requireFinalSuccess(final, actor, receiver);
  if (expected) checkTransaction(final, expected);
  await save(`${label}-final.json`, final);
  console.log(JSON.stringify({ step: label, hash: receipt.hash, final: true }));
  return receipt.hash;
}
const results = [];
// First arbiter dispatch was definitively rejected with NotEnoughBalance before
// execution. Preserve its journal; fund the test role and use a new explicit step.
if (mode === 'run') await submit('arbiter-gas-topup', DEVELOPER_ACCOUNT, setup.config.init.arbiter, [transactions.transfer(200000000000000000000000n)]);
for (const record of records) {
  const name = record.scenario, id = record.accountId;
  if (mode === 'run') {
    await submit(`${name}-create`, DEVELOPER_ACCOUNT, id, [transactions.createAccount(), transactions.transfer(2n * 10n ** 24n), transactions.addKey(KeyPair.fromString(record.privateKey).getPublicKey(), transactions.fullAccessKey())]);
    verifyRoleKey(record, await rpc('query', { request_type: 'view_access_key_list', finality: 'final', account_id: id }));
  }
  let config;
  try { config = await read(`${name}-config.json`); } catch (e) {
    if (e.code !== 'ENOENT' || mode !== 'run') throw e;
    const block = await rpc('block', { finality: 'final' });
    config = { network: 'testnet', contractId: id, init: { ...setup.config.init, buyer: DEVELOPER_ACCOUNT, recipients: [DEVELOPER_ACCOUNT, setup.config.init.recipients[1]], task_root: hash(`testnet exception ${name}`), policy_hash: hash('same operator test only; developer funds'), deadline_ns: String(BigInt(block.header.timestamp_nanosec) + (name.startsWith('expiry') ? 180n : 1800n) * 1000000000n), appeal_window_ns: '60000000000', arbitration_window_ns: '60000000000' } };
    await save(`${name}-config.json`, config, true);
  }
  const plan = prepareTestnet(config, 0n), snapshot = () => inspectTreasury(plan, codeHash, rpc);
  if (mode === 'run') await submit(`${name}-deploy`, id, id, [transactions.deployContract(wasm), transactions.functionCall('new', plan.init, gas, 0n)]);
  async function call(step, actor, method, input) {
    let recorded;
    try { recorded = await read(`${name}-${step}-tx.json`); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    if (!recorded) {
      if (mode !== 'run') throw Error('Missing expected transaction');
      const state = await snapshot();
      recorded = treasuryAction(plan, state.status, actor, method, input, state.timestampNs);
      await save(`${name}-${step}-tx.json`, recorded, true);
    }
    assert.equal(recorded.signerId, actor); assert.equal(recorded.receiverId, id);
    assert.equal(recorded.actions[0].params.methodName, method);
    const p = recorded.actions[0].params;
    return submit(`${name}-${step}`, actor, id, [transactions.functionCall(p.methodName, p.args, BigInt(p.gas), BigInt(p.deposit))], recorded);
  }
  const proof = { scenario: name, contractId: id, network: 'testnet', independentOperators: false, userWalletFundsUsed: false, amountYocto: amount, transactions: {} };
  proof.transactions.fund = await call('fund', DEVELOPER_ACCOUNT, 'fund', { amount_yocto: amount });
  if (name === 'dispute') {
    proof.transactions.propose = await call('propose', DEVELOPER_ACCOUNT, 'propose', { amounts_yocto: ['0', amount], evidence_root: hash('disputed test delivery') });
    // Challenge before quorum. This avoids racing a short appeal window.
    proof.transactions.challenge = await call('challenge', DEVELOPER_ACCOUNT, 'challenge', { reason_root: hash('deliberate test challenge') });
    if (mode === 'run') {
      const frozen = await snapshot(); assert.ok(frozen.status.challenge_root);
      if (frozen.status.phase !== 'Closed') {
        assert.equal(frozen.status.release_allowed, false);
        await save(`${name}-frozen.json`, { phase: frozen.status.phase, challengeRoot: frozen.status.challenge_root, releaseAllowed: frozen.status.release_allowed, blockHeight: frozen.blockHeight });
      }
    }
    proof.transactions.resolve = await call('resolve-funded', plan.init.arbiter, 'resolve_challenge', { uphold: false, resolution_root: hash('refund deliberate test delivery') });
  } else {
    if (mode === 'run') {
      let state = await snapshot();
      while (state.timestampNs < BigInt(plan.init.deadline_ns)) {
        console.log('Waiting for testnet expiry; no transaction submitted.'); await delay(15000); state = await snapshot();
      }
    }
    proof.transactions.refund = await call('refund', DEVELOPER_ACCOUNT, 'make_refund_available', {});
  }
  proof.transactions.claim = await call('claim', DEVELOPER_ACCOUNT, 'claim_for', { recipient: DEVELOPER_ACCOUNT });
  const final = await snapshot();
  assert.equal(final.status.phase, 'Closed'); assert.equal(final.status.paid_yocto, amount); assert.equal(final.status.funded_yocto, amount);
  assert.ok(final.status.credits_yocto.every(x => x === '0')); assert.ok(final.status.pending_yocto.every(x => x === '0'));
  results.push({ ...proof, phase: final.status.phase, blockHeight: final.blockHeight, verifiedAt: new Date().toISOString() });
  await save('evidence-public.json', { status: 'VERIFIED', scenarios: results, failedTransferRecovery: 'SANDBOX_ONLY' });
}
console.log(JSON.stringify({ status: 'TESTNET_EXCEPTIONS_VERIFIED', scenarios: results, failedTransferRecovery: 'SANDBOX_ONLY' }));

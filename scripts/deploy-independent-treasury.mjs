import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { connect, keyStores, KeyPair, transactions } from 'near-api-js';
import { DEVELOPER_ACCOUNT, BUYER_ACCOUNT, validateIndependentSetup, verifyRoleKey, requireFinalSuccess } from '../src/independent-deployment.mjs';
import { nearRpc, FASTNEAR_TESTNET_RPC, inspectTreasury } from '../src/near-rpc.mjs';
import { base58 } from '../src/near-deployment.mjs';

const mode = process.argv[2];
if (!['prepare', 'provision', 'deploy', 'verify'].includes(mode)) throw Error('Expected prepare|provision|deploy|verify');
const folder = new URL('../.runtime/independent-testnet/', import.meta.url);
const read = async file => JSON.parse(await readFile(new URL(file, folder), 'utf8'));
const save = (file, data, exclusive = false) => writeFile(new URL(file, folder), JSON.stringify(data, null, 2), { mode: 0o600, flag: exclusive ? 'wx' : 'w' });
const digest = data => createHash('sha256').update(data).digest('hex');
let lastRead = 0;
async function rpc(method, params) {
  for (let attempt = 0; ; attempt++) {
    await delay(Math.max(0, 1000 - (Date.now() - lastRead))); lastRead = Date.now();
    try { return await nearRpc(method, params, fetch, FASTNEAR_TESTNET_RPC); }
    catch (error) { if (error.message !== 'Testnet RPC HTTP 429' || attempt === 3) throw error; await delay(2000 * 2 ** attempt); }
  }
}
if (mode === 'prepare') {
  try { await read('role-keys.json'); throw Error('Role keys already exist; preserve the existing plan'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  const accounts = [], keys = {};
  for (const [index, role] of ['treasury', 'review-a', 'review-b', 'review-c', 'arbiter', 'worker'].entries()) {
    const accountId = `${role}.${DEVELOPER_ACCOUNT}`, key = KeyPair.fromRandom('ed25519');
    keys[accountId] = key.toString();
    accounts.push({ accountId, publicKey: key.getPublicKey().toString(), amountYocto: index === 0 ? '2500000000000000000000000' : '100000000000000000000000' });
  }
  const config = { network: 'testnet', contractId: accounts[0].accountId, init: { buyer: BUYER_ACCOUNT, evaluators: accounts.slice(1, 4).map(a => a.accountId), recipients: [BUYER_ACCOUNT, accounts[5].accountId], arbiter: accounts[4].accountId, task_root: digest(await readFile(new URL('../evidence/live-receipt.json', import.meta.url))), policy_hash: digest('FlashFirm independent developer-funded deployment; same-operator review; v0.2; native testnet NEAR'), deadline_ns: String((BigInt(Date.now()) + 7n * 86400000n) * 1000000n), appeal_window_ns: '60000000000', arbitration_window_ns: '60000000000' } };
  const setup = { version: 'flashfirm-independent-testnet/1', developer: DEVELOPER_ACCOUNT, independentOperators: false, config, accounts };
  validateIndependentSetup(setup);
  await save('role-keys.json', keys, true); await save('setup-public.json', setup, true); await save('config-public.json', config, true);
  console.log(JSON.stringify({ status: 'INDEPENDENT_SETUP_PREPARED', developer: DEVELOPER_ACCOUNT, buyer: BUYER_ACCOUNT, contractId: config.contractId, totalTestnetNear: '3', gasAdditional: true, source: 'developer faucet funds', meteorFundsUsed: false }));
  process.exit(0);
}
const setup = await read('setup-public.json'), plan = validateIndependentSetup(setup, mode === 'deploy' ? BigInt(Date.now()) * 1000000n : 0n);
if ((await rpc('status', [])).chain_id !== 'testnet') throw Error('Wrong network');
const wasm = await readFile(new URL('../artifacts/flashfirm_treasury.wasm', import.meta.url));
const build = JSON.parse(await readFile(new URL('../artifacts/contract-build.json', import.meta.url), 'utf8'));
if (digest(wasm) !== build.sha256 || wasm.length !== build.bytes) throw Error('Wasm build mismatch');
const codeHash = base58(Buffer.from(build.sha256, 'hex'));
async function roleExists(role) {
  try {
    // Some RPC implementations return an empty key list for an absent account.
    await rpc('query', { request_type: 'view_account', finality: 'final', account_id: role.accountId });
    const view = await rpc('query', { request_type: 'view_access_key_list', finality: 'final', account_id: role.accountId });
    verifyRoleKey(role, view); return true;
  } catch (e) { if (e.rpcCause === 'UNKNOWN_ACCOUNT') return false; throw e; }
}
async function signer(accountId, privateKey, publicKey) {
  const pair = KeyPair.fromString(privateKey);
  if (pair.getPublicKey().toString() !== publicKey) throw Error('Local signer mismatch');
  const keyStore = new keyStores.InMemoryKeyStore(); await keyStore.setKey('testnet', accountId, pair);
  return (await connect({ networkId: 'testnet', nodeUrl: FASTNEAR_TESTNET_RPC, keyStore })).account(accountId);
}
async function send(account, receiverId, actions, journal) {
  await save(`${journal}-attempt.json`, { signer: account.accountId, receiverId, at: new Date().toISOString() }, true);
  const outcome = await account.signAndSendTransaction({ receiverId, actions });
  const hash = outcome.transaction?.hash;
  if (!hash) throw Error('No hash returned; inspect chain, never automatically replay');
  await save(`${journal}-hash.json`, { transactionHash: hash, signer: account.accountId, receiverId });
  const final = await rpc('tx', { tx_hash: hash, sender_account_id: account.accountId, wait_until: 'FINAL' });
  requireFinalSuccess(final, account.accountId, receiverId);
  await save(`${journal}-final-public.json`, final);
  return hash;
}
if (mode === 'provision') {
  const credentials = await read('developer-key.json');
  if (credentials.accountId !== DEVELOPER_ACCOUNT || credentials.network !== 'testnet') throw Error('Wrong developer account');
  verifyRoleKey(credentials, await rpc('query', { request_type: 'view_access_key_list', finality: 'final', account_id: DEVELOPER_ACCOUNT }));
  const balance = await rpc('query', { request_type: 'view_account', finality: 'final', account_id: DEVELOPER_ACCOUNT });
  if (balance.code_hash !== '11111111111111111111111111111111') throw Error('Developer account unexpectedly contains code');
  const missing = [];
  for (const role of setup.accounts) {
    if (!await roleExists(role)) { missing.push(role); continue; }
    // Recover proof after a read timeout without replaying any transaction.
    const journal = `create-${role.accountId.split('.')[0]}`;
    let submitted;
    try { submitted = await read(`${journal}-hash.json`); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    if (submitted) {
      const final = await rpc('tx', { tx_hash: submitted.transactionHash, sender_account_id: DEVELOPER_ACCOUNT, wait_until: 'FINAL' });
      requireFinalSuccess(final, DEVELOPER_ACCOUNT, role.accountId);
      await save(`${journal}-final-public.json`, final);
    }
  }
  const required = missing.reduce((sum, role) => sum + BigInt(role.amountYocto), 5n * 10n ** 22n) + BigInt(balance.storage_usage) * 10n ** 19n;
  if (BigInt(balance.amount) < required) throw Error('Insufficient developer faucet balance');
  const account = await signer(DEVELOPER_ACCOUNT, credentials.privateKey, credentials.publicKey);
  const roleKeys = await read('role-keys.json');
  for (const role of missing) if (KeyPair.fromString(roleKeys[role.accountId]).getPublicKey().toString() !== role.publicKey) throw Error('Role key differs from public plan');
  for (const role of missing) {
    const hash = await send(account, role.accountId, [transactions.createAccount(), transactions.transfer(BigInt(role.amountYocto)), transactions.addKey(KeyPair.fromString(roleKeys[role.accountId]).getPublicKey(), transactions.fullAccessKey())], `create-${role.accountId.split('.')[0]}`);
    if (!await roleExists(role)) throw Error('Created account not yet verified; inspect before continuing');
    console.log(JSON.stringify({ status: 'ROLE_ACCOUNT_VERIFIED', accountId: role.accountId, transactionHash: hash, meteorFundsUsed: false }));
  }
  console.log(JSON.stringify({ status: 'ALL_SIX_ROLE_ACCOUNTS_VERIFIED', newTransactions: missing.length, meteorFundsUsed: false }));
} else if (mode === 'deploy') {
  for (const role of setup.accounts) if (!await roleExists(role)) throw Error(`Missing role ${role.accountId}`);
  const view = await rpc('query', { request_type: 'view_account', finality: 'final', account_id: plan.contractId });
  if (view.code_hash !== '11111111111111111111111111111111') throw Error('Existing code; use verify, never overwrite');
  if (BigInt(view.amount) < 2n * 10n ** 24n) throw Error('Insufficient contract storage reserve');
  const account = await signer(plan.contractId, (await read('role-keys.json'))[plan.contractId], setup.accounts[0].publicKey);
  const hash = await send(account, plan.contractId, [transactions.deployContract(wasm), transactions.functionCall('new', plan.init, 100000000000000n, 0n)], 'deploy');
  console.log(JSON.stringify({ status: 'DEPLOY_TRANSACTION_FINAL', transactionHash: hash, paymentVerified: false }));
}
if (mode === 'deploy' || mode === 'verify') {
  const state = await inspectTreasury(plan, codeHash, rpc);
  const evidence = { status: 'TESTNET_DEPLOYMENT_VERIFIED', network: 'testnet', contractId: plan.contractId, buyer: BUYER_ACCOUNT, blockHash: state.blockHash, blockHeight: state.blockHeight, wasmSha256: build.sha256, phase: state.status.phase, fundedYocto: state.status.funded_yocto, paidYocto: state.status.paid_yocto, independentOperators: false, paymentVerified: false, verificationScope: 'Deployment and current state only; use testnet-settlement.mjs verify for transaction and payment proof', deploymentUsedMeteorFunds: false, checkedAt: new Date().toISOString() };
  await save('deployment-public.json', evidence); console.log(JSON.stringify(evidence));
}

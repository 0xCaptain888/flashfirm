import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { connect, keyStores, KeyPair, transactions } from 'near-api-js';
import { setupTransactions } from '../src/testnet-setup.mjs';
import { base58 } from '../src/near-deployment.mjs';
import { inspectTreasury, nearRpc } from '../src/near-rpc.mjs';

const mode = process.argv[2];
if (!['verify-accounts', 'deploy', 'verify'].includes(mode)) throw Error('Usage: node scripts/deploy-wallet-treasury.mjs verify-accounts|deploy|verify');
const folder = new URL('../.runtime/testnet-deployment/', import.meta.url);
const setup = JSON.parse(await readFile(new URL('setup-public.json', folder), 'utf8'));
const { plan } = setupTransactions(setup, setup.controller, mode === 'deploy' ? undefined : 0n);
const network = await nearRpc('status', []);
if (network.chain_id !== 'testnet') throw Error('Testnet required');
const wasm = await readFile(new URL('../artifacts/flashfirm_treasury.wasm', import.meta.url));
const build = JSON.parse(await readFile(new URL('../artifacts/contract-build.json', import.meta.url), 'utf8'));
const digest = createHash('sha256').update(wasm).digest('hex');
if (digest !== build.sha256) throw Error('Wasm artifact mismatch');
const codeHash = base58(Buffer.from(digest, 'hex'));
if (mode === 'verify') {
  const state = await inspectTreasury(plan, codeHash);
  const evidence = { status: 'TESTNET_DEPLOYMENT_VERIFIED', network: 'testnet', contractId: plan.contractId, blockHash: state.blockHash, blockHeight: state.blockHeight, wasmSha256: digest, phase: state.status.phase, independentOperators: false, paymentVerified: false };
  await writeFile(new URL('deployment-public.json', folder), JSON.stringify(evidence, null, 2), { mode: 0o600 });
  console.log(JSON.stringify(evidence));
} else {
  const block = await nearRpc('block', { finality: 'final' });
  for (const account of setup.accounts) {
    const view = await nearRpc('query', { request_type: 'view_access_key_list', block_id: block.header.hash, account_id: account.accountId });
    if (view.keys.length !== 1 || view.keys[0].public_key !== account.publicKey || view.keys[0].access_key.permission !== 'FullAccess') throw Error(`Unexpected account keys: ${account.accountId}`);
  }
  if (mode === 'verify-accounts') {
    console.log(JSON.stringify({ status: 'ALL_SIX_SETUP_KEYS_VERIFIED', blockHash: block.header.hash, deploymentExecuted: false }));
  } else {
    const view = await nearRpc('query', { request_type: 'view_account', finality: 'final', account_id: plan.contractId });
    if (view.code_hash !== '11111111111111111111111111111111') throw Error('Contract already has code. Use verify; never overwrite an existing treasury.');
    if (BigInt(view.amount) < 2n * 10n ** 24n) throw Error('Insufficient storage and gas reserve');
    const keys = JSON.parse(await readFile(new URL('keys.json', folder), 'utf8'));
    const pair = KeyPair.fromString(keys[plan.contractId]);
    if (pair.getPublicKey().toString() !== setup.accounts[0].publicKey) throw Error('Local deployer key does not match public setup');
    const keyStore = new keyStores.InMemoryKeyStore(); await keyStore.setKey('testnet', plan.contractId, pair);
    const near = await connect({ networkId: 'testnet', nodeUrl: 'https://rpc.testnet.near.org', keyStore });
    const account = await near.account(plan.contractId);
    // Journal first. An ambiguous send must be resolved by inspection, never replayed.
    await writeFile(new URL('deploy-attempt.json', folder), JSON.stringify({ contractId: plan.contractId, wasmSha256: digest, attemptedAt: new Date().toISOString() }), { mode: 0o600, flag: 'wx' });
    const outcome = await account.signAndSendTransaction({ receiverId: plan.contractId, actions: [transactions.deployContract(wasm), transactions.functionCall('new', plan.init, 100000000000000n, 0n)] });
    const hash = outcome.transaction?.hash;
    if (!hash) throw Error('No transaction hash returned; inspect chain before any retry');
    const final = await nearRpc('tx', { tx_hash: hash, sender_account_id: plan.contractId, wait_until: 'FINAL' });
    if (final.final_execution_status !== 'FINAL' || !Object.hasOwn(final.status || {}, 'SuccessValue') || final.receipts_outcome?.some(r => r.outcome.status.Failure)) throw Error('Deployment not proven successful; inspect final transaction');
    await inspectTreasury(plan, codeHash);
    await writeFile(new URL('deploy-transaction-public.json', folder), JSON.stringify({ network: 'testnet', transactionHash: hash, contractId: plan.contractId, wasmSha256: digest, independentOperators: false, paymentVerified: false }, null, 2), { mode: 0o600 });
    console.log(JSON.stringify({ status: 'DEPLOYED_AND_INITIALIZED', contractId: plan.contractId, transactionHash: hash, paymentVerified: false }));
  }
}

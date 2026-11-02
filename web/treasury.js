import { setupWalletSelector } from '@near-wallet-selector/core';
import { setupMyNearWallet } from '@near-wallet-selector/my-near-wallet';
import { MeteorConnect, webpage_local_storage } from '@meteorwallet/sdk';
import { actionCreators } from 'meteor-transactions';
import { meteorAdapter } from '../src/meteor-wallet.mjs';
import { setupTransactions } from '../src/testnet-setup.mjs';
import { prepareTestnet, treasuryAction, checkTransaction } from '../src/treasury-policy.mjs';
import { inspectTreasury, nearRpc as requestRpc, FASTNEAR_TESTNET_RPC, TESTNET_RPC } from '../src/near-rpc.mjs';
import projectConfig from '../evidence/testnet-config.json';
// Read-only RPC calls only. Browser CORS support can differ from Node access.
async function nearRpc(method, params) {
  try { return await requestRpc(method, params, fetch, TESTNET_RPC); }
  catch (error) {
    if (!(error instanceof TypeError) && error.name !== 'TimeoutError' && !/^Testnet RPC HTTP (429|5\d\d)$/.test(error.message)) throw error;
    return requestRpc(method, params, fetch, FASTNEAR_TESTNET_RPC);
  }
}

const $ = id => document.getElementById(id), message = text => $('treasury-message').textContent = text;
const pendingKey = 'flashfirm:testnet:pending:v1';
let wallet, selector, meteor, plan, preview, actor = '', pending = null, busy = false;
let setupPlan;
try { pending = JSON.parse(sessionStorage.getItem(pendingKey) || 'null'); } catch { sessionStorage.removeItem(pendingKey); }
function invalidate() { preview = null; $('preview').hidden = true; }
function controls() { $('connect').disabled = busy || !wallet; $('wallet-provider').disabled = busy; $('disconnect').disabled = busy || !wallet; for (const id of ['setup-file', 'setup-preview', 'load-project', 'inspect', 'prepare', 'sign', 'verify-transaction', 'operation', 'treasury-config', 'action-input']) $(id).disabled = busy; $('setup-sign').disabled = true; $('setup-sign').textContent = 'Unavailable: Meteor blocks Full Access Keys'; }
$('setup-file').onchange = () => { setupPlan = null; $('setup-confirm').hidden = true; };
$('setup-json').oninput = () => { setupPlan = null; $('setup-confirm').hidden = true; };
$('setup-preview').onclick = () => action(async () => {
  setupPlan = null; $('setup-confirm').hidden = true; await account();
  const file = $('setup-file').files[0];
  const text = file ? await file.text() : $('setup-json').value.trim();
  if (!text || text.length > 20000) throw Error('Select or paste setup-public.json under 20 KB, never keys.json');
  const input = JSON.parse(text), prepared = setupTransactions(input, actor);
  setupPlan = input;
  $('setup-details').textContent = JSON.stringify({ controller: actor, totalTestnetNear: '3', gasAdditional: true, localDevelopmentKeys: true, independentReviewers: false, transactions: prepared.transactions }, null, 2);
  $('setup-confirm').hidden = false;
  message('Read-only historical setup plan. Meteor blocks Full Access Key requests. Do not fund or retry this setup; check account state first.');
});
$('setup-sign').onclick = () => action(async () => {
  throw Error('Account setup disabled: Meteor blocks Full Access Key requests.');
});
async function selectWallet() {
  invalidate(); actor = ''; $('wallet-account').textContent = 'Disconnected';
  wallet = $('wallet-provider').value === 'meteor' ? meteor : await selector.wallet('my-near-wallet');
  sessionStorage.setItem('flashfirm:wallet-provider', $('wallet-provider').value);
  await account();
}
$('wallet-provider').onchange = () => action(async () => { await selectWallet(); message('Wallet selected. Connect on testnet; use the browser where your extension is installed.'); });
async function action(fn) { if (busy) return; busy = true; controls(); try { await fn(); } catch (e) { message(e.message || 'Operation failed; no automatic retry.'); } finally { busy = false; controls(); } }
async function account() { const accounts = await wallet.getAccounts(); actor = accounts[0]?.accountId || ''; $('wallet-account').textContent = actor || 'Disconnected'; return actor; }
async function inspect() {
  if (!plan) throw Error('Load a public testnet configuration first');
  const snapshot = await inspectTreasury(plan, __TREASURY_CODE_HASH__, nearRpc);
  $('treasury-status').hidden = false;
  $('treasury-status').textContent = `${plan.contractId} · ${snapshot.status.phase} · final block ${snapshot.blockHeight} · ${snapshot.status.funded_yocto} yoctoNEAR funded · ${snapshot.status.paid_yocto} paid. ${snapshot.status.challenge_root ? 'Challenge recorded.' : 'No challenge.'}`;
  return snapshot;
}
$('connect').onclick = () => action(async () => {
  invalidate();
  if (localStorage.getItem('functionCallKey')) throw Error('A delegated key is already present for this site. Disconnect, then reconnect without delegated access.');
  await wallet.signIn({}); // Deliberately no contractId/createAccessKeyFor.
  await account(); message(actor ? 'Wallet connected on testnet. Every transaction requires separate approval.' : 'No account returned. Complete the wallet connection, then try again.');
});
$('disconnect').onclick = () => action(async () => { invalidate(); await wallet.signOut(); await account(); message('Disconnected locally. Existing on-chain permissions, if any, must be reviewed in the wallet.'); });
$('treasury-config').onchange = () => { invalidate(); plan = null; $('treasury-status').hidden = true; };
$('load-project').onclick = () => action(async () => {
  invalidate(); $('treasury-status').hidden = true;
  plan = prepareTestnet(projectConfig, 0n);
  await inspect();
  message('Project treasury verified against a final testnet block. Loading does not sign or transfer funds.');
});
$('inspect').onclick = () => action(async () => {
  invalidate(); plan = null;
  const file = $('treasury-config').files[0];
  if (!file || file.size > 20000) throw Error('Choose a public configuration JSON under 20 KB');
  plan = prepareTestnet(JSON.parse(await file.text()), 0n);
  await inspect(); message('Tested bytecode and pinned configuration match the final testnet state.');
});
const examples = {
  fund: [{ amount_yocto: '1000000000000000000000' }, '0.001 testnet NEAR. Gas is additional.'],
  propose: [{ amounts_yocto: ['0', '1000000000000000000000'], evidence_root: 'REPLACE_WITH_SHA256' }, 'Amounts follow the exact order of pinned recipients and must total funded yoctoNEAR.'],
  approve: [{}, 'Plan hash is read from the verified contract. Only a pinned evaluator can approve.'],
  challenge: [{ reason_root: 'REPLACE_WITH_SHA256' }, 'A timely challenge freezes payment until arbitration or timeout.'],
  resolve_challenge: [{ uphold: false, resolution_root: 'REPLACE_WITH_SHA256' }, 'Only the pinned arbiter can resolve. false enables a full buyer refund.'],
  make_refund_available: [{}, 'Only the buyer can enable an eligible expiry or arbitration-timeout refund.'],
  claim_for: [{ recipient: 'worker.example.testnet' }, 'The caller sponsors gas. Funds can only go to a pinned recipient with available credit.']
};
$('operation').onchange = () => { invalidate(); const [data, help] = examples[$('operation').value]; $('action-input').value = JSON.stringify(data, null, 2); $('operation-help').textContent = help; };
$('action-input').oninput = invalidate;
$('prepare').onclick = () => action(async () => {
  invalidate(); await account(); if (!actor) throw Error('Connect your testnet wallet first');
  const snapshot = await inspect(), method = $('operation').value, input = JSON.parse($('action-input').value);
  const transaction = treasuryAction(plan, snapshot.status, actor, method, input, snapshot.timestampNs);
  preview = { transaction, method, input };
  $('transaction-preview').textContent = JSON.stringify(transaction, null, 2); $('preview').hidden = false; message('Unsigned preview ready. No funds moved.');
});
$('sign').onclick = () => action(async () => {
  if (!preview) throw Error('Prepare a transaction first');
  if (localStorage.getItem('functionCallKey')) throw Error('Delegated key detected; disconnect before signing');
  const prepared = preview; invalidate();
  await account(); const snapshot = await inspect();
  const current = treasuryAction(plan, snapshot.status, actor, prepared.method, prepared.input, snapshot.timestampNs);
  if (JSON.stringify(current) !== JSON.stringify(prepared.transaction)) throw Error('State or wallet changed; prepare a fresh preview');
  // Retain exact intent before the popup; a timeout must not silently resubmit it.
  pending = current; sessionStorage.setItem(pendingKey, JSON.stringify(current));
  $('tx-hash').value = ''; $('transaction-result').textContent = 'Awaiting wallet. If interrupted, inspect wallet history before retrying.';
  const outcome = await wallet.signAndSendTransaction(current);
  const txHash = outcome?.transaction?.hash;
  if (!txHash) throw Error('Wallet returned without a transaction hash; inspect wallet history');
  $('tx-hash').value = txHash;
  message('Wallet returned a hash. Use Verify final execution to check the actual result.');
});
$('verify-transaction').onclick = () => action(async () => {
  if (!pending) throw Error('No signing intent recorded in this tab');
  const txHash = $('tx-hash').value.trim();
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,64}$/.test(txHash)) throw Error('Enter a valid transaction hash from wallet history');
  const network = await nearRpc('status', []); if (network.chain_id !== 'testnet') throw Error('Wrong RPC network');
  const outcome = await nearRpc('tx', { tx_hash: txHash, sender_account_id: pending.signerId, wait_until: 'FINAL' });
  if (outcome.transaction?.hash !== txHash) throw Error('RPC returned a different transaction');
  const result = checkTransaction(outcome, pending);
  $('transaction-result').textContent = `${result.final ? 'Final execution verified' : 'Pending'} · ${txHash}${result.transferCallbackSucceeded ? ' · transfer callback confirmed' : ' · this operation is not a payout claim'}`;
  message('Exact signer, receiver, action, final status and execution receipts checked.');
});
try {
  selector = await setupWalletSelector({ network: 'testnet', modules: [setupMyNearWallet({ walletUrl: 'https://testnet.mynearwallet.com' })], debug: false });
  const client = new MeteorConnect();
  await client.initialize({ storage: webpage_local_storage, mobileBridge: { enabled: false } });
  meteor = meteorAdapter(client, actionCreators);
  $('wallet-provider').value = sessionStorage.getItem('flashfirm:wallet-provider') === 'my-near-wallet' ? 'my-near-wallet' : 'meteor';
  await selectWallet();
  message(pending ? 'A previous signing intent is retained. Verify its hash before attempting another transaction.' : 'Ready. Connect a testnet wallet and load your public treasury configuration.');
} catch (e) { message(`Wallet initialization failed: ${e.message}`); }
controls();

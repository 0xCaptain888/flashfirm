import { setupWalletSelector } from '@near-wallet-selector/core';
import { setupMyNearWallet } from '@near-wallet-selector/my-near-wallet';
import { MeteorConnect, webpage_local_storage } from '@meteorwallet/sdk';
import { actionCreators } from 'meteor-transactions';
import { meteorAdapter } from '../src/meteor-wallet.mjs';
import { setupTransactions } from '../src/testnet-setup.mjs';
import { prepareTestnet, treasuryAction, checkTransaction } from '../src/treasury-policy.mjs';
import { inspectTreasury, nearRpc as requestRpc, FASTNEAR_TESTNET_RPC, TESTNET_RPC } from '../src/near-rpc.mjs';
import projectConfig from '../evidence/testnet-config.json';
import { parseNear, formatNear } from '../src/near-amount.mjs';
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
let verifiedSnapshot = null;
try { pending = JSON.parse(sessionStorage.getItem(pendingKey) || 'null'); } catch { sessionStorage.removeItem(pendingKey); }
function invalidate() { preview = null; $('preview').hidden = true; }
function controls() { $('connect').disabled = busy || !wallet || !!actor; $('wallet-provider').disabled = busy; $('disconnect').disabled = busy || !wallet || !actor; for (const id of ['setup-file', 'setup-preview', 'load-project', 'inspect', 'prepare', 'sign', 'verify-transaction', 'operation', 'treasury-config', 'action-input']) $(id).disabled = busy; $('prepare').disabled = busy || !actor || !verifiedSnapshot || verifiedSnapshot.status.phase === 'Closed' || !!pending; $('sign').disabled = busy || !preview || !!pending; $('verify-transaction').disabled = busy || !pending; $('setup-sign').disabled = true; $('setup-sign').textContent = 'Unavailable: Meteor blocks Full Access Keys'; }
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
  verifiedSnapshot = null;
  const snapshot = await inspectTreasury(plan, __TREASURY_CODE_HASH__, nearRpc);
  verifiedSnapshot = snapshot;
  $('treasury-status').hidden = false;
  const state = snapshot.status;
  $('treasury-status').textContent = `${state.phase === 'Closed' ? 'Completed · read only' : state.phase} · Funded ${formatNear(state.funded_yocto)} testnet NEAR · Paid ${formatNear(state.paid_yocto)} testnet NEAR · Approvals ${state.approvals.filter(Boolean).length}/3. ${state.challenge_root ? 'Challenge recorded.' : 'No challenge.'} Verified at final block ${snapshot.blockHeight}. Contract: ${plan.contractId}${state.phase === 'Closed' ? '. This treasury is closed. A new task requires a new treasury; do not deposit again.' : ''}`;
  return snapshot;
}
$('connect').onclick = () => action(async () => {
  invalidate();
  if (localStorage.getItem('functionCallKey')) throw Error('A delegated key is already present for this site. Disconnect, then reconnect without delegated access.');
  await wallet.signIn({}); // Deliberately no contractId/createAccessKeyFor.
  await account(); message(actor ? 'Wallet connected on testnet. Every transaction requires separate approval.' : 'No account returned. Complete the wallet connection, then try again.');
});
$('disconnect').onclick = () => action(async () => { invalidate(); await wallet.signOut(); await account(); message('Disconnected locally. Existing on-chain permissions, if any, must be reviewed in the wallet.'); });
$('treasury-config').onchange = () => { invalidate(); plan = null; verifiedSnapshot = null; controls(); $('treasury-status').hidden = true; };
$('load-project').onclick = () => action(async () => {
  invalidate(); $('treasury-status').hidden = true;
  plan = prepareTestnet(projectConfig, 0n);
  await inspect();
  guidedFields();
  message('Project treasury verified against a final testnet block. Loading does not sign or transfer funds.');
});
$('inspect').onclick = () => action(async () => {
  invalidate(); plan = null;
  const file = $('treasury-config').files[0];
  if (!file || file.size > 20000) throw Error('Choose a public configuration JSON under 20 KB');
  plan = prepareTestnet(JSON.parse(await file.text()), 0n);
  await inspect(); guidedFields(); message('Tested bytecode and pinned configuration match the final testnet state.');
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
const fields = document.createElement('div');
fields.id = 'guided-fields';
$('action-input').before(fields);
const advanced = document.createElement('details');
const advancedTitle = document.createElement('summary'); advancedTitle.textContent = 'Advanced: exact parameters (read only)';
advanced.append(advancedTitle); $('action-input').before(advanced); advanced.append($('action-input'));
$('action-input').readOnly = true;
document.querySelector('label[for="action-input"]').textContent = 'Transaction details';
function guidedFields() {
  fields.replaceChildren();
  const method = $('operation').value, [data, help] = examples[method];
  const values = structuredClone(data);
  function sync() { invalidate(); $('action-input').value = JSON.stringify(values, null, 2); controls(); }
  function field(label, initial, update, options) {
    const wrapper = document.createElement('label'); wrapper.textContent = label;
    const input = document.createElement(options ? 'select' : 'input');
    if (options) for (const value of options) { const option = document.createElement('option'); option.value = value; option.textContent = value; input.append(option); }
    input.value = initial; wrapper.append(input); fields.append(wrapper);
    input.oninput = () => { try { update(input.value); input.setCustomValidity(''); sync(); } catch (error) { invalidate(); $('action-input').value = ''; input.setCustomValidity(error.message); message(error.message); controls(); } };
  }
  if (method === 'fund') field('Amount in testnet NEAR (maximum 0.01; gas additional)', '0.001', value => values.amount_yocto = parseNear(value));
  if (method === 'propose') {
    values.amounts_yocto = (plan?.init.recipients || []).map(() => '0');
    (plan?.init.recipients || []).forEach((id, index) => field(`Allocation for ${id} · testnet NEAR`, '0', value => values.amounts_yocto[index] = parseNear(value)));
    field('Evidence SHA-256 (64 lowercase hex characters)', '', value => values.evidence_root = value.trim());
  }
  if (method === 'challenge') field('Reason SHA-256', '', value => values.reason_root = value.trim());
  if (method === 'resolve_challenge') {
    field('Decision', 'Refund buyer', value => values.uphold = value === 'Uphold payout', ['Refund buyer', 'Uphold payout']);
    field('Resolution SHA-256', '', value => values.resolution_root = value.trim());
  }
  if (method === 'claim_for') {
    const recipients = plan?.init.recipients || []; values.recipient = recipients[0] || '';
    field('Fixed recipient (caller pays gas)', values.recipient, value => values.recipient = value, recipients);
  }
  $('operation-help').textContent = help; sync();
}
$('operation').onchange = guidedFields;
guidedFields();
$('action-input').oninput = invalidate;
$('prepare').onclick = () => action(async () => {
  if (pending) throw Error('Verify the previous signing request before preparing a new transaction.');
  if ([...fields.querySelectorAll('input,select')].some(input => !input.reportValidity())) throw Error('Correct the highlighted input first');
  invalidate(); await account(); if (!actor) throw Error('Connect your testnet wallet first');
  const snapshot = await inspect(), method = $('operation').value, input = JSON.parse($('action-input').value);
  const transaction = treasuryAction(plan, snapshot.status, actor, method, input, snapshot.timestampNs);
  preview = { transaction, method, input };
  $('transaction-preview').textContent = JSON.stringify(transaction, null, 2); $('preview').hidden = false; message('Unsigned preview ready. No funds moved.');
});
$('sign').onclick = () => action(async () => {
  if (pending) throw Error('An unresolved signing request exists. Verify its transaction before signing again.');
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
  pending = null; sessionStorage.removeItem(pendingKey); invalidate();
  try { if (plan) await inspect(); } catch (error) { message(`Transaction verified successfully. Live treasury refresh failed: ${error.message}. Reload verification before preparing another action.`); }
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

import { prepareTestnet } from './treasury-policy.mjs';

export const DEVELOPER_ACCOUNT = 'flashfirm-dev-0xcaptain888.testnet';
export const BUYER_ACCOUNT = '0xcaptain888.testnet';
export function validateIndependentSetup(input, nowNs = 0n) {
  if (input?.version !== 'flashfirm-independent-testnet/1' || input.developer !== DEVELOPER_ACCOUNT || input.independentOperators !== false) throw Error('Invalid independent development setup');
  const plan = prepareTestnet(input.config, nowNs);
  if (plan.init.buyer !== BUYER_ACCOUNT) throw Error('Buyer must remain the user wallet');
  const expected = ['treasury', 'review-a', 'review-b', 'review-c', 'arbiter', 'worker'].map(role => `${role}.${DEVELOPER_ACCOUNT}`);
  const actual = [plan.contractId, ...plan.init.evaluators, plan.init.arbiter, ...plan.init.recipients.filter(id => id !== BUYER_ACCOUNT)];
  if (JSON.stringify(actual) !== JSON.stringify(expected) || input.accounts?.length !== 6) throw Error('Exact development role accounts required');
  const keys = new Set();
  for (const [index, account] of input.accounts.entries()) {
    if (account.accountId !== expected[index] || account.amountYocto !== (index === 0 ? '2500000000000000000000000' : '100000000000000000000000')) throw Error('Unexpected account or funding amount');
    if (!/^ed25519:[1-9A-HJ-NP-Za-km-z]{43,44}$/.test(account.publicKey) || keys.has(account.publicKey)) throw Error('Unique role public keys required');
    keys.add(account.publicKey);
  }
  return plan;
}

export function verifyRoleKey(account, view) {
  if (view.keys?.length !== 1 || view.keys[0].public_key !== account.publicKey || view.keys[0].access_key.permission !== 'FullAccess') throw Error(`Unexpected control: ${account.accountId}`);
}

export function requireFinalSuccess(outcome, signer, receiver) {
  if (outcome.transaction?.signer_id !== signer || outcome.transaction?.receiver_id !== receiver || outcome.final_execution_status !== 'FINAL' || !Object.hasOwn(outcome.status || {}, 'SuccessValue') || outcome.transaction_outcome?.outcome?.status?.Failure || !Array.isArray(outcome.receipts_outcome) || outcome.receipts_outcome.some(receipt => receipt.outcome?.status?.Failure)) throw Error('Final transaction success not established');
}

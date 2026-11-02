import { prepareTestnet } from './treasury-policy.mjs';

export function setupTransactions(input, signer, nowNs) {
  if (input?.version !== 'flashfirm-testnet-setup/1' || input.controller !== signer) throw Error('Setup controller must match the connected wallet');
  const plan = prepareTestnet(input.config, nowNs);
  if (plan.init.buyer !== signer || !Array.isArray(input.accounts) || input.accounts.length !== 6) throw Error('Exactly six development accounts required');
  const ids = [plan.contractId, ...plan.init.evaluators, plan.init.arbiter, ...plan.init.recipients.filter(id => id !== signer)];
  if (ids.length !== 6 || new Set(ids).size !== 6) throw Error('Invalid development roles');
  const keys = new Set();
  const transactions = input.accounts.map((account, i) => {
    const prefix = account.accountId?.slice(0, -(signer.length + 1));
    if (account.accountId !== ids[i] || !account.accountId.endsWith(`.${signer}`) || !/^[a-z0-9-]+$/.test(prefix)) throw Error('Only direct children of the connected buyer can be created');
    if (!/^ed25519:[1-9A-HJ-NP-Za-km-z]{43,44}$/.test(account.publicKey) || keys.has(account.publicKey)) throw Error('Unique Ed25519 public keys required');
    keys.add(account.publicKey);
    const amount = i === 0 ? '2500000000000000000000000' : '100000000000000000000000';
    if (account.amountYocto !== amount) throw Error('Setup funding must be 2.5 NEAR for treasury and 0.1 per other account');
    return { signerId: signer, receiverId: account.accountId, actions: [
      { type: 'CreateAccount' }, { type: 'Transfer', params: { deposit: amount } },
      { type: 'AddKey', params: { publicKey: account.publicKey, accessKey: { permission: 'FullAccess' } } }
    ] };
  });
  return { plan, transactions, totalYocto: '3000000000000000000000000', independentOperators: false };
}

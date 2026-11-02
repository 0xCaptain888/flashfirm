import test from 'node:test';
import assert from 'node:assert/strict';
import { meteorAdapter } from '../src/meteor-wallet.mjs';
function fixture(network = 'testnet') {
  const requests = [];
  const client = {
    getAccount: async () => ({ identifier: { blockchain: 'near', network, accountId: 'buyer.testnet' } }),
    createAction: async request => { requests.push(request); return { promptForExecution: async () => [{ transaction: { hash: 'example' } }] }; }
  };
  return { wallet: meteorAdapter(client, { functionCall: (...args) => args }), requests };
}
test('Meteor login requests testnet identity without delegated key', async () => {
  const { wallet, requests } = fixture(); await wallet.signIn();
  assert.deepEqual(requests[0], { id: 'near::sign_in', input: { target: { blockchain: 'near', network: 'testnet' } } });
});
test('Meteor refuses wrong network and changed signer before opening a transaction', async () => {
  await assert.rejects(fixture('mainnet').wallet.getAccounts(), /wrong network/);
  const { wallet, requests } = fixture();
  await assert.rejects(wallet.signAndSendTransaction({ signerId: 'other.testnet' }), /account changed/);
  assert.equal(requests.length, 0);
});
test('Meteor preserves amounts and forces wallet confirmation', async () => {
  const { wallet, requests } = fixture();
  await wallet.signAndSendTransaction({ signerId: 'buyer.testnet', receiverId: 'treasury.testnet', actions: [{ type: 'FunctionCall', params: { methodName: 'fund', args: {}, gas: '30000000000000', deposit: '1000000000000000000000' } }] });
  assert.equal(requests[0].input.useFunctionCallKey, false);
  assert.deepEqual(requests[0].input.transactions, [{ receiverId: 'treasury.testnet', actions: [['fund', {}, 30000000000000n, 1000000000000000000000n]] }]);
});

import {createRequire} from 'node:module';
import {inspectSignedPayment, validateSignedPayment, paymentPolicy} from '../src/mainnet-payment.mjs';
// Optional isolated tools, deliberately absent from the app dependency graph.
// Install pinned coin-near 2.4.9 with overrides coin-base 2.0.6, crypto-lib 2.0.5
// in .runtime/wallet-sdk-test/. Newer coin-base 2.0.7 lacks its advertised dist/.
const require = createRequire(new URL('../.runtime/wallet-sdk-test/package.json', import.meta.url));
const {NearWallet, NearTypes} = require('@okxweb3/coin-near');
const wallet = new NearWallet();
const privateKey = await wallet.getRandomPrivateKey(); // ephemeral random key, not any user's wallet
const deposit = '1'.repeat(64), amount = paymentPolicy.amount;
const prepared = {signerId: paymentPolicy.signer, receiverId: 'wrap.near', actions: [
  {methodName: 'storage_deposit', args: {account_id: paymentPolicy.signer, registration_only: true}, gas: '10000000000000', deposit: '1250000000000000000000'},
  {methodName: 'storage_deposit', args: {account_id: deposit, registration_only: true}, gas: '10000000000000', deposit: '1250000000000000000000'},
  {methodName: 'near_deposit', args: {}, gas: '30000000000000', deposit: amount},
  {methodName: 'ft_transfer', args: {receiver_id: deposit, amount}, gas: '30000000000000', deposit: '1'},
]};
const signed = await wallet.signTransaction({privateKey, data: {...prepared, type: NearTypes.DAppTx,
  from: prepared.signerId, nonce: 1, blockHash: '11111111111111111111111111111111'}});
validateSignedPayment(signed, prepared);
const observed = inspectSignedPayment(signed);
console.log(JSON.stringify({status: 'OFFLINE_SDK_ROUNDTRIP_PASS',
  versions: {coinNear: require('@okxweb3/coin-near/package.json').version,
    coinBase: require('@okxweb3/coin-base/package.json').version,
    cryptoLib: require('@okxweb3/crypto-lib/package.json').version},
  actions: observed.actions.length, randomTestKeyOnly: true, networkBroadcast: false,
  actualBrowserWalletCompatibilityProven: false,
  scope: 'Standard flat FunctionCall action encoding roundtrips through official OKX SDK and exact NEAR validator; original browser response mismatch remains unresolved'}));

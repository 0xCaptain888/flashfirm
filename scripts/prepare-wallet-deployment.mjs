import { mkdir, readFile, writeFile, chmod } from 'node:fs/promises';
import { randomBytes, createHash } from 'node:crypto';
import { KeyPair } from 'near-api-js';
import { setupTransactions } from '../src/testnet-setup.mjs';

const controller = process.argv[2];
if (!/^[a-z0-9][a-z0-9_-]*\.testnet$/.test(controller || '')) throw Error('Provide your public top-level .testnet account');
const folder = new URL('../.runtime/testnet-deployment/', import.meta.url);
await mkdir(folder, { recursive: true, mode: 0o700 }); await chmod(folder, 0o700);
try { await readFile(new URL('keys.json', folder)); throw Error('Existing deployment keys found. Reuse the existing setup; do not silently replace keys.'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
const suffix = randomBytes(4).toString('hex');
const names = ['treasury', 'review-a', 'review-b', 'review-c', 'arbiter', 'worker'];
const accounts = [], keys = {};
for (const [i, name] of names.entries()) {
  const accountId = `${name}-${suffix}.${controller}`, pair = KeyPair.fromRandom('ed25519');
  keys[accountId] = pair.toString();
  accounts.push({ accountId, publicKey: pair.getPublicKey().toString(), amountYocto: i === 0 ? '2500000000000000000000000' : '100000000000000000000000' });
}
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const config = { network: 'testnet', contractId: accounts[0].accountId, init: {
  buyer: controller, evaluators: accounts.slice(1, 4).map(a => a.accountId), recipients: [controller, accounts[5].accountId], arbiter: accounts[4].accountId,
  task_root: hash(await readFile(new URL('../evidence/live-receipt.json', import.meta.url))),
  policy_hash: hash('FlashFirm dev-only same-operator reviewers; v0.2; 2 of 3; 60 second appeal; fixed recipient'),
  deadline_ns: String((BigInt(Date.now()) + 7n * 86400000n) * 1000000n), appeal_window_ns: '60000000000', arbitration_window_ns: '60000000000'
} };
const setup = { version: 'flashfirm-testnet-setup/1', controller, config, accounts, independentOperators: false };
setupTransactions(setup, controller);
await writeFile(new URL('keys.json', folder), JSON.stringify(keys), { mode: 0o600, flag: 'wx' });
await writeFile(new URL('setup-public.json', folder), JSON.stringify(setup, null, 2), { mode: 0o600 });
await writeFile(new URL('config-public.json', folder), JSON.stringify(config, null, 2), { mode: 0o600 });
console.log(JSON.stringify({ status: 'UNSIGNED_SETUP_READY', controller, contractId: config.contractId, accountCount: 6, testnetNear: '3', gasAdditional: true, privateKeysPrinted: false, publicFile: new URL('setup-public.json', folder).pathname }));

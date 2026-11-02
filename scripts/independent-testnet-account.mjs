// Official NEAR CLI faucet protocol; sends only a new account ID and public key.
// Private keys remain in a separate, ignored local directory. Never imports a wallet key.
import { mkdir, readFile, writeFile, chmod } from 'node:fs/promises';
import { KeyPair } from 'near-api-js';

const mode = process.argv[2];
if (!['prepare', 'create', 'verify'].includes(mode)) throw Error('Expected prepare, create or verify');
const folder = new URL('../.runtime/independent-testnet/', import.meta.url);
const accountId = 'flashfirm-dev-0xcaptain888.testnet';
const endpoint = 'https://archival-rpc.testnet.fastnear.com/';
const save = (file, data, exclusive = false) => writeFile(new URL(file, folder), JSON.stringify(data, null, 2), { mode: 0o600, flag: exclusive ? 'wx' : 'w' });
await mkdir(folder, { recursive: true, mode: 0o700 }); await chmod(folder, 0o700);
if (mode === 'prepare') {
  let credentials;
  try { credentials = JSON.parse(await readFile(new URL('developer-key.json', folder), 'utf8')); }
  catch (e) {
    if (e.code !== 'ENOENT') throw e;
    const pair = KeyPair.fromRandom('ed25519');
    credentials = { accountId, network: 'testnet', publicKey: pair.getPublicKey().toString(), privateKey: pair.toString() };
    await save('developer-key.json', credentials, true);
  }
  if (credentials.accountId !== accountId || credentials.network !== 'testnet' || KeyPair.fromString(credentials.privateKey).getPublicKey().toString() !== credentials.publicKey) throw Error('Local developer identity mismatch');
  await save('account-public.json', { accountId, network: 'testnet', publicKey: credentials.publicKey });
  console.log(JSON.stringify({ status: 'LOCAL_KEY_PREPARED', accountId, publicKey: credentials.publicKey, funded: false, privateKeyPrinted: false }));
  process.exit(0);
}
const manifest = JSON.parse(await readFile(new URL('account-public.json', folder), 'utf8'));
if (manifest.accountId !== accountId || manifest.network !== 'testnet' || !/^ed25519:[1-9A-HJ-NP-Za-km-z]{43,44}$/.test(manifest.publicKey)) throw Error('Invalid public manifest');
async function rpc(method, params) {
  const response = await fetch(endpoint, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(25000), headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  if (!response.ok) throw Error(`RPC HTTP ${response.status}`);
  const body = await response.json();
  if (body.error) { const error = Error('RPC rejected request'); error.rpcCause = body.error.cause?.name; throw error; }
  if (!body.result) throw Error('Missing RPC result');
  return body.result;
}
if ((await rpc('status', [])).chain_id !== 'testnet') throw Error('Wrong network');
async function verify() {
  const block = await rpc('block', { finality: 'final' });
  if (Math.abs(Date.now() - Number(BigInt(block.header.timestamp_nanosec) / 1000000n)) > 120000) throw Error('Stale final block');
  const params = { block_id: block.header.hash, account_id: accountId };
  const account = await rpc('query', { ...params, request_type: 'view_account' });
  const access = await rpc('query', { ...params, request_type: 'view_access_key_list' });
  if (account.block_hash !== block.header.hash || access.block_hash !== block.header.hash) throw Error('Inconsistent RPC snapshot');
  if (access.keys.length !== 1 || access.keys[0].public_key !== manifest.publicKey || access.keys[0].access_key.permission !== 'FullAccess') throw Error('Unexpected account control');
  const result = { status: 'DEVELOPER_ACCOUNT_VERIFIED', ...manifest, rpc: endpoint, blockHash: block.header.hash, blockHeight: block.header.height, balanceYocto: account.amount, codeHash: account.code_hash, checkedAt: new Date().toISOString(), meteorFundsUsed: false, contractDeployed: false };
  await save('account-verification-public.json', result);
  console.log(JSON.stringify(result));
}
if (mode === 'verify') { await verify(); process.exit(0); }
try {
  await rpc('query', { request_type: 'view_account', account_id: accountId, finality: 'final' });
  await verify(); // Existing account is only accepted with the exact locally prepared key.
} catch (error) {
  if (error.rpcCause !== 'UNKNOWN_ACCOUNT') throw error;
  await save('faucet-attempt.json', { accountId, publicKey: manifest.publicKey, requestedAt: new Date().toISOString() }, true);
  const response = await fetch('https://helper.nearprotocol.com/account', { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(45000), headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ newAccountId: accountId, newAccountPublicKey: manifest.publicKey }) });
  const body = await response.text();
  await save('faucet-response-public.json', { httpStatus: response.status, body });
  if (!response.ok) throw Error(`Faucet HTTP ${response.status}; request recorded, no automatic retry`);
  console.log(JSON.stringify({ status: 'FAUCET_RESPONDED_VERIFY_REQUIRED', accountId, httpStatus: response.status, meteorFundsUsed: false }));
  await verify();
}

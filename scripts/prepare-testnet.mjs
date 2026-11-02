import { readFile } from 'node:fs/promises';
import { prepareTestnet, verifyDeployment } from '../src/near-deployment.mjs';

const file = process.argv[2];
if (!file) throw Error('Usage: node scripts/prepare-testnet.mjs config.json [--verify]');
const config = JSON.parse(await readFile(file, 'utf8'));
// Verification of an existing deployment must also work after its deadline.
const plan = prepareTestnet(config, process.argv.includes('--verify') ? 0n : undefined);
if (!process.argv.includes('--verify')) {
  console.log(JSON.stringify({ ...plan, status: 'UNSIGNED_CONFIGURATION_ONLY', next: 'Deploy tested Wasm and initialize from the contract account; this tool sends no transaction.' }, null, 2));
} else {
  const endpoint = 'https://rpc.testnet.near.org';
  let id = 0;
  async function rpc(method, params) {
    const response = await fetch(endpoint, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15_000), headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }) });
    if (!response.ok) throw Error(`Testnet RPC HTTP ${response.status}`);
    const body = await response.json();
    if (body.error || !body.result) throw Error('Testnet RPC rejected query');
    return body.result;
  }
  const network = await rpc('status', []);
  if (network.chain_id !== 'testnet') throw Error('Wrong RPC network');
  const account = await rpc('query', { request_type: 'view_account', finality: 'final', account_id: plan.contractId });
  const view = await rpc('query', { request_type: 'call_function', block_id: account.block_hash, account_id: plan.contractId, method_name: 'get_status', args_base64: 'e30=' });
  if (view.block_hash !== account.block_hash) throw Error('Inconsistent RPC snapshot');
  const status = JSON.parse(Buffer.from(view.result).toString('utf8'));
  const result = verifyDeployment(plan, await readFile(new URL('../artifacts/flashfirm_treasury.wasm', import.meta.url)), account, status);
  console.log(JSON.stringify({ ...result, network: 'testnet', contractId: plan.contractId, blockHash: account.block_hash, blockHeight: account.block_height, phase: status.phase, broadcast: false }, null, 2));
  if (!result.valid) process.exitCode = 1;
}

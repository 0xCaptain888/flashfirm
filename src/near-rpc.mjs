import { pinnedMismatches } from './treasury-policy.mjs';
export const TESTNET_RPC = 'https://rpc.testnet.near.org';
export async function nearRpc(method, params, fetcher = fetch) {
  const response = await fetcher(TESTNET_RPC, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(20000), headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  if (!response.ok) throw Error(`Testnet RPC HTTP ${response.status}`);
  const reader = response.body.getReader(), chunks = []; let size = 0;
  while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 2_000_000) { await reader.cancel(); throw Error('RPC response too large'); } chunks.push(value); }
  const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  const body = JSON.parse(new TextDecoder().decode(bytes));
  if (body.error || !body.result) throw Error('Testnet RPC rejected request; check account and network');
  return body.result;
}
export async function inspectTreasury(plan, codeHash, rpc = nearRpc) {
  const network = await rpc('status', []);
  if (network.chain_id !== 'testnet') throw Error('Wrong RPC network');
  const block = await rpc('block', { finality: 'final' });
  const timestampNs = BigInt(block.header.timestamp_nanosec);
  const nowNs = BigInt(Date.now()) * 1_000_000n;
  if (timestampNs < nowNs - 120_000_000_000n || timestampNs > nowNs + 30_000_000_000n) throw Error('RPC block time is stale or local clock is incorrect');
  const params = { block_id: block.header.hash, account_id: plan.contractId };
  const account = await rpc('query', { ...params, request_type: 'view_account' });
  const view = await rpc('query', { ...params, request_type: 'call_function', method_name: 'get_status', args_base64: 'e30=' });
  if (account.block_hash !== block.header.hash || view.block_hash !== block.header.hash) throw Error('Inconsistent RPC snapshot');
  if (account.code_hash !== codeHash) throw Error('Deployed contract does not match this tested build');
  const status = JSON.parse(new TextDecoder().decode(Uint8Array.from(view.result)));
  const mismatches = pinnedMismatches(plan, status);
  if (mismatches.length) throw Error(`Pinned configuration mismatch: ${mismatches.join(', ')}`);
  return { status, blockHash: block.header.hash, blockHeight: block.header.height, timestampNs };
}

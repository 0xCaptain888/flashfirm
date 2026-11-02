import { readBounded } from './live.mjs';
import { canonical } from './protocol.mjs';
const API = 'https://1click.chaindefuser.com';
const states = new Set(['KNOWN_DEPOSIT_TX','PENDING_DEPOSIT','INCOMPLETE_DEPOSIT','PROCESSING','SUCCESS','REFUNDED','FAILED']);
const integer = value => typeof value === 'string' && /^[1-9]\d{0,77}$/.test(value);
export function validateDestination(chain, address) {
  if (chain === 'evm' && /^0x[a-f0-9]{40}$/.test(address) && !/^0x0{40}$/.test(address)) return address;
  if (chain === 'near' && typeof address === 'string' && address.length >= 2 && address.length <= 64 && /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(address) && !address.endsWith('.testnet')) return address;
  throw Error('UNSUPPORTED_OR_INVALID_DESTINATION');
}
export function dryQuoteRequest(route, input, now = Date.now()) {
  if (!route || route.network !== 'mainnet' || !route.originAsset || !route.destinationAsset || route.originAsset === route.destinationAsset || !integer(route.maxAmount)) throw Error('PINNED_MAINNET_ROUTE_REQUIRED');
  if (!integer(input.amount) || BigInt(input.amount) > BigInt(route.maxAmount)) throw Error('AMOUNT_OUTSIDE_ROUTE_POLICY');
  if (input.recipient !== route.recipient || input.refundTo !== route.refundTo) throw Error('ADDRESS_NOT_ALLOWLISTED');
  validateDestination(route.destinationChain, input.recipient); validateDestination(route.originChain, input.refundTo);
  return { dry: true, swapType: 'EXACT_INPUT', depositMode: 'SIMPLE', slippageTolerance: 100, originAsset: route.originAsset, destinationAsset: route.destinationAsset, depositType: 'ORIGIN_CHAIN', amount: input.amount, refundTo: input.refundTo, refundType: 'ORIGIN_CHAIN', recipient: input.recipient, recipientType: 'DESTINATION_CHAIN', deadline: new Date(now + 3600000).toISOString() };
}
export class IntentsPreview {
  constructor(fetcher = fetch) { this.fetcher = fetcher; }
  async request(path, body) {
    const response = await this.fetcher(API + path, { method: body ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(20000), headers: { 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return JSON.parse(await readBounded(response, 2000000));
  }
  tokens() { return this.request('/v0/tokens'); }
  async quote(route, input) {
    const request = dryQuoteRequest(route, input), result = await this.request('/v0/quote', request);
    if (canonical(result.quoteRequest) !== canonical(request) || result.quote?.depositAddress || result.quote?.depositMemo || !integer(result.quote?.amountOut)) throw Error('UNEXPECTED_PREVIEW_RESPONSE');
    return { mode: 'DRY_QUOTE_ONLY', result, fundsMoved: false, paymentVerified: false };
  }
  async status(saved) {
    if (!saved?.quote?.depositAddress || saved.quoteRequest?.dry !== false || saved.quoteRequest?.depositMode !== 'SIMPLE') throw Error('SAVED_EXECUTABLE_QUOTE_REQUIRED');
    const result = await this.request('/v0/status?' + new URLSearchParams({ depositAddress: saved.quote.depositAddress }));
    if (!states.has(result.status) || canonical(result.quoteResponse?.quoteRequest) !== canonical(saved.quoteRequest) || result.quoteResponse?.quote?.depositAddress !== saved.quote.depositAddress || result.quoteResponse?.signature !== saved.signature) throw Error('SWAP_IDENTITY_MISMATCH');
    return { state: result.status, result, paymentVerified: false, next: result.status === 'SUCCESS' ? 'VERIFY_DESTINATION_CHAIN' : result.status === 'REFUNDED' ? 'VERIFY_ORIGIN_REFUND' : result.status === 'FAILED' ? 'MANUAL_REVIEW_NO_AUTOMATIC_REDEPOSIT' : 'WAIT_NO_AUTOMATIC_REDEPOSIT' };
  }
}
// Receipt verification is independent of the relay's SUCCESS label. RPC endpoints,
// asset contract, chain and recipient must be operator-pinned, never taken from URLs
// embedded in an untrusted status response. This verifies ERC-20 delivery only.
export async function verifyEvmDelivery(expected, rpc) {
  validateDestination('evm', expected.recipient); validateDestination('evm', expected.token);
  if (!/^0x[0-9a-f]{64}$/.test(expected.hash ?? '') || !/^0x[1-9a-f][0-9a-f]*$/.test(expected.chainId ?? '') || !integer(expected.minimumAmount)) throw Error('INVALID_DELIVERY_EXPECTATION');
  if (await rpc('eth_chainId', []) !== expected.chainId) throw Error('WRONG_DESTINATION_CHAIN');
  const receipt = await rpc('eth_getTransactionReceipt', [expected.hash]);
  if (!receipt || receipt.status !== '0x1' || receipt.transactionHash !== expected.hash || !Array.isArray(receipt.logs)) throw Error('DESTINATION_TRANSACTION_NOT_SUCCESSFUL');
  const finalized = await rpc('eth_getBlockByNumber', ['finalized', false]);
  const block = await rpc('eth_getBlockByNumber', [receipt.blockNumber, false]);
  if (BigInt(finalized.number) < BigInt(receipt.blockNumber) || block.hash !== receipt.blockHash) throw Error('DESTINATION_NOT_FINAL');
  if (expected.notBeforeSeconds !== undefined && (!Number.isSafeInteger(expected.notBeforeSeconds) || expected.notBeforeSeconds < 0 || !/^0x[0-9a-f]+$/.test(block.timestamp??'') || BigInt(block.timestamp) < BigInt(expected.notBeforeSeconds))) throw Error('DELIVERY_PREDATES_REQUEST');
  const transferTopic = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
  let amount = 0n; const seen = new Set();
  for (const log of receipt.logs) {
    if (log.removed || log.address?.toLowerCase() !== expected.token || log.topics?.length !== 3 || log.topics[0] !== transferTopic || log.topics[2]?.toLowerCase() !== '0x' + '0'.repeat(24) + expected.recipient.slice(2)) continue;
    if (!/^0x[0-9a-fA-F]{64}$/.test(log.data) || seen.has(log.logIndex)) throw Error('INVALID_TRANSFER_LOG');
    seen.add(log.logIndex); amount += BigInt(log.data);
  }
  if (amount < BigInt(expected.minimumAmount)) throw Error('INSUFFICIENT_DELIVERED_AMOUNT');
  return { paymentVerified: true, transactionHash: expected.hash, recipient: expected.recipient, token: expected.token, amount: String(amount), blockHash: receipt.blockHash, scope: 'Finalized ERC-20 transfer via pinned RPC; caller must persist a unique task/transaction binding' };
}

import { createHash } from 'node:crypto';
import { pinnedMismatches } from './treasury-policy.mjs';
export { prepareTestnet } from './treasury-policy.mjs';
export function base58(bytes) {
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let value = BigInt('0x' + Buffer.from(bytes).toString('hex')), result = '';
  while (value > 0n) { result = alphabet[Number(value % 58n)] + result; value /= 58n; }
  for (const byte of bytes) { if (byte !== 0) break; result = '1' + result; }
  return result;
}
export function verifyDeployment(plan, wasm, accountView, status) {
  const expectedCodeHash = base58(createHash('sha256').update(wasm).digest());
  const mismatches = pinnedMismatches(plan, status);
  if (accountView.code_hash !== expectedCodeHash) mismatches.push('code_hash');
  return { valid: mismatches.length === 0, mismatches, expectedCodeHash, paymentVerified: false, independentOperatorsVerified: false };
}

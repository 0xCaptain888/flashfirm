import test from 'node:test';
import assert from 'node:assert/strict';
import { parseNear, formatNear } from '../src/near-amount.mjs';
test('NEAR amounts preserve one yocto, large integers and trailing decimal precision', () => {
  for (const value of ['0', '1', '1000000000000000000000', '900719925474099300000000000000000000']) assert.equal(parseNear(formatNear(value)), value);
  assert.equal(parseNear('0.001'), '1000000000000000000000');
  assert.equal(formatNear(parseNear('1.2300')), '1.23');
});
test('NEAR input rejects rounding, exponent notation, signs and overflow', () => {
  for (const value of ['1e-3', '-1', '+1', '01', '1.', '.1', ' 1', '0.0000000000000000000000001', '999999999999999999999999999999999999999999']) assert.throws(() => parseNear(value));
});

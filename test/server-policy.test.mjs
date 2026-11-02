import test from 'node:test';
import assert from 'node:assert/strict';
import { serverPolicy } from '../src/server-policy.mjs';
test('public listener fails closed without HTTPS origin and persistent data path', () => {
  assert.equal(serverPolicy({}).host,'127.0.0.1');
  assert.throws(()=>serverPolicy({FLASHFIRM_BIND:'0.0.0.0'}));
  for(const origin of ['http://example.com','https://example.com/','https://user:secret@example.com']) assert.throws(()=>serverPolicy({FLASHFIRM_PUBLIC_ORIGIN:origin,FLASHFIRM_RUNTIME:'/data'}));
  assert.throws(()=>serverPolicy({FLASHFIRM_PUBLIC_ORIGIN:'https://example.com'}));
  assert.deepEqual(serverPolicy({FLASHFIRM_PUBLIC_ORIGIN:'https://example.com',FLASHFIRM_RUNTIME:'/data',FLASHFIRM_BIND:'0.0.0.0'}).hosts,['example.com']);
});

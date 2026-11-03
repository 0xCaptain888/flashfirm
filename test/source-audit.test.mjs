import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {verifySourceBytes,auditClaimOverlap} from '../src/source-audit.mjs';
const revised=JSON.parse(readFileSync(new URL('../evidence/revised-live-receipt.json',import.meta.url),'utf8'));
test('source audit rejects altered bytes and truncated-only substitutes',()=>{
 const sources=revised.payload.parentReceipt.payload.sources;
 const texts=Object.fromEntries(sources.map(s=>[s.id,s.excerpt]));
 assert.throws(()=>verifySourceBytes(revised,texts),/PINNED_SOURCE_BYTES_MISMATCH/);
 texts['source-1']+='altered';
 assert.throws(()=>verifySourceBytes(revised,texts),/source-1/);
});
test('duplicate evidence is flagged without treating overlapping quotations as a score',()=>{
 const audit=auditClaimOverlap(revised);
 assert.equal(audit.claims,9);assert.equal(audit.exactClaims,9);assert.equal(audit.repeatedEvidence.length,1);
 assert.equal(new Set(audit.repeatedEvidence[0].contributors.map(c=>c.workerId)).size,2);
 assert.equal(audit.payouts,undefined);assert.equal(audit.contributionScore,undefined);
});

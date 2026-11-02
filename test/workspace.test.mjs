import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { WorkspaceStore } from '../src/workspace-store.mjs';
import { identity, seal, hash } from '../src/protocol.mjs';

const setup=()=>{let now=1000;const s=new WorkspaceStore(':memory:',randomBytes(32),()=>now);return {s,tick:n=>{now+=n;}};};
test('tokens expire and revoke, cross-owner access denied',()=>{
 const {s,tick}=setup();try{
 const token=s.issueToken('alice',100);assert.equal(s.authenticate(token),'alice');
 const f=s.create('alice','A');assert.throws(()=>s.access('bob',f.id));
 tick(101);assert.equal(s.authenticate(token),null);
 const t=s.issueToken('alice');s.revoke(t);assert.equal(s.authenticate(t),null);
 }finally{s.close();}
});
test('vault encrypts documents and binds ciphertext to firm and document ID',()=>{
 const {s}=setup();try{
 const f=s.create('alice','A'),id=s.put('alice',f.id,{secret:'private material'});
 assert.deepEqual(s.get('alice',f.id,id),{secret:'private material'});
 const row=s.db.prepare('SELECT blob FROM vault WHERE id=?').get(id);assert.ok(!row.blob.includes('private material'));
 const other=s.put('alice',f.id,{secret:'other'});s.db.prepare('UPDATE vault SET blob=? WHERE id=?').run(row.blob,other);
 assert.throws(()=>s.get('alice',f.id,other));assert.throws(()=>s.get('bob',f.id,id));
 }finally{s.close();}
});
test('queue deduplicates, detects key reuse and rejects stale lease completion',()=>{
 const {s,tick}=setup();try{
 const f=s.create('alice','A'),input={kind:'VERIFY_RECEIPT',receipt:{payload:{}}};
 const j=s.enqueue('alice',f.id,'key',input);assert.equal(s.enqueue('alice',f.id,'key',input).id,j.id);
 assert.throws(()=>s.enqueue('alice',f.id,'key',{...input,receipt:{different:true}}));
 const a=s.claim();assert.equal(s.claim(),null);tick(30001);const b=s.claim();
 assert.notEqual(a.lease,b.lease);assert.equal(s.finish(a.id,a.lease,{}),false);
 assert.equal(s.finish(b.id,b.lease,{valid:false}),true);assert.equal(s.job('alice',f.id,j.id).state,'SUCCEEDED');
 }finally{s.close();}
});
test('dissolution cancels work, removes active documents and blocks further access',()=>{
 const {s}=setup();try{
 const f=s.create('alice','A'),id=s.put('alice',f.id,{secret:true});
 const j=s.enqueue('alice',f.id,'key',{kind:'VERIFY_RECEIPT',receipt:{}}),run=s.claim();
 s.dissolve('alice',f.id);assert.equal(s.finish(run.id,run.lease,{}),false);
 assert.equal(s.job('alice',f.id,j.id).state,'CANCELLED');assert.throws(()=>s.get('alice',f.id,id));
 assert.equal(s.db.prepare('SELECT count(*) AS n FROM vault').get().n,0);
 assert.throws(()=>s.enqueue('alice',f.id,'new',{kind:'VERIFY_RECEIPT',receipt:{}}));
 assert.equal(s.dissolve('alice',f.id).state,'DISSOLVED');
 }finally{s.close();}
});
test('database survives process restart, restores leased work, and bounds retry count',()=>{
 const dir=mkdtempSync(join(tmpdir(),'flashfirm-db-')),key=randomBytes(32),filename=join(dir,'state.sqlite');let now=1000;
 let s=new WorkspaceStore(filename,key,()=>now);
 try{
 const f=s.create('alice','A'),token=s.issueToken('alice');s.enqueue('alice',f.id,'key',{kind:'VERIFY_RECEIPT',receipt:{secret:'do not store plaintext'}});
 s.claim();s.close();s=new WorkspaceStore(filename,key,()=>now);assert.equal(s.authenticate(token),'alice');assert.equal(s.claim(),null);
 now+=30001;assert.ok(s.claim());now+=30001;assert.ok(s.claim());now+=30001;assert.equal(s.claim(),null);
 assert.equal(s.db.prepare('SELECT state FROM jobs').get().state,'FAILED');
 assert.ok(!readFileSync(filename).includes(Buffer.from('do not store plaintext')));
 }finally{s.close();rmSync(dir,{recursive:true,force:true});}
});
test('pinned policy, signed reviews and appeal survive durable storage without replacement',()=>{
 const {s,tick}=setup();try{
 const buyer=identity(),worker=identity(),arbiter=identity(),reviewers=[identity(),identity(),identity()],f=s.create('alice','Review');
 const policy={taskRoot:'a'.repeat(64),buyerKey:buyer.publicKey,workerKeys:[worker.publicKey],appealKey:arbiter.publicKey,reviewers:reviewers.map((k,i)=>({key:k.publicKey,operator:`org${i}`})),expiresAt:1000000,appealWindowMs:60000};
 const pinned=s.pinReview('alice',f.id,policy,'b'.repeat(64));assert.throws(()=>s.pinReview('alice',f.id,{...policy,expiresAt:2000000},'b'.repeat(64)));
 const decision=i=>seal({version:'flashfirm-decision/1',policyHash:pinned.commitment.digest,taskRoot:policy.taskRoot,resultRoot:'b'.repeat(64),issuedAt:1000,reason:'Reviewed evidence',verdict:i===0?'APPROVE':'CHALLENGE'},reviewers[i]);
 s.decide('alice',f.id,decision(0));const reviewed=s.decide('alice',f.id,decision(1));assert.equal(reviewed.assessment.state,'DISPUTED');
 const changed=decision(0);changed.payload.verdict='CHALLENGE';assert.throws(()=>s.decide('alice',f.id,changed));
 tick(100);const appeal=seal({version:'flashfirm-appeal/1',policyHash:pinned.commitment.digest,reviewHash:reviewed.assessment.reviewHash,issuedAt:1100,reason:'Review issue'},buyer);
 assert.equal(s.appeal('alice',f.id,appeal).assessment.state,'APPEAL_PENDING');assert.throws(()=>s.decide('alice',f.id,decision(2)));
 tick(100);const resolution=seal({version:'flashfirm-resolution/1',appealHash:hash(appeal),reviewHash:reviewed.assessment.reviewHash,issuedAt:1200,verdict:'REWORK',reason:'Requires revised evidence'},arbiter);
 assert.equal(s.resolve('alice',f.id,resolution).assessment.state,'REWORK_REQUIRED');assert.equal(s.review('alice',f.id).resolution.signature,resolution.signature);
 }finally{s.close();}
});
test('corrupted encrypted job fails once without endless lease retries',()=>{
 const {s}=setup();try{const f=s.create('alice','Corruption test'),j=s.enqueue('alice',f.id,'bad',{kind:'VERIFY_RECEIPT',receipt:{}});
 s.db.prepare('UPDATE jobs SET input=? WHERE id=?').run('{}',j.id);
 assert.equal(s.claim(),null);assert.equal(s.job('alice',f.id,j.id).state,'FAILED');assert.equal(s.claim(),null);
 assert.equal(s.events('alice',f.id).filter(e=>e.kind==='JOB_FAILED').length,1);
 }finally{s.close();}
});

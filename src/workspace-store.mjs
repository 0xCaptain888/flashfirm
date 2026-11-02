import { DatabaseSync } from 'node:sqlite';
import { createHash, randomBytes, randomUUID, createCipheriv, createDecipheriv } from 'node:crypto';
import { chmodSync } from 'node:fs';
import { commitPolicy, assessReview, validateAppeal, resolveAppeal } from './governance.mjs';
import { verifyReviewerBinding, verifyReviewerAccount } from './reviewer-binding.mjs';

const digest = s => createHash('sha256').update(s).digest('hex');
const encode = v => JSON.stringify(v);
const decode = v => v == null ? null : JSON.parse(v);
const required = (value, max = 160) => {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw Error('Invalid text');
  return value.trim();
};

// Single-host durable storage. Every caller is authenticated before reaching this class.
// Local encryption is NOT confidential computing or protection against a compromised host.
export class WorkspaceStore {
  constructor(filename, masterKey, now = Date.now) {
    if (!Buffer.isBuffer(masterKey) || masterKey.length !== 32) throw Error('32-byte vault key required');
    this.key = masterKey; this.now = now;
    this.db = new DatabaseSync(filename);
    if (filename !== ':memory:') chmodSync(filename, 0o600);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS tokens (hash TEXT PRIMARY KEY, owner TEXT NOT NULL, expires INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS firms (id TEXT PRIMARY KEY, owner TEXT NOT NULL, title TEXT NOT NULL, state TEXT NOT NULL, created INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS vault (id TEXT PRIMARY KEY, firm TEXT NOT NULL REFERENCES firms(id), blob TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, firm TEXT NOT NULL REFERENCES firms(id), request_key TEXT NOT NULL, input_hash TEXT NOT NULL, input TEXT NOT NULL, state TEXT NOT NULL, lease TEXT, expires INTEGER, attempts INTEGER NOT NULL DEFAULT 0, result TEXT, created INTEGER NOT NULL, UNIQUE(firm,request_key));
      CREATE TABLE IF NOT EXISTS events (seq INTEGER PRIMARY KEY AUTOINCREMENT, firm TEXT NOT NULL REFERENCES firms(id), kind TEXT NOT NULL, data TEXT NOT NULL, created INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS review_policies (firm TEXT PRIMARY KEY REFERENCES firms(id), commitment TEXT NOT NULL, result_root TEXT NOT NULL, decisions TEXT NOT NULL DEFAULT '[]', appeal TEXT, resolution TEXT);
      CREATE TABLE IF NOT EXISTS binding_challenges (nonce TEXT PRIMARY KEY, owner TEXT NOT NULL, expected TEXT NOT NULL, created INTEGER NOT NULL, expires INTEGER NOT NULL, used INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS reviewer_bindings (owner TEXT NOT NULL, account TEXT NOT NULL, policy TEXT NOT NULL, evidence TEXT NOT NULL, PRIMARY KEY(owner,account,policy));
      CREATE TABLE IF NOT EXISTS reviewer_revocations (owner TEXT NOT NULL, account TEXT NOT NULL, policy TEXT NOT NULL, reason TEXT NOT NULL, revoked INTEGER NOT NULL, PRIMARY KEY(owner,account,policy));
      PRAGMA user_version=1;`);
    if (!this.db.prepare('PRAGMA table_info(jobs)').all().some(c => c.name === 'paid_started')) {
      this.db.exec('ALTER TABLE jobs ADD COLUMN paid_started INTEGER NOT NULL DEFAULT 0');
    }
    if (!this.db.prepare('PRAGMA table_info(jobs)').all().some(c => c.name === 'kind')) {
      this.db.exec("ALTER TABLE jobs ADD COLUMN kind TEXT NOT NULL DEFAULT 'LEGACY_JOB'");
    }
  }
  transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.db.exec('COMMIT'); return result; }
    catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }
  issueToken(owner, ttlMs = 86400000) {
    required(owner); if (!Number.isSafeInteger(ttlMs) || ttlMs < 1 || ttlMs > 604800000) throw Error('Invalid token lifetime');
    const token = randomBytes(32).toString('base64url');
    this.db.prepare('INSERT INTO tokens(hash,owner,expires) VALUES(?,?,?)').run(digest(token), owner, this.now()+ttlMs);
    return token;
  }
  authenticate(token) {
    if (typeof token !== 'string' || token.length > 200) return null;
    return this.db.prepare('SELECT owner FROM tokens WHERE hash=? AND revoked=0 AND expires>?').get(digest(token),this.now())?.owner ?? null;
  }
  revoke(token) { this.db.prepare('UPDATE tokens SET revoked=1 WHERE hash=?').run(digest(token)); }
  reviewerChallenge(owner, input, audience) {
    required(owner);
    if (!/^(?:[a-z0-9]+(?:[-_][a-z0-9]+)*\.)+testnet$/.test(input.accountId??'') || input.accountId.length>64 || !/^[a-f0-9]{64}$/.test(input.policyHash??'') || typeof input.reviewerKey!=='string' || !input.reviewerKey.includes('PUBLIC KEY') || input.reviewerKey.length>500 || !audience.startsWith('https://')) throw Error('Invalid reviewer registration');
    return this.transaction(()=>{
      this.db.prepare('DELETE FROM binding_challenges WHERE expires<=?').run(this.now());
      if(this.db.prepare('SELECT count(*) AS n FROM binding_challenges WHERE owner=? AND used=0').get(owner).n>=10)throw Error('Too many outstanding reviewer challenges');
      const nonce=randomBytes(32).toString('hex'),created=this.now(),expires=created+300000;
      const expected={accountId:input.accountId,reviewerKey:input.reviewerKey,policyHash:input.policyHash,audience,nonce};
      this.db.prepare('INSERT INTO binding_challenges(nonce,owner,expected,created,expires) VALUES(?,?,?,?,?)').run(nonce,owner,encode(expected),created,expires);
      return {...expected,version:'flashfirm-reviewer-binding/1',network:'testnet',issuedAt:created,expiresAt:expires};
    });
  }
  async bindReviewer(owner,envelope,verifier=verifyReviewerBinding) {
    const payload=envelope?.reviewerSeal?.payload;
    const challenge=this.db.prepare('SELECT * FROM binding_challenges WHERE nonce=? AND owner=? AND used=0 AND expires>?').get(payload?.nonce??'',owner,this.now());
    if(!challenge||payload.issuedAt!==challenge.created||payload.expiresAt!==challenge.expires)throw Error('Unknown, expired or consumed reviewer challenge');
    const result=await verifier(envelope,decode(challenge.expected),undefined,this.now());
    if(result.verified!==true)throw Error('Reviewer verification failed');
    return this.transaction(()=>{
      const changed=this.db.prepare('UPDATE binding_challenges SET used=1 WHERE nonce=? AND owner=? AND used=0 AND expires>?').run(payload.nonce,owner,this.now());
      if(changed.changes!==1)throw Error('Reviewer challenge consumed or expired during verification');
      this.db.prepare('INSERT INTO reviewer_bindings(owner,account,policy,evidence) VALUES(?,?,?,?)').run(owner,payload.accountId,payload.policyHash,encode(result));
      return result;
    });
  }
  reviewerBindings(owner){return this.db.prepare('SELECT b.evidence,r.revoked,r.reason FROM reviewer_bindings b LEFT JOIN reviewer_revocations r ON b.owner=r.owner AND b.account=r.account AND b.policy=r.policy WHERE b.owner=?').all(owner).map(row=>({...decode(row.evidence),revokedAt:row.revoked,revocationReason:row.reason}));}
  revokeReviewer(owner,{accountId,policyHash,reason}) {
    const note=required(reason,300);
    if(!this.db.prepare('SELECT 1 FROM reviewer_bindings WHERE owner=? AND account=? AND policy=?').get(owner,accountId,policyHash))throw Error('Reviewer binding not found');
    this.db.prepare('INSERT OR IGNORE INTO reviewer_revocations VALUES(?,?,?,?,?)').run(owner,accountId,policyHash,note,this.now());
    return {revoked:true,accountId,policyHash,onChainKeyRemoved:false};
  }
  async recheckReviewer(owner,{accountId,policyHash},verifier=verifyReviewerAccount) {
    const get=()=>this.reviewerBindings(owner).find(r=>r.accountId===accountId&&r.policyHash===policyHash);
    const binding=get();if(!binding||binding.revokedAt!==null)throw Error('Reviewer missing or revoked');
    if(!binding.nearPublicKey)throw Error('Legacy binding requires fresh enrollment under a new policy');
    const result=await verifier(binding,undefined,this.now());
    if(get()?.revokedAt!==null)throw Error('Reviewer revoked during verification');
    return {...result,accountId,policyHash,scope:'Point-in-time account key presence only; no report or payment approval'};
  }
  event(firm, kind, data = {}) { this.db.prepare('INSERT INTO events(firm,kind,data,created) VALUES(?,?,?,?)').run(firm, kind, encode(data), this.now()); }
  access(owner,id,active=false) {
    const firm = this.db.prepare('SELECT * FROM firms WHERE id=? AND owner=?').get(id,owner);
    if (!firm) throw Error('Workspace not found');
    if (active && firm.state !== 'ACTIVE') throw Error('Workspace closed');
    return firm;
  }
  create(owner,title) {
    required(owner); title=required(title);
    return this.transaction(()=>{
      if(this.db.prepare('SELECT count(*) AS n FROM firms WHERE owner=?').get(owner).n>=200)throw Error('Workspace limit reached');
      const id=randomUUID(); this.db.prepare('INSERT INTO firms VALUES(?,?,?,?,?)').run(id,owner,title,'ACTIVE',this.now());
      this.event(id,'CREATED'); return this.access(owner,id);
    });
  }
  list(owner) { return this.db.prepare('SELECT * FROM firms WHERE owner=? ORDER BY created DESC').all(owner); }
  events(owner,id) { this.access(owner,id); return this.db.prepare('SELECT * FROM events WHERE firm=? ORDER BY seq').all(id).map(e=>({...e,data:decode(e.data)})); }
  pinReview(owner,firm,policy,resultRoot) {
    return this.transaction(()=>{
      this.access(owner,firm,true);
      const commitment=commitPolicy(policy);
      if(policy.expiresAt<=this.now())throw Error('Review policy already expired');
      assessReview(commitment,resultRoot,[],this.now());
      const old=this.db.prepare('SELECT * FROM review_policies WHERE firm=?').get(firm);
      if(old){if(old.commitment!==encode(commitment)||old.result_root!==resultRoot)throw Error('Review policy and result are immutable');return this.review(owner,firm);}
      this.db.prepare('INSERT INTO review_policies(firm,commitment,result_root) VALUES(?,?,?)').run(firm,encode(commitment),resultRoot);
      this.event(firm,'REVIEW_POLICY_PINNED',{policyHash:commitment.digest,resultRoot});return this.review(owner,firm);
    });
  }
  review(owner,firm) {
    this.access(owner,firm);const row=this.db.prepare('SELECT * FROM review_policies WHERE firm=?').get(firm);
    if(!row)throw Error('Review policy not found');
    const commitment=decode(row.commitment),decisions=decode(row.decisions),appeal=decode(row.appeal),resolution=decode(row.resolution);
    let assessment=assessReview(commitment,row.result_root,decisions,this.now());
    if(appeal)assessment={...assessment,state:'APPEAL_PENDING'};
    if(resolution)assessment={...assessment,...resolveAppeal(commitment,row.result_root,decisions,appeal,resolution,this.now())};
    return {commitment,resultRoot:row.result_root,decisions,appeal,resolution,assessment,settlementExecuted:false};
  }
  decide(owner,firm,decision) {
    return this.transaction(()=>{
      this.access(owner,firm,true);const current=this.review(owner,firm);
      const old=current.decisions.find(d=>d.publicKey===decision?.publicKey);
      if(old){if(encode(old)!==encode(decision))throw Error('Reviewer decision cannot be replaced');return current;}
      if(current.appeal||['RELEASE_ELIGIBLE','EXPIRED'].includes(current.assessment.state))throw Error('Review round closed');
      if(decision?.payload?.issuedAt<this.now()-300000)throw Error('Decision too old for submission');
      const decisions=[...current.decisions,decision];assessReview(current.commitment,current.resultRoot,decisions,this.now());
      this.db.prepare('UPDATE review_policies SET decisions=? WHERE firm=?').run(encode(decisions),firm);
      this.event(firm,'REVIEW_DECISION_ACCEPTED',{reviewer:decision.publicKey,verdict:decision.payload.verdict});return this.review(owner,firm);
    });
  }
  appeal(owner,firm,envelope) {
    return this.transaction(()=>{
      this.access(owner,firm,true);const current=this.review(owner,firm);
      if(current.appeal){if(encode(current.appeal)!==encode(envelope))throw Error('One immutable appeal per round');return current;}
      if(this.now()>=current.assessment.appealUntil)throw Error('Appeal submission window closed');
      validateAppeal(current.commitment,current.resultRoot,current.decisions,envelope,this.now());
      this.db.prepare('UPDATE review_policies SET appeal=? WHERE firm=?').run(encode(envelope),firm);
      this.event(firm,'APPEAL_FILED');return this.review(owner,firm);
    });
  }
  resolve(owner,firm,envelope) {
    return this.transaction(()=>{
      this.access(owner,firm,true);const current=this.review(owner,firm);
      if(current.resolution){if(encode(current.resolution)!==encode(envelope))throw Error('Appeal resolution is immutable');return current;}
      resolveAppeal(current.commitment,current.resultRoot,current.decisions,current.appeal,envelope,this.now());
      this.db.prepare('UPDATE review_policies SET resolution=? WHERE firm=?').run(encode(envelope),firm);
      this.event(firm,'APPEAL_RESOLVED',{verdict:envelope.payload.verdict});return this.review(owner,firm);
    });
  }
  encrypt(firm,id,value) {
    const iv=randomBytes(12), cipher=createCipheriv('aes-256-gcm',this.key,iv);
    cipher.setAAD(Buffer.from(`${firm}:${id}`));
    const ciphertext=Buffer.concat([cipher.update(encode(value),'utf8'),cipher.final()]);
    return encode({iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),ciphertext:ciphertext.toString('base64')});
  }
  put(owner,firm,value) {
    if(Buffer.byteLength(encode(value))>200000)throw Error('Document too large');
    return this.transaction(()=>{
      this.access(owner,firm,true);
      if(this.db.prepare('SELECT count(*) AS n FROM vault WHERE firm=?').get(firm).n>=100)throw Error('Document limit reached');
      const id=randomUUID(); this.db.prepare('INSERT INTO vault VALUES(?,?,?)').run(id,firm,this.encrypt(firm,id,value));
      this.event(firm,'DOCUMENT_STORED',{id}); return id;
    });
  }
  get(owner,firm,id) {
    this.access(owner,firm,true);
    const row=this.db.prepare('SELECT blob FROM vault WHERE id=? AND firm=?').get(id,firm);
    if(!row)throw Error('Document not found');
    const b=decode(row.blob), decipher=createDecipheriv('aes-256-gcm',this.key,Buffer.from(b.iv,'base64'));
    decipher.setAAD(Buffer.from(`${firm}:${id}`)); decipher.setAuthTag(Buffer.from(b.tag,'base64'));
    return JSON.parse(Buffer.concat([decipher.update(Buffer.from(b.ciphertext,'base64')),decipher.final()]).toString('utf8'));
  }
  enqueue(owner,firm,key,input) {
    required(key,100);
    const verification = input?.kind === 'VERIFY_RECEIPT' && input.receipt;
    const live = input?.kind === 'LIVE_PUBLIC_REVIEW' && input.preset === 'openzeppelin-pinned' && input.approvedCapFen === 2000 && Object.keys(input).length === 3;
    if ((!verification && !live) || Buffer.byteLength(encode(input))>400000) throw Error('Unsupported job or invalid public-review authorization');
    return this.transaction(()=>{
      this.access(owner,firm,true); const inputHash=digest(encode(input));
      const old=this.db.prepare('SELECT * FROM jobs WHERE firm=? AND request_key=?').get(firm,key);
      if(old){if(old.input_hash!==inputHash)throw Error('Idempotency key conflict');return this.publicJob(old);}
      if(this.db.prepare('SELECT count(*) AS n FROM jobs WHERE firm=?').get(firm).n>=100)throw Error('Job limit reached');
      const id=randomUUID();
      this.db.prepare('INSERT INTO jobs(id,firm,request_key,input_hash,input,state,created,kind) VALUES(?,?,?,?,?,?,?,?)').run(id,firm,key,inputHash,this.encrypt(firm,id,input),'QUEUED',this.now(),input.kind);
      this.event(firm,'JOB_QUEUED',{id,kind:input.kind}); return this.job(owner,firm,id);
    });
  }
  publicJob(j) { return {id:j.id,firm:j.firm,kind:j.kind,state:j.state,attempts:j.attempts,result:decode(j.result),created:j.created}; }
  jobs(owner,firm) {
    this.access(owner,firm);
    return this.db.prepare('SELECT id,firm,kind,state,attempts,created,request_key AS requestKey FROM jobs WHERE firm=? ORDER BY created DESC,id DESC LIMIT 100').all(firm);
  }
  job(owner,firm,id) { this.access(owner,firm); const j=this.db.prepare('SELECT * FROM jobs WHERE id=? AND firm=?').get(id,firm); if(!j)throw Error('Job not found');return this.publicJob(j); }
  claim() {
    return this.transaction(()=>{
      const now=this.now();
      // Never replay a possibly charged request after a worker crash or lost lease.
      this.db.prepare("UPDATE jobs SET state='FAILED',lease=NULL,result=? WHERE state='RUNNING' AND expires<=? AND paid_started=1").run(encode({error:'Paid run interrupted; reservations retained; inspect partial output before any manual retry'}),now);
      this.db.prepare("UPDATE jobs SET state='FAILED',result=? WHERE state='RUNNING' AND expires<=? AND attempts>=3").run(encode({error:'Worker lease exhausted'}),now);
      const j=this.db.prepare("SELECT jobs.* FROM jobs JOIN firms ON firms.id=jobs.firm WHERE firms.state='ACTIVE' AND (jobs.state='QUEUED' OR (jobs.state='RUNNING' AND jobs.expires<=?)) AND jobs.attempts<3 ORDER BY jobs.created LIMIT 1").get(now);
      if(!j)return null;
      const lease=randomUUID(); this.db.prepare("UPDATE jobs SET state='RUNNING',lease=?,expires=?,attempts=attempts+1 WHERE id=?").run(lease,now+30000,j.id);
      let input;
      try{const b=decode(j.input), d=createDecipheriv('aes-256-gcm',this.key,Buffer.from(b.iv,'base64'));d.setAAD(Buffer.from(`${j.firm}:${j.id}`));d.setAuthTag(Buffer.from(b.tag,'base64'));
      input=JSON.parse(Buffer.concat([d.update(Buffer.from(b.ciphertext,'base64')),d.final()]).toString());}
      catch{this.db.prepare("UPDATE jobs SET state='FAILED',input='{}',lease=NULL,result=? WHERE id=?").run(encode({error:'Encrypted job integrity failure'}),j.id);this.event(j.firm,'JOB_FAILED',{id:j.id,reason:'INPUT_INTEGRITY'});return null;}
      this.event(j.firm,'JOB_STARTED',{id:j.id,attempt:j.attempts+1}); return {id:j.id,firm:j.firm,lease,input};
    });
  }
  renew(id,lease) {
    return this.db.prepare("UPDATE jobs SET expires=? WHERE id=? AND state='RUNNING' AND lease=? AND expires>?").run(this.now()+30000,id,lease,this.now()).changes === 1;
  }
  markPaidStarted(id,lease) {
    return this.transaction(() => {
      const changed = this.db.prepare("UPDATE jobs SET paid_started=1 WHERE id=? AND state='RUNNING' AND lease=? AND expires>?").run(id,lease,this.now()).changes;
      if (changed !== 1) throw Error('JOB_NO_LONGER_ACTIVE');
    });
  }
  finish(id,lease,result,failed=false) {
    return this.transaction(()=>{
      const j=this.db.prepare("SELECT * FROM jobs WHERE id=? AND state='RUNNING' AND lease=? AND expires>?").get(id,lease,this.now());
      if(!j)return false;
      this.db.prepare('UPDATE jobs SET state=?,result=?,input=?,lease=NULL,expires=NULL WHERE id=?').run(failed?'FAILED':'SUCCEEDED',encode(result),'{}',id);
      this.event(j.firm,failed?'JOB_FAILED':'JOB_SUCCEEDED',{id});return true;
    });
  }
  dissolve(owner,firm) {
    return this.transaction(()=>{
      const f=this.access(owner,firm); if(f.state==='DISSOLVED')return f;
      this.db.prepare("UPDATE jobs SET state='CANCELLED',input='{}',lease=NULL WHERE firm=? AND state IN ('QUEUED','RUNNING')").run(firm);
      this.db.prepare('DELETE FROM vault WHERE firm=?').run(firm);
      this.db.prepare("UPDATE firms SET state='DISSOLVED' WHERE id=?").run(firm);
      this.event(firm,'DISSOLVED',{scope:'Local workspace only; no blockchain refunds or backup erasure'});return this.access(owner,firm);
    });
  }
  close(){this.db.close();}
}

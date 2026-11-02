import { randomBytes, randomUUID } from 'node:crypto';
import { verifyEvmDelivery, validateDestination } from './intents.mjs';
import { verifyNitroAttestation } from './nitro-attestation.mjs';

// Verification records only: no payment initiation, credit issuance or secret release.
// Routes, RPC functions, root certificates and PCRs are supplied by the host operator.
export class IntegrationLedger {
  constructor(store, {routes={},tee=null}={}) {
    this.store=store; this.routes=routes; this.tee=tee;
    store.db.exec(`
      CREATE TABLE IF NOT EXISTS delivery_requests (id TEXT PRIMARY KEY, firm TEXT NOT NULL REFERENCES firms(id), expected TEXT NOT NULL, route TEXT NOT NULL, state TEXT NOT NULL, evidence TEXT, created INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS delivery_destinations (chain TEXT NOT NULL, token TEXT NOT NULL, recipient TEXT NOT NULL, request TEXT NOT NULL REFERENCES delivery_requests(id), PRIMARY KEY(chain,token,recipient));
      CREATE TABLE IF NOT EXISTS delivery_transactions (chain TEXT NOT NULL, hash TEXT NOT NULL, request TEXT NOT NULL REFERENCES delivery_requests(id), PRIMARY KEY(chain,hash));
      CREATE TABLE IF NOT EXISTS attestation_challenges (nonce TEXT PRIMARY KEY, firm TEXT NOT NULL REFERENCES firms(id), expected TEXT NOT NULL, expires INTEGER NOT NULL, used INTEGER NOT NULL DEFAULT 0, evidence TEXT);
    `);
  }
  status(){return {routeIds:Object.keys(this.routes),teeConfigured:!!this.tee,secretReleaseEnabled:false,settlementEnabled:false};}
  createDelivery(owner,firmId,routeId) {
    const s=this.store; s.access(owner,firmId,true);
    const route=Object.hasOwn(this.routes,routeId)?this.routes[routeId]:null;
    if(!route||typeof route.rpc!=='function')throw Error('PINNED_ROUTE_NOT_CONFIGURED');
    const {chainId,token,recipient,minimumAmount}=route;
    validateDestination('evm',token);validateDestination('evm',recipient);
    if(!/^0x[1-9a-f][0-9a-f]*$/.test(chainId??'')||!/^[1-9]\d{0,77}$/.test(minimumAmount??''))throw Error('INVALID_PINNED_ROUTE');
    const id=randomUUID(),created=s.now(),expected={chainId,token,recipient,minimumAmount,notBeforeSeconds:Math.ceil(created/1000)};
    return s.transaction(()=>{
      s.db.prepare('INSERT INTO delivery_requests VALUES(?,?,?,?,?,?,?)').run(id,firmId,JSON.stringify(expected),routeId,'PENDING',null,created);
      // A dedicated destination may belong to only one invoice across all owners.
      // This intentionally disallows shared-address collection without an intent tag.
      s.db.prepare('INSERT INTO delivery_destinations VALUES(?,?,?,?)').run(chainId,token,recipient,id);
      s.event(firmId,'DELIVERY_REQUEST_CREATED',{id,routeId});
      return {id,state:'PENDING',expected,transferAuthorized:false};
    });
  }
  deliveries(owner,firmId){this.store.access(owner,firmId);return this.store.db.prepare('SELECT * FROM delivery_requests WHERE firm=? ORDER BY created').all(firmId).map(r=>({...r,expected:JSON.parse(r.expected),evidence:JSON.parse(r.evidence)}));}
  async verifyDelivery(owner,firmId,id,hash) {
    const s=this.store;s.access(owner,firmId,true);
    const row=s.db.prepare('SELECT * FROM delivery_requests WHERE id=? AND firm=?').get(id,firmId);
    if(!row||row.state!=='PENDING')throw Error('DELIVERY_NOT_PENDING');
    const expected=JSON.parse(row.expected),route=this.routes[row.route];
    if(!route||['chainId','token','recipient','minimumAmount'].some(k=>route[k]!==expected[k]))throw Error('PINNED_ROUTE_CHANGED');
    const evidence=await verifyEvmDelivery({...expected,hash},route.rpc);
    return s.transaction(()=>{
      s.access(owner,firmId,true);
      s.db.prepare('INSERT INTO delivery_transactions VALUES(?,?,?)').run(expected.chainId,hash,id);
      const changed=s.db.prepare("UPDATE delivery_requests SET state='VERIFIED',evidence=? WHERE id=? AND state='PENDING'").run(JSON.stringify(evidence),id);
      if(changed.changes!==1)throw Error('DELIVERY_ALREADY_CONSUMED');
      s.event(firmId,'DESTINATION_DELIVERY_VERIFIED',{id,hash});
      return {...evidence,id,settlementExecuted:false,crossChainOriginVerified:false};
    });
  }
  challenge(owner,firmId,{taskDigest,publicKey}) {
    const s=this.store;s.access(owner,firmId,true);
    if(!this.tee)throw Error('TEE_NOT_CONFIGURED');
    if(!/^[a-f0-9]{64}$/.test(taskDigest??'')||typeof publicKey!=='string'||!/^([a-f0-9]{2}){32,1024}$/.test(publicKey))throw Error('INVALID_ATTESTATION_REQUEST');
    return s.transaction(()=>{
      s.db.prepare('DELETE FROM attestation_challenges WHERE used=0 AND expires<=?').run(s.now());
      if(s.db.prepare('SELECT count(*) AS n FROM attestation_challenges WHERE firm=? AND used=0').get(firmId).n>=10)throw Error('TOO_MANY_CHALLENGES');
      const nonce=randomBytes(32).toString('hex'),expires=s.now()+120000;
      const expected={nonce,taskDigest,publicKey,pcrs:this.tee.pcrs};
      s.db.prepare('INSERT INTO attestation_challenges(nonce,firm,expected,expires) VALUES(?,?,?,?)').run(nonce,firmId,JSON.stringify(expected),expires);
      return {nonce,taskDigest,publicKey,expires,secretReleaseEnabled:false};
    });
  }
  async attest(owner,firmId,nonce,document,verifier=verifyNitroAttestation) {
    const s=this.store;s.access(owner,firmId,true);
    if(!this.tee)throw Error('TEE_NOT_CONFIGURED');
    const row=s.db.prepare('SELECT * FROM attestation_challenges WHERE nonce=? AND firm=? AND used=0 AND expires>?').get(nonce,firmId,s.now());
    if(!row)throw Error('UNKNOWN_OR_CONSUMED_CHALLENGE');
    if(!Buffer.isBuffer(document)||document.length>32768)throw Error('INVALID_DOCUMENT');
    const expected=JSON.parse(row.expected);
    if(JSON.stringify(expected.pcrs)!==JSON.stringify(this.tee.pcrs))throw Error('TEE_POLICY_CHANGED');
    for(const k of ['nonce','taskDigest','publicKey'])expected[k]=Buffer.from(expected[k],'hex');
    const evidence=await verifier(document,expected,this.tee.rootPem,s.now());
    if(evidence.verified!==true)throw Error('ATTESTATION_NOT_VERIFIED');
    return s.transaction(()=>{
      s.access(owner,firmId,true);
      const changed=s.db.prepare('UPDATE attestation_challenges SET used=1,evidence=? WHERE nonce=? AND used=0 AND expires>?').run(JSON.stringify(evidence),nonce,s.now());
      if(changed.changes!==1)throw Error('CHALLENGE_EXPIRED_OR_CONSUMED');
      s.event(firmId,'ATTESTATION_VERIFIED',{nonce,documentHash:evidence.documentHash});
      return {...evidence,secretReleased:false,workloadExecuted:false};
    });
  }
}

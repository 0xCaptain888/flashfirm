import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { WorkspaceStore } from '../src/workspace-store.mjs';
import { IntegrationLedger } from '../src/integration-ledger.mjs';

const hash='0x'+'a'.repeat(64),token='0x'+'2'.repeat(40),recipient='0x'+'1'.repeat(40),other='0x'+'3'.repeat(40);
function fixture(){
  let now=1000000;
  const store=new WorkspaceStore(':memory:',randomBytes(32),()=>now);
  const firm=store.create('alice','delivery'),second=store.create('bob','second');
  const receipt={transactionHash:hash,status:'0x1',blockHash:'block',blockNumber:'0x10',logs:[recipient,other].map((address,i)=>({address:token,logIndex:'0x'+i,topics:['0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef','0x'+'0'.repeat(64),'0x'+'0'.repeat(24)+address.slice(2)],data:'0x'+(100n).toString(16).padStart(64,'0')}))};
  const rpc=async(method,args)=>method==='eth_chainId'?'0x1':method==='eth_getTransactionReceipt'?receipt:args[0]==='finalized'?{number:'0x11'}:{hash:'block',timestamp:'0x3e9'};
  const routes={one:{chainId:'0x1',token,recipient,minimumAmount:'99',rpc},two:{chainId:'0x1',token,recipient:other,minimumAmount:'99',rpc}};
  const tee={pcrs:{0:'1'.repeat(96),1:'2'.repeat(96),2:'3'.repeat(96)},rootPem:'mock root: injected verifier tests only'};
  const ledger=new IntegrationLedger(store,{routes,tee});
  return {store,firm,second,ledger,routes,receipt,setNow:value=>{now=value;}};
}
test('destination observation persists, denies cross-owner reads and global transaction reuse',async()=>{
  const f=fixture();
  const a=f.ledger.createDelivery('alice',f.firm.id,'one');
  assert.throws(()=>f.ledger.createDelivery('bob',f.second.id,'one'));
  assert.throws(()=>f.ledger.deliveries('bob',f.firm.id));
  const result=await f.ledger.verifyDelivery('alice',f.firm.id,a.id,hash);
  assert.equal(result.paymentVerified,true);assert.equal(result.settlementExecuted,false);assert.equal(result.crossChainOriginVerified,false);
  const b=f.ledger.createDelivery('bob',f.second.id,'two');
  await assert.rejects(f.ledger.verifyDelivery('bob',f.second.id,b.id,hash));
  assert.equal(f.ledger.deliveries('bob',f.second.id)[0].state,'PENDING');
  await assert.rejects(f.ledger.verifyDelivery('alice',f.firm.id,a.id,hash));
  const reopened=new IntegrationLedger(f.store,{routes:f.routes});
  assert.equal(reopened.deliveries('alice',f.firm.id)[0].state,'VERIFIED');
  f.store.db.close();
});
test('old transfers, changed policy, absent routes and closed firms cannot be accepted',async()=>{
  const f=fixture();f.setNow(2000000);
  const a=f.ledger.createDelivery('alice',f.firm.id,'one');
  await assert.rejects(f.ledger.verifyDelivery('alice',f.firm.id,a.id,hash),/PREDATES/);
  f.routes.one.minimumAmount='1';
  await assert.rejects(f.ledger.verifyDelivery('alice',f.firm.id,a.id,hash),/ROUTE_CHANGED/);
  assert.throws(()=>f.ledger.createDelivery('alice',f.firm.id,'__proto__'));
  f.store.dissolve('alice',f.firm.id);
  await assert.rejects(f.ledger.verifyDelivery('alice',f.firm.id,a.id,hash),/closed/);
  f.store.db.close();
});
test('simultaneous destination verification accepts at most once',async()=>{
  const f=fixture(),a=f.ledger.createDelivery('alice',f.firm.id,'one');
  const results=await Promise.allSettled([1,2].map(()=>f.ledger.verifyDelivery('alice',f.firm.id,a.id,hash)));
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);f.store.db.close();
});
test('attestation lifecycle mocks verify one-use nonce, exact task binding and concurrent consumption',async()=>{
  const f=fixture(),input={taskDigest:'c'.repeat(64),publicKey:'d'.repeat(64)};
  const challenge=f.ledger.challenge('alice',f.firm.id,input);
  let calls=0;
  const mock=async(_document,expected)=>{calls++;assert.equal(expected.taskDigest.toString('hex'),input.taskDigest);assert.equal(expected.nonce.toString('hex'),challenge.nonce);return {verified:true,documentHash:'e'.repeat(64)};};
  await assert.rejects(f.ledger.attest('bob',f.firm.id,challenge.nonce,Buffer.from('mock'),mock));
  assert.equal(calls,0);
  const results=await Promise.allSettled([1,2].map(()=>f.ledger.attest('alice',f.firm.id,challenge.nonce,Buffer.from('mock'),mock)));
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  const result=results.find(r=>r.status==='fulfilled').value;
  assert.equal(result.secretReleased,false);assert.equal(result.workloadExecuted,false);
  await assert.rejects(f.ledger.attest('alice',f.firm.id,challenge.nonce,Buffer.from('mock'),mock));
  f.store.db.close();
});
test('attestation expires during verification and refuses unconfigured or excessive challenges',async()=>{
  const f=fixture(),input={taskDigest:'c'.repeat(64),publicKey:'d'.repeat(64)};
  const c=f.ledger.challenge('alice',f.firm.id,input);
  await assert.rejects(f.ledger.attest('alice',f.firm.id,c.nonce,Buffer.from('mock'),async()=>{f.setNow(c.expires);return {verified:true};}),/EXPIRED/);
  for(let i=0;i<10;i++)f.ledger.challenge('alice',f.firm.id,input);
  assert.throws(()=>f.ledger.challenge('alice',f.firm.id,input),/TOO_MANY/);
  const disabled=new IntegrationLedger(f.store);
  assert.throws(()=>disabled.challenge('alice',f.firm.id,input),/NOT_CONFIGURED/);
  f.store.db.close();
});

import {readFile,writeFile,rename,mkdir,rmdir} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {providerLimits} from './provider-limits.mjs';
// Uses the SAME cumulative ledger as public AI tasks. There is no new allowance
// and no refund of uncertain model spend. A new provider tariff needs approval.
export async function reserveAciSpend(runtime,{reservationFen,approvalHash}){
 const policy=JSON.parse(await readFile(path.join(runtime,'aci-spend-policy.json'),'utf8'));
 const original=JSON.parse(await readFile(path.join(runtime,'provider-policy.json'),'utf8'));
 if(policy.enabled!==true||policy.capFen!==2000||policy.origin!=='https://inference.phala.com'||
  !Number.isSafeInteger(policy.reservationFen)||policy.reservationFen!==reservationFen||
  reservationFen<1||reservationFen>2000)throw Error('ACI_TARIFF_AND_SPEND_APPROVAL_REQUIRED');
 const lock=path.join(runtime,'provider-budget.lock');
 await mkdir(lock,{mode:0o700}).catch(()=>{throw Error('BUDGET_LEDGER_BUSY');});
 try{
  const file=path.join(runtime,'provider-budget.json');
  const ledger=JSON.parse(await readFile(file,'utf8')); // Missing ledger must fail.
  if(ledger.capFen!==2000||!Number.isSafeInteger(ledger.reservedFen)||ledger.reservedFen<0||
   !Array.isArray(ledger.calls)||ledger.calls.some(c=>!Number.isSafeInteger(c.reserveFen)||c.reserveFen<0)||
   ledger.calls.reduce((n,c)=>n+c.reserveFen,0)!==ledger.reservedFen)throw Error('INVALID_SHARED_BUDGET_LEDGER');
  if(ledger.calls.length>=providerLimits(original).maxCalls||ledger.reservedFen+reservationFen>2000)
   throw Error('APPROVED_BUDGET_EXHAUSTED');
  if(ledger.calls.some(c=>c.purpose==='CONFIDENTIAL_ACI'&&c.approvalHash===approvalHash))
   throw Error('ACI_DISPATCH_ALREADY_RESERVED_RECONCILE');
  const entry={id:randomUUID(),at:new Date().toISOString(),purpose:'CONFIDENTIAL_ACI',
   approvalHash,reserveFen:reservationFen,status:'DISPATCH_RESERVED_NO_AUTOMATIC_RETRY'};
  ledger.calls.push(entry);ledger.reservedFen+=reservationFen;
  await writeFile(file+'.tmp',JSON.stringify(ledger,null,2),{mode:0o600});
  await rename(file+'.tmp',file);
  return {callId:entry.id,reservedFen:reservationFen};
 }finally{await rmdir(lock);}
}

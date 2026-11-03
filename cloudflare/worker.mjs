import {WorkflowEntrypoint} from 'cloudflare:workers';
import {handle,decryptReceipt} from './api.mjs';
import {verifyReceipt} from '../src/protocol.mjs';
import {verifyLiveReceipt} from '../src/live.mjs';
import {verifyReport} from '../src/report-revision.mjs';
export default {fetch:handle};
export class VerificationWorkflow extends WorkflowEntrypoint {
 async run(event,step){
  const jobId=event.payload.jobId;
  return step.do('verify-and-record',{retries:{limit:2,delay:'2 seconds',backoff:'exponential'},timeout:'30 seconds'},async()=>{
   const job=await this.env.DB.prepare('SELECT j.*,f.state AS firm_state FROM jobs j JOIN firms f ON f.id=j.firm WHERE j.id=?').bind(jobId).first();
   if(!job||job.firm_state!=='ACTIVE'||!['QUEUED','RUNNING'].includes(job.state))return {state:job?.state??'MISSING'};
   let result;try{const receipt=await decryptReceipt(this.env,job);result=['flashfirm-live/0.1','flashfirm-revision/1'].includes(receipt.payload?.version)?verifyReport(receipt):verifyReceipt(receipt);}catch{result={valid:false,errors:['INVALID_RECEIPT_OR_VAULT_CONFIGURATION']};}
   // A retry only repeats free verification; terminal writes are fenced and never pay.
   const changed=await this.env.DB.prepare("UPDATE jobs SET state='SUCCEEDED',result=?,input='' WHERE id=? AND state IN ('QUEUED','RUNNING') AND EXISTS(SELECT 1 FROM firms WHERE id=jobs.firm AND state='ACTIVE')").bind(JSON.stringify(result),jobId).run();
   return {recorded:changed.meta.changes===1,settlementExecuted:false,paidCalls:0};
  });
 }
}

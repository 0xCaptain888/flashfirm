import {hash} from './protocol.mjs';
import {authorizeInvoice} from './task-settlement.mjs';
import {bindTaskQuote} from './settlement-proof.mjs';
import {nativePaymentPreview} from './payment-preview.mjs';

// Read-only exact invoice handoff. No quote reservation, signing or broadcast.
export function taskPaymentHandoff(flow,{releaseReady=false}={},now=Date.now()){
 if(flow?.manifest?.version!=='flashfirm-settlement-manifest/2'||flow.nativeSettlement)throw Error('LOCKED_CROSS_CHAIN_MANIFEST_REQUIRED');
 const rows=[],totals=new Map();
 for(const invoice of flow.invoices??[]){
  const issued=invoice.authorization?.payload?.issuedAt;
  const checked=authorizeInvoice(invoice.authorization,flow.manifest,flow,issued);
  for(const field of Object.keys(checked).filter(k=>!['state','createdAt'].includes(k)))
   if(invoice[field]!==checked[field])throw Error('INVOICE_HANDOFF_BINDING_CHANGED');
  const total=totals.get(invoice.sourceAccount)??{sourceAccount:invoice.sourceAccount,principalYocto:0n,maximumFeesYocto:0n};
  total.principalYocto+=BigInt(invoice.originAmountYocto);total.maximumFeesYocto+=BigInt(invoice.maximumFeeYocto);
  totals.set(invoice.sourceAccount,total);
  let preview=null,blocker=null;
  if(invoice.sourceHash||['SOURCE_VERIFIED','REFUND_PENDING','REFUNDED','VERIFIED'].includes(invoice.state))
   blocker='ALREADY_SUBMITTED_RECONCILE_ONLY_DO_NOT_PAY_AGAIN';
  else if(!releaseReady)blocker='CURRENT_RELEASE_CHECKS_NOT_CLEAR';
  else if(!invoice.quote)blocker='OFFICIAL_SIGNED_QUOTE_REQUIRED';
  else{
   bindTaskQuote(invoice,invoice.quote,invoice.quoteBoundAt);
   if(now>=invoice.expiresAt||Date.parse(invoice.quote.quote.deadline)<now+120000||
     Date.parse(invoice.quote.quoteRequest.deadline)<now+120000)blocker='QUOTE_EXPIRED_DO_NOT_SEND';
   else preview=nativePaymentPreview({source:invoice.sourceAccount,receiver:invoice.quote.quote.depositAddress,
    amountYocto:invoice.originAmountYocto,maximumFeeYocto:invoice.maximumFeeYocto,
    minimumUsdcUnits:invoice.minimumUsdcUnits,recipient:invoice.recipient,deadline:invoice.quote.quote.deadline});
  }
  rows.push({invoiceHash:invoice.invoiceHash,obligationId:invoice.obligationId,kind:invoice.kind,
   state:invoice.state,sourceHash:invoice.sourceHash??null,blocker,preview,
   verificationInput:invoice.sourceHash?{operation:invoice.state==='REFUND_PENDING'?'refund':'verify',
    input:{invoiceHash:invoice.invoiceHash,hash:invoice.state==='REFUND_PENDING'?null:invoice.sourceHash}}:null});
 }
 return {version:'flashfirm-task-payment-handoff/1',taskRoot:flow.manifest.taskRoot,resultRoot:flow.manifest.resultRoot,
  manifestHash:hash(flow.manifest),generatedAt:now,rows,
  missingObligations:flow.manifest.obligations.filter(o=>!rows.some(r=>r.obligationId===o.id)).map(o=>({id:o.id,kind:o.kind,amountUsdcUnits:String(o.amount),recipient:o.recipient})),
  sourceBudgets:[...totals.values()].map(t=>({...t,principalYocto:String(t.principalYocto),maximumFeesYocto:String(t.maximumFeesYocto),
   maximumTotalYocto:String(t.principalYocto+t.maximumFeesYocto)})),
  fundsMoved:false,automaticWalletHandoff:false,
  scope:'Each row is a separately approved invoice and separate deposit. This is not common escrow, a batched transfer, permission to spend, or a proof of payment.'};
}

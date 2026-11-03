import {hash} from './protocol.mjs';
import {verifyReport, citationLocations} from './report-revision.mjs';

export function verifySourceBytes(receipt, texts) {
  const checked=verifyReport(receipt);
  if(!checked.valid)throw Error('INVALID_REPORT');
  const original=receipt.payload.parentReceipt??receipt;
  const files=original.payload.sources.map(source=>{
    const text=texts[source.id];
    if(typeof text!=='string'||hash(text)!==source.fullHash||text.slice(source.excerptStart,source.excerptEnd)!==source.excerpt)
      throw Error('PINNED_SOURCE_BYTES_MISMATCH:'+source.id);
    return {id:source.id,url:source.url,fullHash:source.fullHash,excerptHash:source.excerptHash,bytes:Buffer.byteLength(text)};
  });
  return {verified:true,files,sourceTaskId:checked.sourceTaskId,receiptHash:checked.receiptHash,
    scope:'Retrieved bytes match the signed pinned revision. This does not establish source authority or semantic support.'};
}

export function auditClaimOverlap(receipt) {
  const claims=citationLocations(receipt),groups=new Map();
  for(const claim of claims) {
    if(!claim.exact)continue;
    const key=hash({sourceId:claim.sourceId,quote:claim.quote.replace(/\s+/g,' ').trim()});
    const group=groups.get(key)??[];group.push({workerId:claim.workerId,claimIndex:claim.claimIndex});groups.set(key,group);
  }
  return {claims:claims.length,exactClaims:claims.filter(c=>c.exact).length,
    repeatedEvidence:[...groups].filter(([,v])=>v.length>1).map(([fingerprint,contributors])=>({fingerprint,contributors})),
    scope:'Repeated quotation flags only. Shared evidence can be legitimate; this is not a plagiarism finding, causal contribution score, or payout allocation.'};
}

// Node/browser integration client. Pass a short-lived token from a trusted backend;
// never embed it in a public Pages build. Writes are never automatically retried.
export class FlashFirmClient {
  constructor({baseUrl,token,fetchImpl=fetch}) {
    const url=new URL(baseUrl);
    if(url.protocol!=='https:'&&!(url.protocol==='http:'&&['127.0.0.1','localhost'].includes(url.hostname)))throw Error('HTTPS or loopback required');
    if(url.username||url.password||url.search||url.hash)throw Error('Credentials must not appear in the URL');
    this.base=baseUrl.replace(/\/$/,'');this.token=token;this.fetch=fetchImpl;
  }
  async request(path,method='GET',input,key) {
    const response=await this.fetch(this.base+'/api/workspaces'+path,{method,redirect:'error',signal:AbortSignal.timeout(/\/flow\/(?:privacy|verify|refund|native-verify)$/.test(path)?90000:15000),headers:{Authorization:`Bearer ${this.token}`,'Content-Type':'application/json',...(key?{'Idempotency-Key':key}:{})},...(input===undefined?{}:{body:JSON.stringify(input)})});
    const body=await response.json();if(!response.ok){const error=new Error(body.error??'Request failed');error.status=response.status;throw error;}return body;
  }
  list(){return this.request('');}
  create(title){return this.request('','POST',{title});}
  verifyReceipt(firmId,receipt,idempotencyKey){return this.request(`/${encodeURIComponent(firmId)}/jobs`,'POST',{kind:'VERIFY_RECEIPT',receipt},idempotencyKey);}
  runPublicReview(firmId,idempotencyKey){return this.request(`/${encodeURIComponent(firmId)}/jobs`,'POST',{kind:'LIVE_PUBLIC_REVIEW',preset:'openzeppelin-pinned',approvedCapFen:2000},idempotencyKey);}
  job(firmId,jobId){return this.request(`/${encodeURIComponent(firmId)}/jobs/${encodeURIComponent(jobId)}`);}
  jobs(firmId){return this.request(`/${encodeURIComponent(firmId)}/jobs`);}
  modelStatus(){return this.request('/model-status');}
  attachCase(firmId,receipt){return this.request(`/${encodeURIComponent(firmId)}/case`,'POST',{receipt});}
  taskCase(firmId){return this.request(`/${encodeURIComponent(firmId)}/case`);}
  taskFlow(firmId){return this.request(`/${encodeURIComponent(firmId)}/flow`);}
  taskReadiness(firmId){return this.request(`/${encodeURIComponent(firmId)}/flow/readiness`);}
  reviewPackage(firmId){return this.request(`/${encodeURIComponent(firmId)}/flow/review-package`);}
  executionPackage(firmId){return this.request(`/${encodeURIComponent(firmId)}/flow/execution-package`);}
  paymentHandoff(firmId){return this.request(`/${encodeURIComponent(firmId)}/flow/payment-handoff`);}
  advanceTask(firmId,operation,envelope){
    if(!['plan','quality','privacy','inference','manifest','invoice','quote','verify','refund','native','native-verify'].includes(operation))throw Error('Unknown task-flow action');
    return this.request(`/${encodeURIComponent(firmId)}/flow/${operation}`,'POST',envelope);
  }
  exportCase(firmId){return this.request(`/${encodeURIComponent(firmId)}/case-export`);}
  notifications(firmId){return this.request(`/${encodeURIComponent(firmId)}/notifications`);}
  acknowledge(firmId,id){return this.request(`/${encodeURIComponent(firmId)}/notifications/${encodeURIComponent(id)}`,'POST',{});}
  integrationStatus(){return this.request('/integration-status');}
  createDelivery(firmId,routeId){return this.request(`/${encodeURIComponent(firmId)}/deliveries`,'POST',{routeId});}
  deliveries(firmId){return this.request(`/${encodeURIComponent(firmId)}/deliveries`);}
  verifyDelivery(firmId,id,hash){return this.request(`/${encodeURIComponent(firmId)}/deliveries/${encodeURIComponent(id)}`,'POST',{hash});}
  attestationChallenge(firmId,taskDigest,publicKey){return this.request(`/${encodeURIComponent(firmId)}/attestations`,'POST',{taskDigest,publicKey});}
  verifyAttestation(firmId,nonce,document){return this.request(`/${encodeURIComponent(firmId)}/attestations/${encodeURIComponent(nonce)}`,'POST',{document});}
  reviewerChallenge({accountId,reviewerKey,policyHash}){return this.request('/reviewer-challenge','POST',{accountId,reviewerKey,policyHash});}
  bindReviewer(envelope){return this.request('/reviewer-bindings','POST',envelope);}
  reviewerBindings(){return this.request('/reviewer-bindings');}
  revokeReviewer(accountId,policyHash,reason){return this.request('/reviewer-revoke','POST',{accountId,policyHash,reason});}
  recheckReviewer(accountId,policyHash){return this.request('/reviewer-recheck','POST',{accountId,policyHash});}
  pinReview(firmId,policy,resultRoot){return this.request(`/${encodeURIComponent(firmId)}/review`,'POST',{policy,resultRoot});}
  review(firmId){return this.request(`/${encodeURIComponent(firmId)}/review`);}
  submitDecision(firmId,envelope){return this.request(`/${encodeURIComponent(firmId)}/decision`,'POST',envelope);}
  submitAppeal(firmId,envelope){return this.request(`/${encodeURIComponent(firmId)}/appeal`,'POST',envelope);}
  resolveAppeal(firmId,envelope){return this.request(`/${encodeURIComponent(firmId)}/resolution`,'POST',envelope);}
  events(firmId){return this.request(`/${encodeURIComponent(firmId)}/events`);}
  storeDocument(firmId,value){return this.request(`/${encodeURIComponent(firmId)}/documents`,'POST',value);}
  dissolve(firmId){return this.request(`/${encodeURIComponent(firmId)}/dissolve`,'POST',{});}
  evaluate(input){return this.request('/evaluate','POST',input);}
}

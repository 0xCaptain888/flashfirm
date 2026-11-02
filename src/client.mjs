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
    const response=await this.fetch(this.base+'/api/workspaces'+path,{method,redirect:'error',signal:AbortSignal.timeout(15000),headers:{Authorization:`Bearer ${this.token}`,'Content-Type':'application/json',...(key?{'Idempotency-Key':key}:{})},...(input===undefined?{}:{body:JSON.stringify(input)})});
    const body=await response.json();if(!response.ok){const error=new Error(body.error??'Request failed');error.status=response.status;throw error;}return body;
  }
  list(){return this.request('');}
  create(title){return this.request('','POST',{title});}
  verifyReceipt(firmId,receipt,idempotencyKey){return this.request(`/${encodeURIComponent(firmId)}/jobs`,'POST',{kind:'VERIFY_RECEIPT',receipt},idempotencyKey);}
  job(firmId,jobId){return this.request(`/${encodeURIComponent(firmId)}/jobs/${encodeURIComponent(jobId)}`);}
  events(firmId){return this.request(`/${encodeURIComponent(firmId)}/events`);}
  storeDocument(firmId,value){return this.request(`/${encodeURIComponent(firmId)}/documents`,'POST',value);}
  dissolve(firmId){return this.request(`/${encodeURIComponent(firmId)}/dissolve`,'POST',{});}
  evaluate(input){return this.request('/evaluate','POST',input);}
}

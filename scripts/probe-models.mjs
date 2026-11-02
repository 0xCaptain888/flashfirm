import { readFile, mkdir, writeFile, chmod } from 'node:fs/promises';
const runtime = new URL('../.runtime/', import.meta.url);
const secretFile = new URL('provider-secret.json', runtime);
await chmod(secretFile, 0o600);
const {apiKey} = JSON.parse(await readFile(secretFile,'utf8'));
const result = { checkedAt:new Date().toISOString(), endpoint:'https://api.apikey.fan/v1/models', paidCalls:0 };
try {
  const response = await fetch(result.endpoint,{ headers:{Authorization:`Bearer ${apiKey}`}, redirect:'error', signal:AbortSignal.timeout(20000) });
  result.httpStatus=response.status;
  if(response.ok) {
    const data=await response.json();
    result.modelIds=(Array.isArray(data.data)?data.data:[]).map(m=>m.id).filter(id=>typeof id==='string');
    result.matches=result.modelIds.filter(id=>/deepseek/i.test(id));
    result.exactRequestedModelAvailable=result.modelIds.includes('DeepSeek-V4.1-Flash-1017');
  } else {
    result.status=response.status===401?'CREDENTIAL_REJECTED':'DISCOVERY_BLOCKED';
  }
} catch { result.status='NETWORK_ERROR'; }
await mkdir(runtime,{recursive:true,mode:0o700});
await writeFile(new URL('model-probe.json',runtime),JSON.stringify(result,null,2),{mode:0o600});
console.log(JSON.stringify({...result,modelIds:undefined,modelCount:result.modelIds?.length},null,2));

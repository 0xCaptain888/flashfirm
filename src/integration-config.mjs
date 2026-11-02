import { readFile, stat } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { X509Certificate, createHash } from 'node:crypto';
import { readBounded } from './live.mjs';

// Loaded only from an operator-controlled file at startup, never HTTP request data.
export async function loadIntegrationConfig(filename, fetcher=fetch) {
  if(!filename)return {};
  if(!isAbsolute(filename))throw Error('ABSOLUTE_INTEGRATION_CONFIG_REQUIRED');
  const info=await stat(filename);
  if(!info.isFile()||info.size>65536||(info.mode&0o022))throw Error('UNSAFE_INTEGRATION_CONFIG');
  const config=JSON.parse(await readFile(filename,'utf8'));
  const routes=Object.create(null);
  if(config.routes!==undefined&&(!Array.isArray(config.routes)||config.routes.length>100))throw Error('INVALID_ROUTES');
  for(const item of config.routes??[]) {
    if(!/^[a-z0-9-]{1,60}$/.test(item.id??'')||Object.hasOwn(routes,item.id))throw Error('INVALID_ROUTE_ID');
    const url=new URL(item.rpcUrl);
    if(url.protocol!=='https:'||url.username||url.password||url.hash)throw Error('HTTPS_RPC_REQUIRED');
    routes[item.id]={chainId:item.chainId,token:item.token,recipient:item.recipient,minimumAmount:item.minimumAmount,rpc:async(method,params)=>{
      if(!['eth_chainId','eth_getTransactionReceipt','eth_getBlockByNumber'].includes(method))throw Error('READ_ONLY_RPC');
      const response=await fetcher(url,{method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});
      const value=JSON.parse(await readBounded(response,2000000));
      if(value.error||value.id!==1||value.jsonrpc!=='2.0'||value.result==null)throw Error('DESTINATION_RPC_UNAVAILABLE');
      return value.result;
    }};
  }
  let tee=null;
  if(config.tee) {
    const pcrs=config.tee.pcrs;
    if(!pcrs||Object.keys(pcrs).sort().join()!=='0,1,2'||![0,1,2].every(i=>/^[a-f0-9]{96}$/.test(pcrs[i]??'')&&!/^0+$/.test(pcrs[i])))throw Error('PINNED_PCRS_REQUIRED');
    const rootPem=config.tee.rootPem;
    if(createHash('sha256').update(new X509Certificate(rootPem).raw).digest('hex')!=='641a0321a3e244efe456463195d606317ed7cdcc3c1756e09893f3c68f79bb5b')throw Error('UNTRUSTED_NITRO_ROOT');
    tee={pcrs,rootPem};
  }
  return {routes,tee};
}

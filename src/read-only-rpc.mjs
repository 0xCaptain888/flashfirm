// Fixed public services. Request bodies can never choose a URL or broadcast.
export function pinnedTaskVerifiers(fetcher=fetch){
  const rpc=url=>async(method,params)=>{
    const allowed=url.includes('near.org')?['status','tx','EXPERIMENTAL_tx_status','block']:['eth_chainId','eth_getTransactionReceipt','eth_getBlockByNumber'];
    if(!allowed.includes(method))throw Error('READ_ONLY_RPC');
    const response=await fetcher(url,{method:'POST',redirect:'error',signal:AbortSignal.timeout(20000),
      headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});
    const text=await response.text();
    if(!response.ok||text.length>2000000)throw Error('PINNED_RPC_UNAVAILABLE');
    const body=JSON.parse(text);
    if(body.error||!body.result||body.id!==1)throw Error('PINNED_RPC_REJECTED');
    return body.result;
  };
  return {nearRpc:rpc('https://rpc.mainnet.near.org'),evmRpc:rpc('https://arb1.arbitrum.io/rpc'),
    status:async quote=>{
      const response=await fetcher('https://1click.chaindefuser.com/v0/status?'+new URLSearchParams({depositAddress:quote.quote.depositAddress}),
        {redirect:'error',signal:AbortSignal.timeout(20000)});
      const text=await response.text();
      if(!response.ok||text.length>2000000)throw Error('RELAY_UNAVAILABLE');
      return JSON.parse(text);
    }};
}

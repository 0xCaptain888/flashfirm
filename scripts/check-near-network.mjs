// Public, read-only diagnostics. No signing library, wallet key or balance output.
const accountId = process.argv[2];
if (!accountId || accountId.length > 64 || !/^[a-z0-9]+(?:[-_.][a-z0-9]+)*$/.test(accountId)) throw Error('A valid public NEAR account ID is required');
const results = await Promise.all(['testnet', 'mainnet'].map(async network => {
  const endpoint = `https://rpc.${network}.near.org`;
  async function query(method, params) {
    const response = await fetch(endpoint, { method:'POST', redirect:'error', signal:AbortSignal.timeout(15000), headers:{'Content-Type':'application/json'}, body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}) });
    if (!response.ok) throw Error(`HTTP_${response.status}`);
    return response.json();
  }
  try {
    const identity=await query('status',[]);
    if(identity.result?.chain_id!==network)throw Error('WRONG_RPC_NETWORK');
    const view=await query('query',{request_type:'view_account',finality:'final',account_id:accountId});
    if(view.result)return {network,accountId,rpcReachable:true,accountExists:true,blockHeight:view.result.block_height};
    const error=view.error?.cause?.name??view.error?.name;
    return {network,accountId,rpcReachable:true,accountExists:error==='UNKNOWN_ACCOUNT'?false:null,reason:typeof error==='string'&&/^[A-Z_]+$/.test(error)?error:'RPC_QUERY_REJECTED'};
  } catch(error) {
    return {network,accountId,rpcReachable:false,accountExists:null,reason:/^[A-Z0-9_]+$/.test(error.message)?error.message:error.cause?.code??'CONNECTION_FAILED'};
  }
}));
console.log(JSON.stringify({checkedAt:new Date().toISOString(),readOnly:true,transactionCreated:false,results},null,2));
if(results.every(result=>!result.rpcReachable))process.exitCode=1;

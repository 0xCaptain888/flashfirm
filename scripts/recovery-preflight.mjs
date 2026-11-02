// Read-only: no keys loaded and no transaction constructed or sent.
import { nearRpc, FASTNEAR_TESTNET_RPC } from '../src/near-rpc.mjs';
const accountId='flashfirm-dev-0xcaptain888.testnet';
const rpc=(method,params)=>nearRpc(method,params,fetch,FASTNEAR_TESTNET_RPC);
if((await rpc('status',[])).chain_id!=='testnet')throw Error('WRONG_NETWORK');
const account=await rpc('query',{request_type:'view_account',account_id:accountId,finality:'final'});
const minimum=3n*10n**24n,available=BigInt(account.amount);
console.log(JSON.stringify({status:available>=minimum?'BALANCE_PREFLIGHT_PASSED':'BLOCKED_TESTNET_RESERVE',accountId,network:'testnet',amountYocto:account.amount,plannedReserveYocto:String(minimum),additionalReserveYocto:String(available<minimum?minimum-available:0n),reserveIsNotFeeEstimate:true,executionReady:false,reason:'New isolated contract and disposable recipient; existing closed treasuries are excluded. Balance alone does not authorize or validate execution.',plan:['Create new isolated treasury with developer funds','Pin a currently nonexistent named recipient','Fund 0.001 testnet NEAR and obtain development quorum','After appeal window, claim_for must finish false and restore credit','Create the pinned recipient without deleting any account','Retry claim_for and verify final callback, zero pending/credit and Closed'],transactionsSent:0}));

import test from 'node:test';
import assert from 'node:assert/strict';
import { dryQuoteRequest, IntentsPreview, verifyEvmDelivery } from '../src/intents.mjs';
const route = { network: 'mainnet', originAsset:'asset-a',destinationAsset:'asset-b',originChain:'near',destinationChain:'evm',refundTo:'buyer.near',recipient:'0x'+'1'.repeat(40),maxAmount:'1000' };
const input = {amount:'100',recipient:route.recipient,refundTo:route.refundTo};
test('Intents always previews, pins addresses, bounds amount and rejects testnet confusion', async () => {
  assert.equal(dryQuoteRequest(route,input).dry,true);
  for(const altered of [{amount:'1001'},{recipient:'0x'+'2'.repeat(40)},{amount:'1e2'}]) assert.throws(()=>dryQuoteRequest(route,{...input,...altered}));
  assert.throws(()=>dryQuoteRequest({...route,network:'testnet'},input));
  const api=new IntentsPreview(async(_url,options)=>new Response(JSON.stringify({quoteRequest:JSON.parse(options.body),quote:{amountOut:'99',depositAddress:'unexpected'}})));
  await assert.rejects(api.quote(route,input),/UNEXPECTED_PREVIEW/);
});
test('relay success alone never establishes payment; substitution is rejected',async()=>{
  const saved={quoteRequest:{dry:false,depositMode:'SIMPLE'},quote:{depositAddress:'address'},signature:'sig'};
  const api=new IntentsPreview(async()=>new Response(JSON.stringify({status:'SUCCESS',quoteResponse:saved})));
  assert.equal((await api.status(saved)).paymentVerified,false);
  await assert.rejects(api.status({...saved,signature:'changed'}));
});
test('destination verifier requires exact chain, asset, recipient, amount and finality',async()=>{
  const expected={chainId:'0x1',hash:'0x'+'a'.repeat(64),recipient:route.recipient,token:'0x'+'2'.repeat(40),minimumAmount:'99'};
  const receipt={transactionHash:expected.hash,status:'0x1',blockHash:'block',blockNumber:'0x10',logs:[{address:expected.token,logIndex:'0x0',topics:['0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef','0x'+'0'.repeat(64),'0x'+'0'.repeat(24)+expected.recipient.slice(2)],data:'0x'+(100n).toString(16).padStart(64,'0')}]};
  const rpc=async(method,args)=>method==='eth_chainId'?'0x1':method==='eth_getTransactionReceipt'?receipt:args[0]==='finalized'?{number:'0x11'}:{hash:'block'};
  assert.equal((await verifyEvmDelivery(expected,rpc)).amount,'100');
  await assert.rejects(verifyEvmDelivery({...expected,minimumAmount:'101'},rpc));
  await assert.rejects(verifyEvmDelivery({...expected,recipient:'0x'+'3'.repeat(40)},rpc));
  receipt.status='0x0';await assert.rejects(verifyEvmDelivery(expected,rpc));
});

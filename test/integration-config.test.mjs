import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadIntegrationConfig } from '../src/integration-config.mjs';
test('operator config fails closed, isolates RPC and never permits transaction methods',async()=>{
  assert.deepEqual(await loadIntegrationConfig(),{});
  const dir=await mkdtemp(path.join(tmpdir(),'flashfirm-config-')),file=path.join(dir,'config.json');
  const route={id:'receipt',rpcUrl:'https://rpc.example',chainId:'0x1',token:'0x'+'1'.repeat(40),recipient:'0x'+'2'.repeat(40),minimumAmount:'1'};
  const save=async value=>writeFile(file,JSON.stringify(value),{mode:0o600});
  await save({routes:[route]});let calls=0;
  const config=await loadIntegrationConfig(file,async()=>{calls++;return new Response(JSON.stringify({jsonrpc:'2.0',id:1,result:'0x1'}));});
  await assert.rejects(config.routes.receipt.rpc('eth_sendRawTransaction',['private']),/READ_ONLY/);assert.equal(calls,0);
  assert.equal(await config.routes.receipt.rpc('eth_chainId',[]),'0x1');
  for(const rpcUrl of ['http://rpc.example','https://user:pass@rpc.example','https://rpc.example/#secret']){await save({routes:[{...route,rpcUrl}]});await assert.rejects(loadIntegrationConfig(file));}
  await save({routes:[route,route]});await assert.rejects(loadIntegrationConfig(file),/ROUTE_ID/);
  await save({tee:{pcrs:{0:'0'.repeat(96),1:'1'.repeat(96),2:'2'.repeat(96)}}});await assert.rejects(loadIntegrationConfig(file),/PINNED/);
  await save({});await chmod(file,0o666);await assert.rejects(loadIntegrationConfig(file),/UNSAFE/);
});

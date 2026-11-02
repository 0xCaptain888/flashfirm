import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const root=fileURLToPath(new URL('../',import.meta.url));
function run(command,args,cwd=root,extra={}){const r=spawnSync(command,args,{cwd,stdio:'inherit',env:{...process.env,...extra}});if(r.error)throw r.error;if(r.status!==0)throw Error(`${command} failed (${r.status})`);}
const config=process.env.FLASHFIRM_CARGO_MIRROR==='rsproxy'?['--config','source.tuna.registry="sparse+https://rsproxy.cn/index/"']:[];
run('cargo',[...config,'build','--locked','--target','wasm32-unknown-unknown','--release'],root+'contracts/treasury',{RUSTFLAGS:'-C target-feature=-bulk-memory,-reference-types,-multivalue,-sign-ext,-nontrapping-fptoint'});
await mkdir(root+'artifacts',{recursive:true});
run('wasm-opt',['contracts/treasury/target/wasm32-unknown-unknown/release/flashfirm_treasury.wasm','-o','artifacts/flashfirm_treasury.wasm','--signext-lowering','--llvm-memory-copy-fill-lowering','--llvm-nontrapping-fptoint-lowering','--strip-debug','--strip-producers','--mvp-features']);
const wasm=await readFile(root+'artifacts/flashfirm_treasury.wasm');
const source=createHash('sha256');for(const name of ['Cargo.toml','Cargo.lock','src/lib.rs','src/ledger.rs'])source.update(name+'\0').update(await readFile(root+'contracts/treasury/'+name));
const record={version:'flashfirm-build/1',sha256:createHash('sha256').update(wasm).digest('hex'),sourceSha256:source.digest('hex'),bytes:wasm.length,network:'UNDEPLOYED',instructionSet:'WASM_MVP',builtAt:new Date().toISOString()};
await writeFile(root+'artifacts/contract-build.json',JSON.stringify(record,null,2));console.log(JSON.stringify(record));

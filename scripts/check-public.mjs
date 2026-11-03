import {execFileSync} from 'node:child_process';
import {readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const files=execFileSync('git',['ls-files','-z'],{encoding:'utf8'}).split('\0').filter(Boolean);
const secrets=[];
try{const config=JSON.parse(await readFile('.runtime/provider-secret.json','utf8'));for(const [key,value]of Object.entries(config))if(/key|token|secret/i.test(key)&&typeof value==='string'&&value.length>12)secrets.push(value);}catch(e){if(e.code!=='ENOENT')throw e;}
try{for(const name of await readdir('.runtime/cloudflare'))if(/-token\.txt$|^production-vault\.key$/.test(name)){const value=(await readFile('.runtime/cloudflare/'+name,'utf8')).trim();if(value.length>12)secrets.push(value);}}catch(e){if(e.code!=='ENOENT')throw e;}
for(const file of files){
 if(file.startsWith('.runtime/')||file==='.env'||/\.sqlite(?:-wal|-shm)?$|vault\.key|operator-token\.txt/.test(file))throw Error('Private file staged');
 const bytes=await readFile(file);const text=bytes.toString('utf8');
 if (/ed25519:[1-9A-HJ-NP-Za-km-z]{80,}/.test(text)) throw Error(`NEAR private-key-like content found in ${file}`);
 if(secrets.some(secret=>text.includes(secret))||/-----BEGIN (?:RSA |EC |ENCRYPTED )?PRIVATE KEY-----|\bghp_[A-Za-z0-9]{30,}|\bsk-[A-Za-z0-9]{35,}/.test(text))throw Error(`Credential-like content found in ${file}`);
}
const build=JSON.parse(await readFile('artifacts/contract-build.json','utf8'));
const sandbox=JSON.parse(await readFile('evidence/sandbox.json','utf8'));
const sha=createHash('sha256').update(await readFile('artifacts/flashfirm_treasury.wasm')).digest('hex');
const source=createHash('sha256');for(const name of ['Cargo.toml','Cargo.lock','src/lib.rs','src/ledger.rs','src/review.rs'])source.update(name+'\0').update(await readFile('contracts/treasury/'+name));
if(source.digest('hex')!==build.sourceSha256)throw Error('Contract source changed without rebuilding the tested artifact');
if(sha!==build.sha256||sha!==sandbox.wasmSha256||sandbox.status!=='PASS')throw Error('Contract artifact/evidence mismatch');
console.log(JSON.stringify({status:'PASS',trackedFiles:files.length,credentialMatches:0,contractEvidenceMatches:true}));

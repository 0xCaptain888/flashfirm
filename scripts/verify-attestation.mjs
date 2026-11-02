import { readFile } from 'node:fs/promises';
import { verifyNitroAttestation } from '../src/nitro-attestation.mjs';
const [documentFile, expectedFile, rootFile] = process.argv.slice(2);
if (!documentFile || !expectedFile || !rootFile) throw Error('Usage: node scripts/verify-attestation.mjs document.cbor expected.json AWS-root.pem');
const expected=JSON.parse(await readFile(expectedFile,'utf8'));
for(const key of ['nonce','publicKey','taskDigest'])expected[key]=Buffer.from(expected[key],'hex');
console.log(JSON.stringify(await verifyNitroAttestation(await readFile(documentFile),expected,await readFile(rootFile,'utf8'))));

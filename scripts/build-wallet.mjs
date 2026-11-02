import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { base58 } from '../src/near-deployment.mjs';
const manifest = JSON.parse(await readFile(new URL('../artifacts/contract-build.json', import.meta.url), 'utf8'));
await build({ entryPoints: [new URL('../web/treasury.js', import.meta.url).pathname], outfile: new URL('../web/treasury.bundle.js', import.meta.url).pathname, bundle: true, platform: 'browser', format: 'esm', target: 'es2022', minify: true, sourcemap: false, legalComments: 'linked', define: { __TREASURY_CODE_HASH__: JSON.stringify(base58(Buffer.from(manifest.sha256, 'hex'))) } });
console.log('Testnet wallet bundle built; no credential or account configuration included.');

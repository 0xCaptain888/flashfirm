import {readFile, mkdir, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const source = await readFile(new URL('../tee/phala-worker.mjs', import.meta.url), 'utf8');
const args = process.argv.slice(2);
if (args.length !== 0 && !(args.length === 2 && args[0] === '--container-image')) {
  throw Error('USAGE: tee:build [--container-image ghcr.io/0xcaptain888/flashfirm-phala-quotation@sha256:DIGEST]');
}
const containerImage = args[0] === '--container-image' ? args[1] : null;
if (containerImage && !/^ghcr\.io\/0xcaptain888\/flashfirm-phala-quotation@sha256:[a-f0-9]{64}$/.test(containerImage)) {
  throw Error('IMMUTABLE_QUOTATION_CONTAINER_IMAGE_REQUIRED');
}
// Immutable official Docker Node 22 Alpine linux/amd64 image, resolved 2026-11-03.
// Spell out the official registry/repository and human-readable base-image tag.
// The unchanged digest remains authoritative; this does not select new bytes.
const image = containerImage ?? 'docker.io/library/node:22-alpine@sha256:025b8e975a61d94e33abeafaad1255ef44e4898cf1a1b6446860009c72e6d284';
// Base64 avoids Compose interpolation ($) and shell quoting of embedded code.
const encoded = Buffer.from(source.replace("if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)", 'if (true)')).toString('base64');
const compose = JSON.stringify({services: {app: {
  image, platform: 'linux/amd64',
  command: containerImage ? ['node', '/app/phala-worker.mjs'] :
    ['node', '--input-type=module', '-e', `await import('data:text/javascript;base64,${encoded}')`],
  ports: ['80:3000'], volumes: ['/var/run/dstack.sock:/var/run/dstack.sock'],
  read_only: true, cap_drop: ['ALL'], security_opt: ['no-new-privileges:true'],
  pids_limit: 64, mem_limit: '512m', restart: 'no', logging: {driver: 'none'},
}}}, null, 2) + '\n';
await mkdir('.runtime/phala', {recursive: true, mode: 0o700});
await writeFile('.runtime/phala/docker-compose.json', compose, {mode: 0o600});
const manifest = {version: 'flashfirm-phala-build/v1', image,
  packaging: containerImage ? 'PUBLISHED_CONTAINER' : 'COMPOSE_EMBEDDED_SOURCE',
  sourceSha256: createHash('sha256').update(source).digest('hex'),
  dockerComposeSha256: createHash('sha256').update(compose).digest('hex'),
  scope: 'Dependency-free exact quotation gate; no remote AI inference; public proof test only',
  secretReleaseAllowed: false, maxFirstRunUsd: 5};
await writeFile('.runtime/phala/build.json', JSON.stringify(manifest, null, 2) + '\n', {mode: 0o600});
console.log(JSON.stringify({...manifest, composePath: '.runtime/phala/docker-compose.json'}));

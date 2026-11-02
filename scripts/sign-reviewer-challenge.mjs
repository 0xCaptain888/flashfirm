import { readFile, writeFile, stat } from 'node:fs/promises';
import { signReviewerChallenge } from '../src/reviewer-signing.mjs';

const [challengeFile, expectedFile, outputFile] = process.argv.slice(2);
try {
  if (!challengeFile || !expectedFile || !outputFile || process.argv.length !== 5) throw Error('Usage: node scripts/sign-reviewer-challenge.mjs challenge.json expected.json response.json');
  const readKey = async name => {
    const file = process.env[name];
    if (!file) throw Error(`Missing ${name}`);
    const info = await stat(file);
    if (!info.isFile() || info.size > 8192 || (info.mode & 0o077)) throw Error('Key file must be private (chmod 600) and at most 8192 bytes');
    return readFile(file,'utf8');
  };
  const readPublic = async file => {
    const info = await stat(file);
    if (!info.isFile() || info.size > 16384) throw Error('Oversized public input');
    return JSON.parse(await readFile(file,'utf8'));
  };
  const envelope = signReviewerChallenge(await readPublic(challengeFile),await readPublic(expectedFile),await readKey('FLASHFIRM_REVIEWER_KEY_FILE'),await readKey('FLASHFIRM_ACCOUNT_KEY_FILE'));
  await writeFile(outputFile,JSON.stringify(envelope,null,2)+'\n',{flag:'wx',mode:0o600});
  console.log('Public binding response saved. No transaction or network request was made.');
} catch {
  // Do not echo parser/crypto exceptions that may include sensitive input.
  console.error('Signing refused. Check arguments, expected identity, expiry, Ed25519 PEM files, private file permissions and that the output does not exist.');
  process.exitCode=1;
}

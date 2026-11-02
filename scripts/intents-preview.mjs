import { readFile } from 'node:fs/promises';
import { IntentsPreview } from '../src/intents.mjs';
const api=new IntentsPreview(),[mode,file]=process.argv.slice(2);
if(mode==='tokens')console.log(JSON.stringify(await api.tokens()));
else if(mode==='quote'){
  const {route,input}=JSON.parse(await readFile(file,'utf8'));
  console.log(JSON.stringify(await api.quote(route,input)));
}else if(mode==='status')console.log(JSON.stringify(await api.status(JSON.parse(await readFile(file,'utf8')))));
else throw Error('Usage: node scripts/intents-preview.mjs tokens|quote|status [local-public-plan.json]');

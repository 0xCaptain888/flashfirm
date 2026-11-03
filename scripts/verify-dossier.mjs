import {readFile} from 'node:fs/promises';
import {verifyCaseExport} from '../src/task-case.mjs';
if(!process.argv[2])throw Error('Provide the path to a downloaded task dossier');
const result=verifyCaseExport(JSON.parse(await readFile(process.argv[2],'utf8')));
console.log(JSON.stringify(result,null,2));
if(!result.valid)process.exitCode=1;

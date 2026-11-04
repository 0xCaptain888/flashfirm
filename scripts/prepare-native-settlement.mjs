import {readFile,writeFile} from 'node:fs/promises';
import {nativeExecutionPackage} from '../src/native-execution-package.mjs';
try{
 const [source,target]=process.argv.slice(2);
 if(!source||!target)throw Error('ARGUMENTS_REQUIRED');
 const file=JSON.parse(await readFile(source,'utf8')),flow=file.flow??file;
 const pkg=nativeExecutionPackage(flow);
 await writeFile(target,JSON.stringify(pkg,null,2)+'\n',{flag:'wx',mode:0o600});
 console.log(JSON.stringify({state:'EXACT_EXECUTION_PACKAGE_SAVED',network:pkg.network,obligations:pkg.allocations.length,
  enabled:false,fundsMoved:false}));
}catch(e){
 console.error(/^[A-Z][A-Z0-9_]+$/.test(e.message)?e.message:'PREVIEW_REFUSED_CHECK_INPUT_AND_NEW_OUTPUT_PATH');
 process.exitCode=1;
}

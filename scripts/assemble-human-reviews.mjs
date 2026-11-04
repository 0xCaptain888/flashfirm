import {readFile,writeFile,stat} from 'node:fs/promises';
import {assembleHumanReviews} from '../src/review-assembly.mjs';
try{
 const [pkgFile,inputFile,outputFile]=process.argv.slice(2);
 if(!pkgFile||!inputFile||!outputFile)throw Error('PACKAGE_RESPONSES_AND_NEW_OUTPUT_REQUIRED');
 const read=async file=>{if((await stat(file)).size>3000000)throw Error('INPUT_TOO_LARGE');return JSON.parse(await readFile(file,'utf8'));};
 const input=await read(inputFile),result=assembleHumanReviews(await read(pkgFile),input.responses,input);
 await writeFile(outputFile,JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});
 console.log(JSON.stringify({state:'VERIFIED_REVIEW_IMPORT_PREPARED',quality:result.assessment.state,
  reviewers:input.responses.length,releaseReady:false,fundsMoved:false,networkCalls:0}));
}catch(e){console.error(/^[A-Z][A-Z0-9_]+$/.test(e.message)?e.message:'REVIEW_ASSEMBLY_REFUSED');process.exitCode=1;}

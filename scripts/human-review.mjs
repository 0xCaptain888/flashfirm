import {readFile,writeFile,stat} from 'node:fs/promises';
import {createPublicKey} from 'node:crypto';
import {blankReview,signHumanReview,validateHumanEvaluation,validateReviewPackage} from '../src/review-package.mjs';
import {hash,seal} from '../src/protocol.mjs';
import {assessReview} from '../src/governance.mjs';
try{
 const [mode,packageFile,inputFile,outputFile,expectedPlanHash]=process.argv.slice(2);
 const readJson=async(file,max=1500000)=>{
  const info=await stat(file);if(!info.isFile()||info.size>max)throw Error('INPUT_TOO_LARGE');
  return JSON.parse(await readFile(file,'utf8'));
 };
 const pkg=await readJson(packageFile);validateReviewPackage(pkg);
 if(mode==='draft'){
  const publicKey=await readFile(inputFile,'utf8');
  await writeFile(outputFile,JSON.stringify(blankReview(pkg,publicKey),null,2)+'\n',{flag:'wx',mode:0o600});
  console.log(JSON.stringify({state:'BLANK_REVIEW_SAVED',planHash:hash(pkg.plan),
   instructions:'Confirm the plan hash and buyer identity through your trusted channel before signing. Complete every claim, sample notes, score and decision independently.'}));
 }else if(mode==='sign'){
  if(!/^[a-f0-9]{64}$/.test(expectedPlanHash??'')||expectedPlanHash!==hash(pkg.plan))throw Error('OUT_OF_BAND_EXPECTED_PLAN_HASH_REQUIRED');
  const keyFile=process.env.FLASHFIRM_REVIEWER_KEY_FILE,info=keyFile?await stat(keyFile):null;
  if(!info?.isFile()||info.size>8192||(info.mode&0o077))throw Error('PRIVATE_REVIEWER_KEY_FILE_REQUIRED');
  const privateKey=await readFile(keyFile,'utf8'),publicKey=createPublicKey(privateKey).export({type:'spki',format:'pem'});
  const result=signHumanReview(pkg,await readJson(inputFile),{privateKey,publicKey},seal);
  await writeFile(outputFile,JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});
  console.log(JSON.stringify({state:'SIGNED_REVIEW_SAVED',independenceCertified:false,transactions:0,paidCalls:0}));
 }else if(mode==='verify'){
  const result=await readJson(inputFile);
  if(result.packageHash!==hash(pkg)||result.evaluation?.publicKey!==result.decision?.publicKey)throw Error('REVIEW_RESPONSE_BINDING_MISMATCH');
  validateHumanEvaluation(pkg,result.evaluation);
  assessReview(pkg.reviewCommitment,pkg.plan.payload.resultRoot,[result.decision],Date.now());
  console.log(JSON.stringify({state:'SIGNATURE_AND_TASK_BINDING_VALID',independenceCertified:false}));
 }else throw Error('EXPECTED_DRAFT_SIGN_OR_VERIFY');
}catch(e){
 console.error(/^[A-Z][A-Z0-9_]+$/.test(e.message)?e.message:'REVIEW_REFUSED_CHECK_ARGUMENTS_PRIVATE_KEY_PERMISSIONS_AND_NEW_OUTPUT_PATH');
 process.exitCode=1;
}

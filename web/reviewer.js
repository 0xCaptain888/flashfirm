const $=s=>document.querySelector(s);
let csrf='',state=null,pkg=null,draft=null,busy=false;
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const message=s=>{$('#message').textContent=s;};
function save(value,name,type='application/json'){
 const url=URL.createObjectURL(new Blob([type==='application/json'?JSON.stringify(value,null,2):value],{type}));
 const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
async function api(route,input){
 const r=await fetch('/api/'+route,{method:'POST',redirect:'error',headers:{'Content-Type':'application/json','x-flashfirm-csrf':csrf},
  body:JSON.stringify(input),signal:AbortSignal.timeout(15000)});
 const data=await r.json();if(!r.ok)throw Error(data.error);return data;
}
async function act(fn){
 if(busy)return;busy=true;document.querySelectorAll('button').forEach(b=>b.disabled=true);
 try{await fn();}catch(e){message(e.message);}
 finally{busy=false;document.querySelectorAll('button').forEach(b=>b.disabled=false);
  $('#create-key').disabled=!!state?.publicKey;$('#public-key').disabled=!state?.publicKey;}
}
function keyState(){
 $('#key-state').textContent=state.publicKey?'Public key fingerprint: '+state.keyFingerprint:'No signing key created yet.';
 $('#create-key').disabled=!!state.publicKey;$('#public-key').disabled=!state.publicKey;
}
function render(){
 $('#review').hidden=false;
 $('#claims').innerHTML=pkg.claims.map((c,i)=>`<article class="event"><h3>Claim ${i+1} · ${esc(c.workerId)}</h3><p>${esc(c.statement)}</p><p><strong>Exact quotation:</strong> ${esc(c.quote)}</p><details><summary>Pinned source context · ${esc(c.sourceId)}</summary><pre>${esc(c.sourceExcerpt)}</pre></details><label for="claim-${i}">Support verdict</label><select id="claim-${i}"><option value="">Choose after reading the source</option>${['SUPPORTED','UNSUPPORTED','CONTRADICTED','INFERENCE'].map(v=>`<option>${v}</option>`).join('')}</select><label for="context-${i}">Source context · must include the exact quote</label><textarea id="context-${i}" rows="3"></textarea><label for="reason-${i}">Your reason · at least 20 characters</label><textarea id="reason-${i}" rows="3" maxlength="2000"></textarea></article>`).join('');
 $('#samples').innerHTML=pkg.samples.map((s,i)=>`<article class="event"><h3>Sample ${i+1} · ${esc(s.sampleHash.slice(0,12))}</h3><details><summary>Read this sample’s complete artifacts</summary><pre>${esc(JSON.stringify(s.input,null,2))}</pre></details>${pkg.plan.payload.rubric.map((r,j)=>`<label for="score-${i}-${j}">${esc(r.id)} · weight ${r.weight}% · score 0–100</label><input id="score-${i}-${j}" type="number" min="0" max="100" step="1">`).join('')}<label for="notes-${i}">Your sample assessment · at least 20 characters</label><textarea id="notes-${i}" rows="3" maxlength="4000"></textarea></article>`).join('');
 for(const [i,c]of pkg.claims.entries())$('#context-'+i).value=c.quote;
 $('#verdict').value='';$('#reason').value='';$('#independent').checked=false;
}
function collect(){
 const value=structuredClone(draft);
 value.evaluation.claims.forEach((c,i)=>{c.verdict=$('#claim-'+i).value||null;c.sourceContext=$('#context-'+i).value;c.reason=$('#reason-'+i).value;});
 value.evaluation.samples.forEach((s,i)=>{s.notes=$('#notes-'+i).value;s.criteria.forEach((c,j)=>{
  const text=$(`#score-${i}-${j}`).value;c.score=text===''?null:Number(text);});});
 value.decision.verdict=$('#verdict').value||null;value.decision.reason=$('#reason').value;return value;
}
$('#create-key').onclick=()=>act(async()=>{state=await api('key',{confirm:'CREATE_MY_OWN_OFFCHAIN_REVIEW_KEY'});keyState();message('Local key saved. Share only the public key, enroll it before the task plan, and return when the buyer supplies a package.');});
$('#public-key').onclick=()=>save(state.publicKey,'flashfirm-reviewer-public.pem','text/plain');
$('#load').onclick=()=>act(async()=>{
 const file=$('#package').files[0];if(!file||file.size>1400000)throw Error('Choose a public review package under 1.4 MB.');
 const result=await api('load',{package:JSON.parse(await file.text()),expectedPlanHash:$('#plan-hash').value.trim(),expectedBuyerFingerprint:$('#buyer-hash').value.trim()});
 state=result;pkg=result.package;draft=result.draft;render();message('Package verified. Your judgments remain blank.');
});
$('#draft').onclick=()=>save(collect(),'flashfirm-human-review-draft.json');
$('#restore-draft').onclick=()=>act(async()=>{
 const file=$('#saved-draft').files[0];if(!file||file.size>1000000)throw Error('Choose your unsigned draft under 1 MB.');
 const value=JSON.parse(await file.text());
 if(value.version!==draft.version||value.packageHash!==draft.packageHash||value.reviewerKey!==draft.reviewerKey||
  value.evaluation?.planHash!==draft.evaluation.planHash||value.evaluation?.resultRoot!==draft.evaluation.resultRoot||
  value.evaluation?.claims?.length!==draft.evaluation.claims.length||value.evaluation?.samples?.length!==draft.evaluation.samples.length)
  throw Error('This draft belongs to another reviewer or package.');
 const claims=draft.evaluation.claims.map(c=>value.evaluation.claims.find(v=>v.claimHash===c.claimHash&&v.workerId===c.workerId&&v.claimIndex===c.claimIndex));
 const samples=draft.evaluation.samples.map(s=>value.evaluation.samples.find(v=>v.sampleHash===s.sampleHash));
 if(claims.some(c=>!c)||samples.some(s=>!s||!Array.isArray(s.criteria)))throw Error('Incomplete or changed draft bindings.');
 for(const [i,c]of claims.entries()){
  $('#claim-'+i).value=c.verdict??'';$('#context-'+i).value=c.sourceContext??'';$('#reason-'+i).value=c.reason??'';
 }
 for(const [i,s]of samples.entries()){
  $('#notes-'+i).value=s.notes??'';
  draft.evaluation.samples[i].criteria.forEach((c,j)=>{$(`#score-${i}-${j}`).value=s.criteria.find(v=>v.id===c.id)?.score??'';});
 }
 $('#verdict').value=value.decision?.verdict??'';$('#reason').value=value.decision?.reason??'';$('#independent').checked=false;
 message('Draft restored for this exact package. Recheck your judgments before signing.');
});
$('#sign').onclick=()=>act(async()=>{
 if(!$('#independent').checked)throw Error('Complete the independent-review acknowledgment before signing.');
 const response=await api('sign',{draft:collect(),expectedPlanHash:$('#plan-hash').value.trim(),expectedBuyerFingerprint:$('#buyer-hash').value.trim(),confirm:'I_COMPLETED_THIS_REVIEW_INDEPENDENTLY'});
 save(response,'flashfirm-human-review-response.json');message('Signed response saved locally and downloaded. Send this response only through your agreed channel; no payment was made.');
});
try{const r=await fetch('/api/session',{redirect:'error'});if(!r.ok)throw Error('Start this page using npm run review:console on your own computer.');
 const data=await r.json();csrf=data.csrf;state=data;keyState();}catch(e){message(e.message);document.querySelectorAll('button').forEach(b=>b.disabled=true);}

const $ = s => document.querySelector(s);
let token = '', firm = null, poll = null, epoch = 0, busy = false, availability = null, uncertain = null, taskCase = null;
let pushSettings=null;
const intentKey='flashfirm:job-intent:v1';
try{uncertain=JSON.parse(sessionStorage.getItem(intentKey)||'null');}catch{sessionStorage.removeItem(intentKey);}
function clearIntent(){uncertain=null;sessionStorage.removeItem(intentKey);}
const escape = s => String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const message = s => { $('#message').textContent = s; };
fetch('/api/auth/config').then(r=>r.json()).then(v=>{
 $('#org-login').disabled=!v.configured;
 if(!v.configured)$('#org-status').textContent='Organization identity provider awaits configuration. Existing private access tokens remain available.';
}).catch(()=>{$('#org-login').disabled=true;$('#org-status').textContent='Organization sign-in configuration is unavailable.';});
function controls() {
  for (const id of ['verify','upload','store','dissolve','run-model']) $('#'+id).disabled = busy || firm?.state !== 'ACTIVE' || (id === 'run-model' && (!availability?.enabled||taskCase?.status?.attached));
  $('#verify').textContent=taskCase?.status?.attached?'Verify this task report':'Verify recorded AI receipt';
  for(const id of ['attach-revision','attach-original']) $('#'+id).disabled=busy||firm?.state!=='ACTIVE'||taskCase?.status?.attached===true;
  for(const id of ['pin-review','submit-review']) $('#'+id).disabled=busy||firm?.state!=='ACTIVE'||!taskCase?.status?.attached;
  $('#export-case').disabled=busy||!taskCase?.status?.attached;
  for(const id of ['submit-flow','export-flow']) $('#'+id).disabled=busy||!taskCase?.status?.attached||(id==='submit-flow'&&firm?.state!=='ACTIVE');
  $('#refresh-jobs').disabled = busy || !firm; $('#create button').disabled = busy;
}
function lock() {
  token = ''; firm = null; availability = null; taskCase = null; pushSettings=null; epoch++; clearTimeout(poll);
  $('#push-enable').disabled=true;
  $('#workspace-content').hidden = true; $('#selected').hidden = true; $('#login-panel').hidden = false;
  for (const id of ['document','title','receipt','token','review-policy','review-envelope','flow-input','org-invite']) $('#'+id).value = '';
  for (const id of ['firms','events','jobs','result','budget','case-status','notifications','flow-status','org-status']) $('#'+id).textContent = '';
  controls();
}
async function api(path, method='GET', data, key) {
  const slowProof=/\/flow\/(?:privacy|verify|refund)$/.test(path);
  const r = await fetch('/api/workspaces'+path, { method, signal: AbortSignal.timeout(slowProof?90000:15000), headers: { Authorization:`Bearer ${token}`, 'Content-Type':'application/json', ...(key ? {'Idempotency-Key':key}: {}) }, ...(data !== undefined ? {body:JSON.stringify(data)}: {}) });
  const out = await r.json();
  if (!r.ok) { if (r.status === 401) lock(); const error=Error(out.error);error.status=r.status;throw error; } return out;
}
async function refresh() {
  const current = epoch, firms = await api(''); if (current !== epoch) return;
  $('#firms').innerHTML = firms.length ? firms.map(f=>`<div class="event"><button class="button secondary" data-firm="${escape(f.id)}">${escape(f.title)}</button> <span class="pill">${escape(f.state)}</span></div>`).join('') : '<p class="muted">No workspaces yet. Start with one focused task.</p>';
  try{
   pushSettings=await api('/push-config');if(current!==epoch)return;
   $('#push-enable').disabled=!pushSettings.configured||!('serviceWorker' in navigator)||!('PushManager' in window);
   $('#push-status').textContent=pushSettings.configured?'Background push is available by explicit opt-in. Device receipt has not been verified.':'Background push unavailable: '+pushSettings.reason+'.';
  }catch{pushSettings=null;$('#push-enable').disabled=true;$('#push-status').textContent='Background push is unavailable in this deployment.';}
  return firms;
}
async function budget() {
  const current = epoch; const status = await api('/model-status'); if (current !== epoch) return;
  availability = status; const b = status.budget;
  $('#budget').textContent = b ? `Conservatively reserved ¥${(b.reservedFen/100).toFixed(2)} / ¥${(b.capFen/100).toFixed(2)} · ${b.calls}/${b.maxCalls} calls. Actual provider bill not queried. ${status.enabled ? 'A complete four-call run fits the current allowance.' : 'New run blocked: '+status.reason+'.'}` : 'Model configuration unavailable. Existing evidence can still be verified.';
  controls();
}
async function history() {
  if (!firm) return;
  const current = epoch, id = firm.id;
  const [jobs, events, dossier, inbox] = await Promise.all([api(`/${id}/jobs`), api(`/${id}/events`),api(`/${id}/case`),api(`/${id}/notifications`)]);
  if (current !== epoch || firm?.id !== id) return;
  if(uncertain?.firm===id&&jobs.some(j=>j.requestKey===uncertain.key))clearIntent();
  $('#jobs').innerHTML = jobs.length ? jobs.map(j=>`<article class="job-card"><div class="job-meta"><strong>${escape(j.kind.replaceAll('_',' '))}</strong><span class="pill">${escape(j.state)}</span></div><p class="muted">${escape(new Date(j.created).toLocaleString())} · ${j.attempts} attempt(s)</p><button class="button secondary" data-job="${escape(j.id)}">Open result</button></article>`).join('') : '<p class="muted">No tasks yet.</p>';
  $('#events').innerHTML = events.reverse().map(e=>`<div class="event"><strong>${escape(e.kind.replaceAll('_',' '))}</strong><p class="muted">${escape(new Date(e.created).toLocaleString())}</p></div>`).join('');
  taskCase=dossier;renderCase();controls();
  const flow=await api(`/${id}/flow`);if(current!==epoch)return;
  const quality=flow.flow?.quality;
  const scoring=quality?`<h4>Signed semantic and removal evaluations · ${escape(quality.state)}</h4><p class="muted">${escape(quality.methods.join(', '))} · ${flow.flow.evaluations.length} pinned signatures. Independent people still require external identity certification.</p><table><thead><tr><th>Worker</th><th>Full quality</th><th>Without worker</th><th>Quality lost</th><th>Planned USDC</th></tr></thead><tbody>${quality.scores.map(s=>`<tr><td>${escape(s.id)}${s.duplicate?' · duplicate':''}</td><td>${(s.full/100).toFixed(2)}</td><td>${(s.without/100).toFixed(2)}</td><td>${(s.marginal/100).toFixed(2)}</td><td>${(quality.allocation.payouts.find(a=>a.id===s.id).amount/1000000).toFixed(6)}</td></tr>`).join('')}</tbody></table><p class="muted">These are signed evaluator scores, not objective truth. Planned contributions are not payments.</p>`:'<p class="muted">Semantic and removal evaluations have not been attached.</p>';
  const manifest=flow.status.manifest,obligations=manifest?.obligations??[];
  const kind=k=>({'WORKER':'Worker','PROTOCOL_FEE':'Protocol fee','UNSPENT_REFUND':'Unused budget refund'}[k]??k);
  const nativeDone=flow.status.nativeTestnetSettlementVerified===true;
  const obligationRows=obligations.map(o=>{
   const invoice=flow.status.invoices?.find(i=>i.obligationId===o.id);
   return `<tr><td>${escape(o.workerId??kind(o.kind))}</td><td>${escape((o.amount/1000000).toFixed(6))} USDC allocation</td><td>${nativeDone?'Paid in buyer-approved testnet NEAR':escape(invoice?.state??(flow.status.nativeSettlement?'Native payment evidence pending':'Not funded'))}</td></tr>`;
  }).join('');
  const privacy=flow.status.confidentialInferenceVerified?
   'Task artifacts have ACI verifier certificates under the configured external OS/KMS/model audit policy.':
   flow.flow?.privacy?.privateQuotationVerified?'Attested private quotation verified. Model inference has no proof.':'No task-bound confidential inference proof.';
  $('#flow-status').innerHTML=`<span class="pill">${escape(flow.status.state.replaceAll('_',' '))}</span><p class="muted">${flow.identityAuthorityConfigured?'External identity authority configured. Certificates still require validation.':'Payment blocked until an external identity authority is configured and the roster is certified.'}</p>${scoring}<p>${privacy}</p>${manifest?`<p>Allocation locked · ${manifest.payouts.length} payable workers · ${(manifest.feeUnits/1000000).toFixed(6)} USDC fee · ${(manifest.refundUnits/1000000).toFixed(6)} USDC unused budget.</p>`:''}${obligationRows?`<table><thead><tr><th>Obligation</th><th>Planned amount</th><th>Payment evidence</th></tr></thead><tbody>${obligationRows}</tbody></table>`:''}<div>${(flow.status.invoices??[]).map(i=>`<article class="event"><strong>${escape(i.workerId??kind(i.kind??'WORKER'))} · ${escape(i.state)}</strong><p>${escape(i.recipient)} · minimum ${escape((Number(i.minimumUsdcUnits)/1000000).toFixed(6))} USDC</p></article>`).join('')}</div><p class="muted">Mainnet task settlement: ${flow.status.taskSettlementComplete?'all worker, fee and unused-budget obligations verified':'incomplete'}. Native testnet settlement: ${nativeDone?'all fixed obligations verified':'not verified'}. Native NEAR amounts require a separate buyer signature and are not a USDC conversion.</p>`;
  $('#notification-count').textContent=`${inbox.unread} unread`;
  $('#notifications').innerHTML=inbox.items.length?inbox.items.map(n=>`<article class="inbox-item ${n.acknowledged?'acknowledged':''}"><strong>${escape(n.title)}</strong><p>${escape(n.detail)}</p>${n.acknowledged?'<span class="muted">Acknowledged</span>':`<button class="button secondary" data-ack="${escape(n.id)}">Mark read</button>`}</article>`).join(''):'<p class="muted">No reminders. Import a report to start its evidence trail.</p>';
  if('Notification' in window&&Notification.permission==='granted'&&sessionStorage.getItem('flashfirm:notify')==='yes'){
   for(const n of inbox.items.filter(n=>!n.acknowledged)){
    const key='flashfirm:notification:'+n.id;
    if(!sessionStorage.getItem(key)){new Notification(n.title,{body:n.detail,tag:n.id,icon:'/favicon.svg'});sessionStorage.setItem(key,'shown');}
   }
  }
  clearTimeout(poll);
  const waiting=jobs.some(j=>['QUEUED','RUNNING'].includes(j.state))||['APPROVED_PENDING_APPEAL','AWAITING_QUORUM','APPEAL_PENDING'].includes(dossier.status.review?.state);
  if(waiting)poll=setTimeout(async()=>{if(busy){poll=setTimeout(()=>history().catch(e=>message(e.message)),6000);return;}try{await history();}catch(e){message(e.status===429?'Refresh paused at the request limit. Wait a minute, then use Refresh.':e.message);}},10000);
}
async function select(id) {
  clearTimeout(poll); const current = ++epoch; availability = null; taskCase=null; firm=null; controls();
  const selected = await api('/'+id); if (current !== epoch) return;
  firm = selected; $('#selected').hidden = false; $('#firm-title').textContent = firm.title; $('#firm-state').textContent = firm.state; $('#result').textContent = ''; $('#document').value = '';
  sessionStorage.setItem('flashfirm:selected-workspace',firm.id);
  controls(); await Promise.all([history(), budget()]);
}
function renderCase(){
 const status=taskCase?.status;
 if(!status?.attached){$('#case-status').innerHTML='<p class="muted">No report bound yet. Choose an original report or the corrected revision above.</p>';return;}
 $('#case-status').innerHTML=`<div class="case-summary"><span class="pill">${escape(status.state.replaceAll('_',' '))}</span><p>${escape(status.nextAction)}</p><small>Task ${escape(status.sourceTaskId)}</small></div><div class="gate-grid">${status.gates.filter(g=>!['privacy','settlement'].includes(g.id)).map(g=>`<article class="gate"><span class="mini-label">${escape(g.id)}</span><strong>${escape(g.state.replaceAll('_',' '))}</strong><p>${escape(g.detail)}</p></article>`).join('')}</div><p class="muted">This dossier covers the report and review. Current privacy and payment evidence appears in the task settlement pipeline below.</p><details><summary>Source locations and claims (${status.claims.length})</summary>${status.claims.map(c=>`<article class="claim"><strong>${escape(c.workerId)} · ${escape(c.kind)}</strong><p>${escape(c.statement)}</p><blockquote>${escape(c.quote)}</blockquote><small>${escape(c.sourceId)} · ${c.exact?'exact quotation, excerpt line '+c.excerptLine:'quotation rejected'} · conclusion requires review</small></article>`).join('')}</details><details><summary>Exact task and report commitments</summary><pre>${escape(JSON.stringify({workspaceId:status.workspaceId,taskRoot:status.taskRoot,receiptHash:status.receiptHash,parentHash:status.parentHash,review:taskCase.review},null,2))}</pre></details>`;
}
function download(value,filename){const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
async function perform(fn) { if (busy) return; busy = true; controls(); try { await fn(); } catch (e) { message(e.message); } finally { busy = false; controls(); } }
function action(id, fn) { $(id).addEventListener('click', e=>{e.preventDefault();perform(fn);}); }
$('#login').addEventListener('submit', async e=>{e.preventDefault();if(busy)return;await perform(async()=>{const current=epoch;token=$('#token').value.trim();$('#token').value='';const firms=await refresh();if(current!==epoch||!token)return;$('#login-panel').hidden=true;$('#workspace-content').hidden=false;const saved=new URL(location.href).searchParams.get('workspace')??sessionStorage.getItem('flashfirm:selected-workspace');if(firms?.some(f=>f.id===saved))await select(saved);message('Workspace unlocked.');});});
$('#logout').onclick = ()=>perform(async()=>{try{await api('/logout','POST',{});}catch{}lock();message('Locked. Private page content and token cleared.');});
action('#org-login',async()=>{
 const response=await fetch('/api/auth/session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({invite:$('#org-invite').value||undefined})});
 const value=await response.json();if(!response.ok)throw Error(value.error??'Organization identity provider is not configured.');
 token=value.token;$('#org-invite').value='';$('#login-panel').hidden=true;$('#workspace-content').hidden=false;
 $('#org-status').textContent=`${value.email} · ${value.role}. Session expires ${new Date(value.expiresAt).toLocaleString()}.`;
 const firms=await refresh(),target=new URL(location.href).searchParams.get('workspace');
 if(firms?.some(f=>f.id===target))await select(target);
});
action('#push-enable',async()=>{
 if(!pushSettings?.configured)throw Error('Background push requires organization identity and VAPID setup.');
 if(!('Notification' in window)||await Notification.requestPermission()!=='granted')throw Error('Notification permission was not granted.');
 const registration=await navigator.serviceWorker.register('/push-worker.js',{scope:'/'});
 await navigator.serviceWorker.ready;
 const publicKey=Uint8Array.from(atob(pushSettings.publicKey.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-pushSettings.publicKey.length%4)%4)),c=>c.charCodeAt(0));
 let subscription=await registration.pushManager.getSubscription();
 if(subscription&&subscription.options?.applicationServerKey){
  const old=new Uint8Array(subscription.options.applicationServerKey);
  if(old.length!==publicKey.length||old.some((b,i)=>b!==publicKey[i])){await subscription.unsubscribe();subscription=null;}
 }
 subscription??=await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:publicKey});
 try{await api('/push-subscription','POST',{enabled:true,subscription:subscription.toJSON()});}
 catch(error){await subscription.unsubscribe();throw error;}
 message('Background push subscribed. Generic alerts only; this does not verify device delivery.');
});
action('#push-disable',async()=>{
 // Revoke server consent first; a browser failure cannot leave delivery enabled.
 await api('/push-subscription','POST',{enabled:false});
 const registration=await navigator.serviceWorker?.getRegistration('/');
 await (await registration?.pushManager.getSubscription())?.unsubscribe();
 message('Background push disabled for your organization identity. Queued sends recheck consent.');
});
action('#browser-notifications',async()=>{
 if(!('Notification' in window))throw Error('Browser notifications are unavailable.');
 const permission=await Notification.requestPermission();
 if(permission!=='granted')throw Error('Permission was not granted. The inbox remains available.');
 sessionStorage.setItem('flashfirm:notify','yes');message('Notifications enabled while this workspace page remains open.');await history();
});
for(const [id,enabled]of [['email-enable',true],['email-disable',false]])action('#'+id,async()=>{
 const result=await api('/email-subscription','POST',{enabled});
 message(result.deliveryEnabled?(enabled?'Email subscription enabled.':'Email subscription disabled.'):'Preference saved. Email delivery remains disabled until a verified sender is configured.');
});
action('#export-flow',async()=>{download(await api(`/${firm.id}/flow`),`flashfirm-evaluation-${firm.id}.json`);});
action('#submit-flow',async()=>{
 const op=$('#flow-operation').value,value=$('#flow-input').value.trim();
 message('Validating this step. Chain and hardware proofs may take up to 90 seconds. No payment is initiated.');
 await api(`/${firm.id}/flow/${op}`,'POST',value?JSON.parse(value):{});
 $('#flow-input').value='';message('Task step validated and saved. No payment initiated.');await history();
});
$('#create').onsubmit = e=>{e.preventDefault();perform(async()=>{const f=await api('','POST',{title:$('#title').value});$('#title').value='';await refresh();await select(f.id);});};
$('#firms').onclick = e=>{const b=e.target.closest('[data-firm]');if(b&&!busy)perform(()=>select(b.dataset.firm));};
async function queue(input) {
  const id=firm.id,current=epoch;
  const fingerprint=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify({id,input})))),n=>n.toString(16).padStart(2,'0')).join('');
  if(uncertain&&(uncertain.firm!==id||uncertain.fingerprint!==fingerprint))throw Error('A previous submission has an uncertain response. Open that workspace history and retry the same action before submitting different work.');
  if(current!==epoch)return;
  uncertain??={firm:id,fingerprint,key:crypto.randomUUID()};sessionStorage.setItem(intentKey,JSON.stringify(uncertain));
  let job;try{job=await api(`/${id}/jobs`,'POST',input,uncertain.key);}catch(error){if(error.status>=400&&error.status<500)clearIntent();throw error;}clearIntent();
  if(current!==epoch)return;message(`Task ${job.state.toLowerCase()}. Its result and activity will remain in history.`);await history();
}
action('#verify',async()=>{
 if(taskCase?.record?.receipt){await queue({kind:'VERIFY_RECEIPT',receipt:taskCase.record.receipt});return;}
 const r=await fetch('/api/live-receipt',{signal:AbortSignal.timeout(15000)});const receipt=await r.json();if(!r.ok)throw Error(receipt.error);await queue({kind:'VERIFY_RECEIPT',receipt});
});
action('#upload',async()=>{const f=$('#receipt').files[0];if(!f)throw Error('Choose a receipt JSON first');if(f.size>350000)throw Error('Receipt too large');await queue({kind:'VERIFY_RECEIPT',receipt:JSON.parse(await f.text())});});
action('#run-model',async()=>{await budget();if(!availability?.enabled)throw Error('A complete run does not fit the current authorized model allowance.');if(!confirm('Run four paid model calls on the approved public OpenZeppelin sources? This uses the existing cumulative budget.'))return;await queue({kind:'LIVE_PUBLIC_REVIEW',preset:'openzeppelin-pinned',approvedCapFen:2000});await budget();});
action('#refresh-jobs',async()=>{await Promise.all([history(),budget()]);});
for(const [button,url]of [['attach-revision','/revised-live-receipt.json'],['attach-original','/api/live-receipt']]){
 action('#'+button,async()=>{
  const id=firm.id,current=epoch,r=await fetch(url,{signal:AbortSignal.timeout(15000)}),receipt=await r.json();
  if(!r.ok)throw Error('Recorded report unavailable');if(current!==epoch)return;
  await api(`/${id}/case`,'POST',{receipt});message('Report bound. Original evidence and pending review remain explicit.');await history();
 });
}
action('#export-case',async()=>{const value=await api(`/${firm.id}/case-export`);download(value,`flashfirm-dossier-${firm.id}.json`);message('Dossier downloaded. Recheck it with npm run case:verify -- /path/to/file.json');});
action('#pin-review',async()=>{
 const policy=JSON.parse($('#review-policy').value),status=taskCase.status;
 if(policy.taskRoot!==status.taskRoot)throw Error('Policy taskRoot must match the exact task commitment shown above.');
 await api(`/${firm.id}/review`,'POST',{policy,resultRoot:status.receiptHash});message('Review policy pinned to this exact report.');await history();
});
action('#submit-review',async()=>{
 const operation=$('#review-operation').value;
 if(!['decision','appeal','resolution'].includes(operation))throw Error('Unsupported review action');
 await api(`/${firm.id}/${operation}`,'POST',JSON.parse($('#review-envelope').value));
 $('#review-envelope').value='';message('Signed review envelope verified and recorded. No payment was made.');await history();
});
$('#notifications').onclick=e=>{const button=e.target.closest('[data-ack]');if(button&&!busy)perform(async()=>{await api(`/${firm.id}/notifications/${button.dataset.ack}`,'POST',{});await history();});};
$('#jobs').onclick=e=>{const b=e.target.closest('[data-job]');if(!b)return;perform(async()=>{
  const current=epoch,id=firm.id,job=await api(`/${id}/jobs/${b.dataset.job}`);if(current!==epoch)return;
  const result=job.result,wrapper=document.createElement('article');wrapper.className='job-card';
  const heading=document.createElement('h3');heading.textContent=`${job.kind} · ${job.state}`;wrapper.append(heading);
  const summary=document.createElement('p');summary.className='muted';summary.textContent=!result?'No completed result yet.':result.error?result.error:result.receipt?`Model review: ${result.receipt.payload.state}. No settlement executed.`:`Receipt validity: ${result.valid===true?'PASS':'FAIL'}. ${result.scope??''}`;wrapper.append(summary);
  if(result?.receipt){const button=document.createElement('button');button.className='button secondary';button.textContent='Download signed report receipt';button.onclick=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(result.receipt,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=`flashfirm-${job.id}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};wrapper.append(button);}
  if(result){const details=document.createElement('details');const title=document.createElement('summary');title.textContent='Full verification and evidence';const pre=document.createElement('pre');pre.textContent=JSON.stringify(result,null,2);details.append(title,pre);wrapper.append(details);}
  $('#result').replaceChildren(wrapper);
});};
action('#store',async()=>{const text=$('#document').value.trim();if(!text)throw Error('Enter a source note first');const id=firm.id,current=epoch;await api(`/${id}/documents`,'POST',{text});if(current!==epoch)return;$('#document').value='';message('Encrypted note saved. It was not sent to a model.');await history();});
action('#dissolve',async()=>{if(!confirm('Close this workspace? In-flight provider calls can still incur cost. Active private notes are removed; audit and partial outputs remain.'))return;const id=firm.id;await api(`/${id}/dissolve`,'POST',{});await refresh();await select(id);message('Workspace closed. No blockchain funds were moved.');});

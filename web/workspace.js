const $ = s => document.querySelector(s);
let token = '', firm = null, poll = null, epoch = 0, busy = false, availability = null, uncertain = null;
const intentKey='flashfirm:job-intent:v1';
try{uncertain=JSON.parse(sessionStorage.getItem(intentKey)||'null');}catch{sessionStorage.removeItem(intentKey);}
function clearIntent(){uncertain=null;sessionStorage.removeItem(intentKey);}
const escape = s => String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const message = s => { $('#message').textContent = s; };
function controls() {
  for (const id of ['verify','upload','store','dissolve','run-model']) $('#'+id).disabled = busy || firm?.state !== 'ACTIVE' || (id === 'run-model' && !availability?.enabled);
  $('#refresh-jobs').disabled = busy || !firm; $('#create button').disabled = busy;
}
function lock() {
  token = ''; firm = null; availability = null; epoch++; clearTimeout(poll);
  $('#workspace-content').hidden = true; $('#selected').hidden = true; $('#login-panel').hidden = false;
  for (const id of ['document','title','receipt','token']) $('#'+id).value = '';
  for (const id of ['firms','events','jobs','result','budget']) $('#'+id).textContent = '';
  controls();
}
async function api(path, method='GET', data, key) {
  const r = await fetch('/api/workspaces'+path, { method, signal: AbortSignal.timeout(15000), headers: { Authorization:`Bearer ${token}`, 'Content-Type':'application/json', ...(key ? {'Idempotency-Key':key}: {}) }, ...(data !== undefined ? {body:JSON.stringify(data)}: {}) });
  const out = await r.json();
  if (!r.ok) { if (r.status === 401) lock(); const error=Error(out.error);error.status=r.status;throw error; } return out;
}
async function refresh() {
  const current = epoch, firms = await api(''); if (current !== epoch) return;
  $('#firms').innerHTML = firms.length ? firms.map(f=>`<div class="event"><button class="button secondary" data-firm="${escape(f.id)}">${escape(f.title)}</button> <span class="pill">${escape(f.state)}</span></div>`).join('') : '<p class="muted">No workspaces yet. Start with one focused task.</p>';
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
  const [jobs, events] = await Promise.all([api(`/${id}/jobs`), api(`/${id}/events`)]);
  if (current !== epoch || firm?.id !== id) return;
  if(uncertain?.firm===id&&jobs.some(j=>j.requestKey===uncertain.key))clearIntent();
  $('#jobs').innerHTML = jobs.length ? jobs.map(j=>`<article class="job-card"><div class="job-meta"><strong>${escape(j.kind.replaceAll('_',' '))}</strong><span class="pill">${escape(j.state)}</span></div><p class="muted">${escape(new Date(j.created).toLocaleString())} · ${j.attempts} attempt(s)</p><button class="button secondary" data-job="${escape(j.id)}">Open result</button></article>`).join('') : '<p class="muted">No tasks yet.</p>';
  $('#events').innerHTML = events.reverse().map(e=>`<div class="event"><strong>${escape(e.kind.replaceAll('_',' '))}</strong><p class="muted">${escape(new Date(e.created).toLocaleString())}</p></div>`).join('');
  clearTimeout(poll);
  if (jobs.some(j=>['QUEUED','RUNNING'].includes(j.state))) poll = setTimeout(()=>history().catch(e=>message(e.message)), 3000);
}
async function select(id) {
  clearTimeout(poll); const current = ++epoch; availability = null; controls();
  const selected = await api('/'+id); if (current !== epoch) return;
  firm = selected; $('#selected').hidden = false; $('#firm-title').textContent = firm.title; $('#firm-state').textContent = firm.state; $('#result').textContent = ''; $('#document').value = '';
  controls(); await Promise.all([history(), budget()]);
}
async function perform(fn) { if (busy) return; busy = true; controls(); try { await fn(); } catch (e) { message(e.message); } finally { busy = false; controls(); } }
function action(id, fn) { $(id).addEventListener('click', e=>{e.preventDefault();perform(fn);}); }
$('#login').addEventListener('submit', async e=>{e.preventDefault();if(busy)return;await perform(async()=>{const current=epoch;token=$('#token').value.trim();$('#token').value='';await refresh();if(current!==epoch||!token)return;$('#login-panel').hidden=true;$('#workspace-content').hidden=false;message('Workspace unlocked.');});});
$('#logout').onclick = ()=>{lock();message('Locked. Private page content and token cleared.');};
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
action('#verify',async()=>{const r=await fetch('/api/live-receipt',{signal:AbortSignal.timeout(15000)});const receipt=await r.json();if(!r.ok)throw Error(receipt.error);await queue({kind:'VERIFY_RECEIPT',receipt});});
action('#upload',async()=>{const f=$('#receipt').files[0];if(!f)throw Error('Choose a receipt JSON first');if(f.size>350000)throw Error('Receipt too large');await queue({kind:'VERIFY_RECEIPT',receipt:JSON.parse(await f.text())});});
action('#run-model',async()=>{await budget();if(!availability?.enabled)throw Error('A complete run does not fit the current authorized model allowance.');if(!confirm('Run four paid model calls on the approved public OpenZeppelin sources? This uses the existing cumulative budget.'))return;await queue({kind:'LIVE_PUBLIC_REVIEW',preset:'openzeppelin-pinned',approvedCapFen:2000});await budget();});
action('#refresh-jobs',async()=>{await Promise.all([history(),budget()]);});
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

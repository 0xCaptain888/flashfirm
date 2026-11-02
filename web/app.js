const $ = selector => document.querySelector(selector);
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const money = cents => new Intl.NumberFormat('en-US', { style:'currency', currency:'USD' }).format(cents / 100);
let current = null, running = false, status = null;
async function api(path, options = {}) { const response = await fetch(path, { ...options, headers:{'Content-Type':'application/json'}, cache:'no-store' }); const result = await response.json(); if (!response.ok) throw Error(result.error || 'Request failed'); return result; }
function error(message) { $('#error').hidden = !message; $('#error').textContent = message; }
function view(name) {
  document.querySelectorAll('.view').forEach(el => el.hidden = el.id !== name);
  document.querySelectorAll('.nav').forEach(el => el.classList.toggle('active', el.dataset.view === name));
  $('#view-title').textContent = {console:'Task console',history:'Activity',verify:'Receipt verifier',integrations:'Integrations'}[name];
  if (name === 'history') history().catch(e => error(e.message));
}
document.querySelectorAll('[data-view]').forEach(el => el.addEventListener('click', () => view(el.dataset.view)));
function busy(value) { running = value; $('#run').disabled = value; $('#new-task').disabled = value; $('#run').textContent = value ? 'Running sample…' : current && current.state !== 'PLANNED' ? 'Resume sample ↗' : 'Run sample task ↗'; }
function render(t) {
  if (!t) { $('#task-content').innerHTML = '<div class="panel empty"><h3>Your next team starts here.</h3><p>Run the sample to inspect signed work, failure recovery and contribution allocation.</p></div>'; return; }
  const accepted = t.work.filter(w => w.accepted).length, rejected = t.work.filter(w => !w.accepted).length;
  const plan = t.receipt?.payload;
  $('#task-content').innerHTML = `
    <div class="steps">${['DRAFT','FORMING','ACTIVE','CHALLENGED','REPLACED','ACCEPTED','PLANNED'].map(s => `<span class="${t.state === s ? 'current' : ''}">${s}</span>`).join('')}</div>
    <div class="metrics"><div class="panel metric"><span class="mini-label">SAMPLE BUDGET</span><strong>${money(t.budget)}</strong><small>Local ledger · not funded</small></div><div class="panel metric"><span class="mini-label">ACCEPTED WORK</span><strong>${accepted.toString().padStart(2,'0')}</strong><small>Signed specialist artifacts</small></div><div class="panel metric"><span class="mini-label">REJECTED WORK</span><strong>${rejected.toString().padStart(2,'0')}</strong><small>No performance allocation</small></div><div class="panel metric"><span class="mini-label">SETTLEMENT</span><strong>Pending</strong><small>No transaction broadcast</small></div></div>
    <div class="columns"><div class="panel"><div class="panel-heading"><h2>Your specialist team</h2><span class="pill">FIXTURE WORKERS</span></div>${status.agents.filter(a => a.id !== 'signal-backup' || t.work.some(w => w.agent === a.id)).map((a,i) => {
      const w = t.work.find(w => w.agent === a.id); const label = w ? w.accepted ? 'ACCEPTED' : 'REJECTED' : a.id === 'lens' ? 'DETERMINISTIC CHECKER' : 'WAITING';
      return `<div class="agent"><span class="agent-icon">${['⌘','◈','⌁','◇','↻'][i]}</span><div><strong>${escape(a.name)}</strong><p>${escape(a.role)}</p></div><span class="pill ${w ? w.accepted ? 'good' : 'bad' : ''}">${label}</span></div>`;
    }).join('')}<p class="muted">Three specialist workers + a source checker. Identities are signed locally; these are not independent AI providers.</p></div><div class="panel"><div class="panel-heading"><h2>Live task log</h2><span class="pill">${t.events.length} EVENTS</span></div>${t.events.length ? t.events.slice(-6).map(e => `<div class="event ${e.kind}"><small>${escape(e.state)} · ${new Date(e.at).toLocaleTimeString()}</small><p>${escape(e.message)}</p></div>`).join('') : '<p class="muted">Ready to form your team.</p>'}</div></div>
    ${plan ? `<div class="panel allocation"><div class="panel-heading"><h2>Value, made visible.</h2><span class="pill good">REPRODUCIBLE ALLOCATION</span></div><p class="muted">Leave-one-out sample rubric coverage. A contribution earns weight only when removing it reduces coverage. This is not an objective measure of real-world quality.</p><table><thead><tr><th>Contributor</th><th>Full / without</th><th>Marginal coverage</th><th>Planned allocation</th></tr></thead><tbody>${plan.scores.map(s => `<tr><td>${escape(s.id.split(':')[0])}${!s.eligible ? ' <span class="pill bad">INELIGIBLE</span>' : ''}</td><td>${s.full} / ${s.without}</td><td>${s.marginal} points<div class="bar"><div class="bar-fill" data-width="${s.marginal}"></div></div></td><td>${money(plan.allocation.payouts.find(p => p.id === s.id).amount)}</td></tr>`).join('')}<tr><td>Protocol fee · 2%</td><td></td><td></td><td>${money(plan.allocation.fee)}</td></tr><tr><td>Buyer refund</td><td></td><td></td><td>${money(plan.allocation.refund)}</td></tr></tbody></table><div class="receipt-row"><p>Budget conserved to the cent.<br>Settlement is blocked until a NEAR treasury and authorized signer are connected.</p><button class="button secondary" id="inspect">Verify this receipt</button><a class="button primary" href="/api/tasks/${t.id}/receipt">Download proof ↓</a></div><details><summary>Inspect signed receipt</summary><pre>${escape(JSON.stringify(t.receipt,null,2))}</pre></details></div>` : ''}`;
  document.querySelectorAll('[data-width]').forEach(el => el.style.width = `${el.dataset.width}%`);
  $('#inspect')?.addEventListener('click', () => { $('#receipt-input').value = JSON.stringify(t.receipt, null, 2); view('verify'); $('#verify-button').click(); });
}
async function run() {
  if (running) return;
  busy(true); error('');
  try {
    if (!current || current.state === 'PLANNED') {
      const form = new FormData($('#task-form'));
      current = await api('/api/tasks', {method:'POST',body:JSON.stringify({title:form.get('title'),budget:Math.round(Number(form.get('budget')) * 100),fault:form.has('fault')})});
      localStorage.setItem('flashfirm-task', current.id);
    }
    render(current);
    while (current.state !== 'PLANNED') {
      current = await api(`/api/tasks/${current.id}/advance`, {method:'POST',body:'{}'}); render(current);
      // Presentation pacing only. Every rendered state comes from persisted server events.
      await new Promise(resolve => setTimeout(resolve, 450));
    }
  } catch (e) { error(e.message); } finally { busy(false); }
}
$('#task-form').addEventListener('submit', e => {e.preventDefault();run();});
$('#new-task').addEventListener('click', () => {current = null;localStorage.removeItem('flashfirm-task');render(null);busy(false);$('#task-form input').focus();});
async function history() {
  const tasks = await api('/api/tasks');
  $('#history-content').innerHTML = tasks.length ? tasks.map(t => `<div class="panel history-row"><div><h3>${escape(t.title)}</h3><small>${new Date(t.createdAt).toLocaleString()} · ${money(t.budget)} sample budget</small></div><span class="pill">${escape(t.state)}</span><button class="button secondary" data-task="${t.id}">Open task ↗</button></div>`).join('') : '<div class="panel empty">No tasks yet. Start a sample in the task console.</div>';
  document.querySelectorAll('[data-task]').forEach(el => el.addEventListener('click', async () => {if(running)return; try{ current=await api(`/api/tasks/${el.dataset.task}`);localStorage.setItem('flashfirm-task',current.id);render(current);busy(false);view('console');}catch(e){error(e.message);}}));
}
$('#verify-button').addEventListener('click', async () => {
  const box = $('#verify-result');
  try { const receipt = JSON.parse($('#receipt-input').value); const result = await api('/api/verify',{method:'POST',body:JSON.stringify(receipt)}); box.className = `result ${result.valid ? '' : 'fail'}`; box.textContent = `${result.valid ? 'Integrity checks passed.' : `Verification failed: ${result.errors.join('; ')}`} ${result.scope}`; }
  catch(e){box.className='result fail';box.textContent=`Unable to verify: ${e.message}`;}
});
async function init() {
  try {
    status = await api('/api/status');
    const items = [['Ed25519 work signatures','Signed envelopes tied to task and artifact hashes.',true],['Persistent task coordinator','Durable local state with resumable task steps.',true],['Independent receipt CLI','Recompute the receipt outside the browser.',true],['Live AI workers','Sample workers are deterministic fixtures.',false],['NEAR treasury & settlement','No contract deployed or funds transferred.',false],['NEAR Intents','Cross-chain delivery requires a live settlement integration.',false],['Confidential execution','No TEE attestation; only synthetic public inputs.',false],['Independent evaluator quorum','Local deterministic checker only.',false]];
    $('#integrations-content').innerHTML=items.map(([name,description,ready])=>`<div class="panel integration"><div><h3>${name}</h3><p>${description}</p></div><span class="pill ${ready?'good':''}">${ready?'AVAILABLE':'NOT CONNECTED'}</span></div>`).join('');
    const saved=localStorage.getItem('flashfirm-task'); if(saved){try{current=await api(`/api/tasks/${saved}`);}catch{localStorage.removeItem('flashfirm-task');}}
    render(current);busy(false);
  }catch(e){error(`Coordinator unavailable: ${e.message}`);}
}
init();

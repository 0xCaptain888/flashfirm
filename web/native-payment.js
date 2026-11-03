const $=id=>document.getElementById(id);
let csrf='',state,account='',busy=false;
const wallet=()=>window.okxwallet?.near;
function render(){
  $('source').textContent=state.policy.signer;$('recipient').textContent=state.policy.recipient;
  const submitted=!!state.journal?.sourceHash;
  $('account').textContent=submitted?'Saved payment · read only':account||'Disconnected';
  $('connect').hidden=submitted;
  $('funding-controls').hidden=submitted;
  if(state.manualPreview){$('manual-preview').hidden=false;$('manual-details').textContent=JSON.stringify(state.manualPreview,null,2);}
  const q=state.journal?.quote??state.preview?.response;
  $('quote').textContent=q?`Signed quote: 0.5 NEAR → ${q.quote.amountOutFormatted} USDC; minimum ${(BigInt(q.quote.minAmountOut)/1000000n).toString()}.${(BigInt(q.quote.minAmountOut)%1000000n).toString().padStart(6,'0')} USDC. Input valuation $${q.quote.amountInUsd}.`:'No quote yet.';
  $('state').textContent=state.journal?.state??'No native transfer initiated';
  const delivery=state.journal?.evidence?.delivery;
  $('transaction').textContent=state.journal?.sourceHash?`NEAR source TX: ${state.journal.sourceHash}`:'';
  $('delivery').textContent=delivery?`Arbitrum USDC received: ${(BigInt(delivery.amount)/1000000n).toString()}.${(BigInt(delivery.amount)%1000000n).toString().padStart(6,'0')} USDC · Destination TX: ${delivery.transactionHash}`:'';
  $('details').textContent=JSON.stringify(state.journal?.evidence??{relayStatus:state.journal?.lastStatus?.status,
    originalCheck:state.journal?.originalCheck,origin:state.journal?.origin,prepared:state.journal?.prepared,paymentVerified:false},null,2);
  $('connect').disabled=busy||account===state.policy.signer;
  $('preview').disabled=busy||!!state.journal;
  $('reserve').disabled=busy||!!state.journal||!state.preview||!$('approve').checked;
  $('accept').disabled=busy||state.journal?.state!=='RECEIVED_QUOTE'||!$('approve').checked;
  $('prepare').disabled=busy||state.journal?.state!=='QUOTED';
  $('sign').disabled=busy||state.journal?.state!=='PREPARED'||account!==state.policy.signer||!$('approve').checked;
  $('check').disabled=busy||!state.journal;
}
async function request(path,input={}){
  const r=await fetch('/api/'+path,{method:'POST',headers:{'Content-Type':'application/json','X-FlashFirm-CSRF':csrf},body:JSON.stringify(input)});
  const v=await r.json();if(!r.ok)throw Error(v.error);return v;
}
async function action(fn){
  if(busy)return;busy=true;render();
  try{await fn();}catch(e){$('message').textContent=e.message||'Interrupted. Do not repeat the deposit.';}
  finally{try{state=await(await fetch('/api/state')).json();}catch{}busy=false;render();}
}
const approval='NATIVE_NEAR_TO_ARBITRUM_USDC_MAX_5_USD';
$('approve').onchange=render;
$('connect').onclick=()=>action(async()=>{
  if(!wallet())throw Error('Open in Chrome with OKX Wallet.');
  if(!wallet().isSignedIn())await wallet().requestSignIn({contractId:''});
  account=wallet().getAccountId()||'';
  if(account!==state.policy.signer)throw Error('Select the approved NEAR source account in OKX.');
  $('message').textContent='Connected. No funds moved and no access key requested.';
});
$('preview').onclick=()=>action(async()=>{state=await request('preview');$('message').textContent='Original order is still unfunded. Fresh official quote signature and budget verified.';});
$('reserve').onclick=()=>action(async()=>{state=await request('reserve',{approval});$('message').textContent='New native deposit instruction saved; original rejected order preserved. No funds moved.';});
$('accept').onclick=()=>action(async()=>{state=await request('accept-quote',{approval,minimumAmount:state.journal.quote.quote.minAmountOut});$('message').textContent='Displayed updated output accepted for the same saved deposit. No replacement order created.';});
$('prepare').onclick=()=>action(async()=>{state=await request('prepare');$('message').textContent='Finalized source balance and fresh budget checked. Review the native transfer in OKX within 90 seconds.';});
$('sign').onclick=()=>action(async()=>{
  if(wallet()?.getAccountId()!==state.policy.signer)throw Error('Approved source account required.');
  const {preview}=await request('manual-start',{account,approval});
  $('manual-preview').hidden=false;$('manual-details').textContent=JSON.stringify(preview,null,2);
  $('message').textContent='No wallet request sent. Compare these instructions in the wallet native Send screen, then paste the resulting hash once.';
});
$('record-manual').onclick=()=>action(async()=>{
  state=await request('record',{hash:$('manual-hash').value.trim()});
  $('manual-hash').value='';$('manual-preview').hidden=true;
  $('message').textContent='Source transaction recorded. Check both chains; this alone does not prove delivery.';
});
$('check').onclick=()=>action(async()=>{
  state=await request('check');
  $('message').textContent=state.journal.state==='VERIFIED'?'VERIFIED: exact finalized NEAR deposit and finalized Arbitrum USDC receipt.':
    state.journal.state==='AWAITING_DESTINATION_FINALITY'?'NEAR deposit verified; relay reports SUCCESS. Waiting for Arbitrum finalized confirmation. Do not pay again.':
    `Relay status: ${state.journal.lastStatus?.status??'unknown'}. Do not send another deposit.`;
});
try{
  state=await(await fetch('/api/session')).json();csrf=state.csrf;
  if(wallet()?.isSignedIn())account=wallet().getAccountId()||'';
  wallet()?.on('accountChanged',()=>{account='';render();});
  render();$('message').textContent=state.journal?'Saved native order restored. Inspect it before any further payment.':'Ready. Original wallet FunctionCall signing remains disabled.';
}catch(e){$('message').textContent=e.message;}

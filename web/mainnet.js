const $=id=>document.getElementById(id);
let csrf='',state,account='',busy=false;
const provider=()=>window.okxwallet?.near;
function controls(){
  const phase=state?.journal?.state;
  $('connect').disabled=busy||account===state?.policy.signer;
  $('preview').disabled=busy||!!state?.journal;
  $('issue').disabled=busy||!!state?.journal||!state?.preview||!$('approve').checked;
  $('prepare').disabled=busy||phase!=='QUOTED';
  $('sign').disabled=busy||!state?.walletExecution?.signingEnabled||phase!=='PREPARED'||account!==state?.policy.signer||!$('approve').checked;
  $('reconcile').disabled=busy||!state?.journal?.sourceHash;
  $('observe').disabled=busy||!state?.journal;
}
function render(){
  $('source').textContent=state.policy.signer;$('recipient').textContent=state.policy.recipient;
  const quote=state.journal?.quote??state.preview?.result;
  $('quote').textContent=quote?(state.journal&&!state.walletExecution.signingEnabled?
    `Saved quote from ${quote.timestamp}: ${quote.quote.amountOutFormatted} USDC estimated then. Historical value only; signing is locked.`:
    `Signed quote: ${quote.quote.amountOutFormatted} USDC estimated. Input valuation: $${quote.quote.amountInUsd}. Refresh before signing if expired.`):'No quote yet.';
  $('account').textContent=account||'Disconnected';
  $('state').textContent=state.journal?.walletReview?'Wallet review required · payment not verified':state.journal?.state??'No mainnet transaction submitted';
  $('transaction').textContent=state.journal?.sourceHash?`NEAR source transaction: ${state.journal.sourceHash}`:'';
  $('actions').textContent=JSON.stringify(state.journal?.prepared??{},null,2);
  $('details').textContent=JSON.stringify(state.journal?.evidence??{relayState:state.journal?.relayState,
    observation:state.journal?.observation,walletReview:state.journal?.walletReview,
    walletResponse:state.journal?.walletResponse,paymentVerified:false,taskTreasuryLinked:false},null,2);
  controls();
}
async function request(path,value={}){
  const response=await fetch('/api/'+path,{method:'POST',headers:{'Content-Type':'application/json','X-FlashFirm-CSRF':csrf},body:JSON.stringify(value)});
  const result=await response.json();if(!response.ok)throw Error(result.error);return result;
}
async function action(fn){
  if(busy)return;busy=true;controls();
  try{await fn();}catch(error){$('message').textContent=error.message||'Wallet operation interrupted. No automatic retry.';}
  finally{try{const response=await fetch('/api/state');if(response.ok)state=await response.json();}catch{}busy=false;render();}
}
$('approve').onchange=controls;
$('connect').onclick=()=>action(async()=>{
  const wallet=provider();if(!wallet)throw Error('Open this page in Chrome with the OKX Wallet extension enabled.');
  // Match the upstream NEAR wallet-selector adapter; omit contract access entirely.
  if(!wallet.isSignedIn())await wallet.requestSignIn({contractId:''});
  account=wallet.getAccountId()||'';
  if(account!==state.policy.signer)throw Error('Connected account differs from the approved source. Select the approved NEAR account in OKX Wallet, then reconnect.');
  $('message').textContent='Wallet connected. No transaction signed and no delegated access requested.';
});
$('preview').onclick=()=>action(async()=>{state=await request('preview');$('message').textContent='Official quote signature verified. No deposit address generated and no funds moved.';});
$('issue').onclick=()=>action(async()=>{state=await request('issue',{approval:'NEAR_TO_ARBITRUM_USDC_MAX_5_USD'});$('message').textContent='Signed deposit instruction saved. No funds moved. This console will not create a second payment.';});
$('prepare').onclick=()=>action(async()=>{state=await request('prepare');$('message').textContent='Mainnet balance, token storage and maximum gas checked. Review the exact actions below.';});
$('sign').onclick=()=>action(async()=>{
  const wallet=provider();if(!wallet||wallet.getAccountId()!==state.policy.signer)throw Error('Approved wallet account is not connected.');
  const {transaction}=await request('begin',{account:wallet.getAccountId()});
  $('message').textContent='Waiting for your wallet signature. An interruption will not retry this payment.';
  const signedTransaction=await wallet.signTransaction({receiverId:transaction.receiverId,actions:transaction.actions});
  // Do not assume signTransaction is sign-only. Current OKX integration is
  // disabled because it can broadcast before returning these bytes.
  state=await request('broadcast',{signedTransaction});
  $('message').textContent='Transaction submitted once. Verify final execution and destination delivery below.';
});
$('reconcile').onclick=()=>action(async()=>{
  state=await request('reconcile');
  $('message').textContent=state.journal?.state==='VERIFIED'?'Source deposit and finalized Arbitrum delivery verified.':`Relay: ${state.journal?.relayState??'pending'}. Funds are not redeposited. Check again after finality.`;
});
$('observe').onclick=()=>action(async()=>{
  state=await request('observe');
  const observation=state.journal.observation,amount=BigInt(observation.sourceBalanceYocto);
  const near=`${amount/10n**24n}.${String(amount%10n**24n).padStart(24,'0').slice(0,6)}`;
  $('message').textContent=`Read-only check: ${observation.relayStatus}. Finalized source balance: ${near} NEAR. Payment is not verified. Signing is locked pending wallet review.`;
});
try{
  const response=await fetch('/api/session');if(!response.ok)throw Error('Local payment service unavailable');
  const session=await response.json();csrf=session.csrf;state=session;
  if(provider()?.isSignedIn())account=provider().getAccountId()||'';
  provider()?.on('accountChanged',()=>{account='';$('message').textContent='Wallet changed. Reconnect the approved account.';render();});
  render();$('message').textContent=state.journal&&!state.walletExecution.signingEnabled?
    'Wallet compatibility review required. Do not sign again. Use Check saved order to inspect the existing payment without sending funds.':
    state.journal?'Saved payment restored. Reconcile it before any further payment.':'Ready. Start with a signed preview; signing is always a separate wallet action.';
}catch(error){$('message').textContent=error.message;}

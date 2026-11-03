import {hash} from './protocol.mjs';
export function nativePaymentPreview({source,receiver,amountYocto,maximumFeeYocto,minimumUsdcUnits,recipient,deadline}){
  if(!/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(source??'')||source.endsWith('.testnet')||
    !/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(receiver??'')||receiver.endsWith('.testnet')||
    source===receiver||source.length>64||receiver.length>64||
    !/^[1-9]\d{0,29}$/.test(amountYocto??'')||!/^[1-9]\d{0,29}$/.test(maximumFeeYocto??'')||
    !/^[1-9]\d{0,29}$/.test(minimumUsdcUnits??'')||!/^0x[a-f0-9]{40}$/.test(recipient??'')||
    !Number.isFinite(Date.parse(deadline)))throw Error('INVALID_NATIVE_PAYMENT_PREVIEW');
  const units=(s,decimals)=>{
    const n=BigInt(s),base=10n**BigInt(decimals),fraction=String(n%base).padStart(decimals,'0').replace(/0+$/,'');
    return String(n/base)+(fraction?'.'+fraction:'');
  };
  const p={network:'NEAR MAINNET',operation:'NATIVE_TRANSFER',source,receiver,
    amount:units(amountYocto,24)+' NEAR',maximumSourceFee:units(maximumFeeYocto,24)+' NEAR',
    minimumReceipt:units(minimumUsdcUnits,6)+' native USDC',destinationNetwork:'Arbitrum One',recipient,deadline,
    accessKeysRequested:false,contractCalls:0,automaticWalletHandoff:false,
    instruction:'Use the wallet’s native Send screen. Verify the full receiver and amount there; cancel any unknown or unparsed transaction. Paste only the resulting transaction hash.'};
  return {...p,previewHash:hash(p)};
}

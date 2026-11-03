// Cloudflare Access is an optional identity provider, not a trusted header.
// Every JWT is verified against the pinned issuer's keys and application AUD.
const cache=new Map();
const decode=s=>JSON.parse(Buffer.from(s,'base64url').toString('utf8'));
export async function verifyAccessIdentity(jwt,{issuer,audience},fetcher=fetch,now=Date.now()){
  const url=new URL(issuer??'https://unconfigured.invalid');
  if(url.protocol!=='https:'||!/^[-a-z0-9]+\.cloudflareaccess\.com$/.test(url.hostname)||
    url.pathname!=='/'||url.search||url.username||url.password||!audience)throw Error('ORGANIZATION_LOGIN_NOT_CONFIGURED');
  if(typeof jwt!=='string'||jwt.length>16000||jwt.split('.').length!==3)throw Error('SIGNED_ACCESS_IDENTITY_REQUIRED');
  const [head,payload,signature]=jwt.split('.'),h=decode(head),p=decode(payload);
  if(h.alg!=='RS256'||typeof h.kid!=='string'||h.jku||h.jwk||h.x5u||p.iss!==url.origin||
    !(Array.isArray(p.aud)?p.aud:[p.aud]).includes(audience)||
    !Number.isSafeInteger(p.exp)||p.exp*1000<=now||!Number.isSafeInteger(p.iat)||p.iat*1000>now+30000||
    (p.nbf!==undefined&&(!Number.isSafeInteger(p.nbf)||p.nbf*1000>now+30000))||
    typeof p.sub!=='string'||!p.sub||p.sub.length>256||typeof p.email!=='string'||
    !/^[^@\s]{1,100}@[^@\s.]+(?:\.[^@\s.]+)+$/.test(p.email)||p.email.length>254)throw Error('INVALID_ACCESS_CLAIMS');
  let entry=cache.get(url.origin);
  if(!entry||entry.until<now||!entry.keys.some(k=>k.kid===h.kid)){
    const response=await fetcher(url.origin+'/cdn-cgi/access/certs',{redirect:'error',signal:AbortSignal.timeout(10000)});
    const text=await response.text();
    if(!response.ok||text.length>100000)throw Error('IDENTITY_KEYS_UNAVAILABLE');
    const keys=JSON.parse(text).keys;
    if(!Array.isArray(keys)||keys.length>20)throw Error('INVALID_IDENTITY_KEYS');
    entry={keys,until:now+300000};cache.set(url.origin,entry);
  }
  const jwk=entry.keys.find(k=>k.kid===h.kid&&k.kty==='RSA');
  if(!jwk)throw Error('UNKNOWN_IDENTITY_KEY');
  const key=await crypto.subtle.importKey('jwk',jwk,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
  if(!await crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,Buffer.from(signature,'base64url'),Buffer.from(head+'.'+payload)))
    throw Error('INVALID_IDENTITY_SIGNATURE');
  return {issuer:p.iss,subject:p.sub,email:p.email.toLowerCase(),expiresAt:p.exp*1000};
}

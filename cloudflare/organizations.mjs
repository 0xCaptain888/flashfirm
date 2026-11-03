import {verifyAccessIdentity} from '../src/access-identity.mjs';
import {hash} from '../src/protocol.mjs';
const q=(db,sql,...args)=>db.prepare(sql).bind(...args);
const token=()=>Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
export async function organizationSession(env,jwt,input,now=Date.now()){
  const who=await verifyAccessIdentity(jwt,{issuer:env.ACCESS_ISSUER,audience:env.ACCESS_AUDIENCE});
  const principal=hash({issuer:who.issuer,subject:who.subject}),db=env.DB;
  let org=input.organization;
  if(input.invite){
    const invite=await q(db,'SELECT * FROM organization_invites WHERE hash=? AND used=0 AND expires>?',hash(input.invite),now).first();
    if(!invite||invite.email!==who.email)throw Error('INVITE_INVALID_OR_WRONG_VERIFIED_EMAIL');
    await db.batch([
      q(db,'UPDATE organization_invites SET used=1 WHERE hash=? AND used=0',hash(input.invite)),
      q(db,'INSERT OR IGNORE INTO organization_members VALUES(?,?,?,?,1)',invite.organization,principal,who.email,invite.role)
    ]);
    org=invite.organization;
  }
  // Each authenticated principal gets at most one automatic personal org.
  // Joining another team always requires a fresh email-bound invitation.
  org??=principal;
  if(org===principal)await db.batch([
    q(db,'INSERT OR IGNORE INTO organizations VALUES(?,?,?)',org,'My organization',now),
    q(db,'INSERT OR IGNORE INTO organization_members VALUES(?,?,?,?,1)',org,principal,who.email,'ADMIN')
  ]);
  const member=await q(db,'SELECT * FROM organization_members WHERE organization=? AND principal=? AND active=1',org,principal).first();
  if(!member)throw Error('ORGANIZATION_MEMBERSHIP_REQUIRED');
  const bearer=token(),expires=Math.min(now+3600000,who.expiresAt);
  // Token hashing must match the legacy raw UTF-8 SHA-256 authentication path.
  const rawHash=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(bearer))).toString('hex');
  await db.batch([q(db,'INSERT INTO tokens(hash,owner,expires) VALUES(?,?,?)',rawHash,'org:'+org,expires),
    q(db,'INSERT INTO organization_sessions VALUES(?,?,?)',rawHash,org,principal)]);
  return {token:bearer,expiresAt:expires,organization:org,role:member.role,email:who.email};
}
export async function cloudPrincipal(db,tokenHash,now=Date.now()){
  const identity=await q(db,'SELECT owner FROM tokens WHERE hash=? AND revoked=0 AND expires>?',tokenHash,now).first();
  if(!identity)return null;
  if(!identity.owner.startsWith('org:'))return {...identity,role:'ADMIN',legacy:true};
  const membership=await q(db,`SELECT m.* FROM organization_sessions s JOIN organization_members m
    ON s.organization=m.organization AND s.principal=m.principal WHERE s.hash=? AND m.active=1`,tokenHash).first();
  if(!membership||identity.owner!=='org:'+membership.organization)return null;
  return {...identity,...membership};
}
export async function organizationOperation(env,identity,operation,input,now=Date.now()){
  if(identity.legacy)throw Error('ORGANIZATION_LOGIN_REQUIRED');
  const db=env.DB,org=identity.organization;
  if(operation==='members')return {organization:org,role:identity.role,members:(await q(db,'SELECT principal,email,role,active FROM organization_members WHERE organization=?',org).all()).results};
  if(identity.role!=='ADMIN')throw Error('ORGANIZATION_ADMIN_REQUIRED');
  if(operation==='invite'){
    if(!['EDITOR','VIEWER'].includes(input.role)||typeof input.email!=='string'||!/^[^@\s]{1,100}@[^@\s.]+(?:\.[^@\s.]+)+$/.test(input.email))throw Error('INVALID_INVITE');
    const invite=token(),expires=now+86400000;
    await q(db,'INSERT INTO organization_invites VALUES(?,?,?,?,?,0)',hash(invite),org,input.email.toLowerCase(),input.role,expires).run();
    return {invite,expiresAt:expires,emailSent:false,delivery:'Share privately with the intended person; no automatic message sent.'};
  }
  if(operation==='revoke'){
    if(input.principal===identity.principal)throw Error('CANNOT_REMOVE_LAST_ACTIVE_ADMIN');
    await q(db,'UPDATE organization_members SET active=0 WHERE organization=? AND principal=?',org,input.principal).run();
    return {revoked:true,sessionsRejectedImmediately:true};
  }
  throw Error('UNKNOWN_ORGANIZATION_OPERATION');
}

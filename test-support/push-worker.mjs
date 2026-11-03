// Local compatibility check only. Never deployed with the production worker.
import {createECDH,randomBytes} from 'node:crypto';
import webpush from 'web-push';
export default {async fetch(){
  const curve=createECDH('prime256v1');curve.generateKeys();
  const vapid=webpush.generateVAPIDKeys();
  const request=webpush.generateRequestDetails({
    endpoint:'https://fcm.googleapis.com/fcm/send/local-synthetic-no-send',
    keys:{p256dh:curve.getPublicKey().toString('base64url'),auth:randomBytes(16).toString('base64url')}
  },JSON.stringify({kind:'SYNTHETIC_RUNTIME_CHECK'}),{TTL:300,contentEncoding:'aes128gcm',
    vapidDetails:{subject:'https://github.com/0xCaptain888/flashfirm',...vapid}});
  return Response.json({encrypted:request.body.length>40,
    vapidSigned:request.headers.Authorization?.startsWith('vapid ')===true,networkCalls:0});
}};

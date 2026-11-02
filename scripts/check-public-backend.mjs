// Read-only deployment smoke check; never uses a token or queues model calls.
const origin=new URL(process.argv[2]);
if(origin.protocol!=='https:'||origin.origin!==process.argv[2]||origin.username||origin.password)throw Error('Exact HTTPS origin required');
const checks=[];
for(const [path,status,headers] of [['/healthz',200,{}],['/api/workspaces',401,{}],['/api/tasks',403,{}],['/healthz',403,{Origin:'https://untrusted-origin.invalid'}]]) {
  const response=await fetch(origin.origin+path,{redirect:'error',signal:AbortSignal.timeout(15000),headers});
  if(response.status!==status)throw Error(`Deployment check failed: ${path}, expected ${status}, received ${response.status}`);
  if(path==='/healthz'&&status===200){const body=await response.json();if(body.status!=='READY')throw Error('Backend not ready');}
  else await response.body?.cancel();
  checks.push({path,status});
}
console.log(JSON.stringify({status:'PUBLIC_BACKEND_SMOKE_PASSED',origin:origin.origin,checks,paidCalls:0,scope:'HTTPS health and access boundaries only; not an uptime guarantee or penetration test'}));

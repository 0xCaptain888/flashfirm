export function serverPolicy(env = process.env) {
  const port = Number(env.PORT || 43180), host = env.FLASHFIRM_BIND || '127.0.0.1';
  if (!Number.isInteger(port) || port < 1 || port > 65535 || !['127.0.0.1', '0.0.0.0'].includes(host)) throw Error('INVALID_LISTENER');
  if (!env.FLASHFIRM_PUBLIC_ORIGIN) {
    if (host !== '127.0.0.1') throw Error('PUBLIC_ORIGIN_REQUIRED');
    return { port, host, public: false, origins: [`http://127.0.0.1:${port}`, `http://localhost:${port}`], hosts: [`127.0.0.1:${port}`, `localhost:${port}`] };
  }
  const origin = new URL(env.FLASHFIRM_PUBLIC_ORIGIN);
  if (origin.protocol !== 'https:' || origin.origin !== env.FLASHFIRM_PUBLIC_ORIGIN || origin.username || origin.password || origin.hostname === 'localhost') throw Error('EXACT_HTTPS_ORIGIN_REQUIRED');
  if (!env.FLASHFIRM_RUNTIME || !env.FLASHFIRM_RUNTIME.startsWith('/')) throw Error('PERSISTENT_RUNTIME_REQUIRED');
  return { port, host, public: true, origins: [origin.origin], hosts: [origin.host] };
}

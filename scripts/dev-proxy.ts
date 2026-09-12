/**
 * Injects the dev bearer token so MCP hosts that cannot send credentials
 * (e.g. ext-apps basic-host) can talk to a local Custodian server.
 *
 *   npx tsx scripts/dev-proxy.ts            # :3099 → http://localhost:3001
 */
import http from 'node:http';

const target = new URL(process.env.TARGET ?? 'http://localhost:3001');
const token = process.env.DEV_BEARER_TOKEN ?? 'dev-token';
const port = Number(process.env.PROXY_PORT ?? 3099);

http
  .createServer((req, res) => {
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers[k] = v;
    headers.authorization = `Bearer ${token}`;
    headers.host = target.host;
    delete headers.origin;
    const upstream = http.request({ hostname: target.hostname, port: target.port, path: req.url, method: req.method, headers }, (up) => {
      res.writeHead(up.statusCode ?? 502, { ...up.headers, 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-expose-headers': '*' });
      up.pipe(res);
    });
    upstream.on('error', (err) => {
      res.writeHead(502).end(String(err));
    });
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,DELETE,OPTIONS' }).end();
      upstream.destroy();
      return;
    }
    req.pipe(upstream);
  })
  .listen(port, () => console.log(`dev-proxy http://localhost:${port} → ${target.origin} (adds bearer)`));

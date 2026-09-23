/**
 * OAuth 2.1 conformance check against a running Custodian server, exercising
 * exactly the flows Alexa+ account linking performs.
 *
 *   MCP_URL=https://host/mcp OAUTH_CLIENT_SECRET=… \
 *   HOUSEHOLD="Test home" PASSPHRASE=secret123 npm run oauth:conformance
 *
 * The redirect URI used must be in OAUTH_REDIRECT_URIS on the server.
 */
import { createHash, randomBytes } from 'node:crypto';

const mcpUrl = process.env.MCP_URL ?? 'http://localhost:3001/mcp';
const origin = new URL(mcpUrl).origin;
const clientId = process.env.OAUTH_CLIENT_ID ?? 'alexa';
const clientSecret = process.env.OAUTH_CLIENT_SECRET ?? 'change-me';
const redirectUri =
  process.env.REDIRECT_URI ?? 'https://alexa.amazon.com/api/skill/link/XXXXXXXXXXXXX';
const household = process.env.HOUSEHOLD ?? `conformance-${Date.now()}`;
const passphrase = process.env.PASSPHRASE ?? 'conformance-pass';

let failures = 0;
function check(name: string, cond: unknown, detail?: unknown) {
  console.log(`${cond ? '✓' : '✗'} ${name}${cond ? '' : `  ${JSON.stringify(detail)}`}`);
  if (!cond) failures++;
}
const basic = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`;
const form = (o: Record<string, string>) => new URLSearchParams(o).toString();
const post = (path: string, body: string, headers: Record<string, string> = {}) =>
  fetch(`${origin}${path}`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
    body,
  });
const rpc = (token: string, body: unknown) =>
  fetch(mcpUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });

async function main() {
  console.log(`→ ${origin}`);
  const as = (await fetch(`${origin}/.well-known/oauth-authorization-server`).then((r) =>
    r.json(),
  )) as Record<string, unknown>;
  check('AS metadata: S256', (as.code_challenge_methods_supported as string[])?.includes('S256'));
  check(
    'AS metadata: client_credentials',
    (as.grant_types_supported as string[])?.includes('client_credentials'),
    as.grant_types_supported,
  );
  const prm = (await fetch(`${origin}/.well-known/oauth-protected-resource`).then((r) =>
    r.json(),
  )) as Record<string, unknown>;
  check('PRM: resource is the MCP URL', prm.resource === mcpUrl, prm);
  check('PRM: bearer in header', (prm.bearer_methods_supported as string[])?.includes('header'));

  // Tier 1: service token
  const svc = await post(
    '/token',
    form({ grant_type: 'client_credentials', scope: 'mcp:service', resource: mcpUrl }),
    { authorization: basic },
  );
  const svcTok = (await svc.json()) as Record<string, unknown>;
  check(
    'client_credentials issues a token',
    svc.status === 200 && typeof svcTok.access_token === 'string',
    svcTok,
  );
  check(
    'client_credentials: no refresh token, ≤ 3600 s',
    !('refresh_token' in svcTok) && Number(svcTok.expires_in) <= 3600,
    svcTok,
  );
  const list = await rpc(String(svcTok.access_token), {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/list',
    params: {},
  });
  check('service token can list tools', list.status === 200);
  const call = await rpc(String(svcTok.access_token), {
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: { name: 'household_briefing', arguments: {} },
  });
  check('service token cannot call tools (403 insufficient_scope)', call.status === 403);

  const bad = await post('/token', form({ grant_type: 'client_credentials' }), {
    authorization: `Basic ${Buffer.from(`${clientId}:wrong`).toString('base64')}`,
  });
  check('wrong client secret → 401 invalid_client', bad.status === 401);

  // Tier 2: authorization code + PKCE
  const verifier = randomBytes(48).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const state = randomBytes(8).toString('hex');
  const authz = new URL(`${origin}/authorize`);
  Object.entries({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'mcp:tools mcp:resources',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    resource: mcpUrl,
  }).forEach(([k, v]) => authz.searchParams.set(k, v));
  const page = await fetch(authz);
  const html = await page.text();
  const requestId = html.match(/name="request_id" value="([^"]+)"/)?.[1];
  check('GET /authorize renders the login page', page.status === 200 && Boolean(requestId));
  const login = await post(
    '/authorize',
    form({ request_id: requestId ?? '', household, passphrase }),
  );
  const location = login.headers.get('location') ?? '';
  const code = new URL(location || 'http://x/').searchParams.get('code');
  check(
    'POST /authorize redirects with code + state',
    login.status === 302 &&
      location.startsWith(redirectUri) &&
      Boolean(code) &&
      location.includes(`state=${state}`),
    location,
  );

  const wrong = await post(
    '/token',
    form({
      grant_type: 'authorization_code',
      code: code ?? '',
      code_verifier: 'x'.repeat(50),
      redirect_uri: redirectUri,
      resource: mcpUrl,
    }),
    { authorization: basic },
  );
  check('wrong PKCE verifier → 400 invalid_grant', wrong.status === 400);
  // The code is single-use even after a failed attempt, so obtain a fresh one.
  const page2 = await fetch(authz);
  const requestId2 = (await page2.text()).match(/name="request_id" value="([^"]+)"/)?.[1] ?? '';
  const login2 = await post('/authorize', form({ request_id: requestId2, household, passphrase }));
  const code2 =
    new URL(login2.headers.get('location') ?? 'http://x/').searchParams.get('code') ?? '';
  const tok = await post(
    '/token',
    form({
      grant_type: 'authorization_code',
      code: code2,
      code_verifier: verifier,
      redirect_uri: redirectUri,
      resource: mcpUrl,
    }),
    { authorization: basic },
  );
  const user = (await tok.json()) as Record<string, unknown>;
  check(
    'code exchange issues access + refresh tokens',
    tok.status === 200 &&
      typeof user.access_token === 'string' &&
      typeof user.refresh_token === 'string',
    user,
  );

  const briefing = await rpc(String(user.access_token), {
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: { name: 'household_briefing', arguments: {} },
  });
  check('user token can call tools', briefing.status === 200);

  const refreshed = await post(
    '/token',
    form({ grant_type: 'refresh_token', refresh_token: String(user.refresh_token) }),
    { authorization: basic },
  );
  const r2 = (await refreshed.json()) as Record<string, unknown>;
  check(
    'refresh issues a new pair',
    refreshed.status === 200 &&
      typeof r2.refresh_token === 'string' &&
      r2.refresh_token !== user.refresh_token,
    r2,
  );
  const reused = await post(
    '/token',
    form({ grant_type: 'refresh_token', refresh_token: String(user.refresh_token) }),
    { authorization: basic },
  );
  check('old refresh token is revoked after rotation', reused.status === 400);

  const noauth = await fetch(mcpUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{"jsonrpc":"2.0","id":1,"method":"ping"}',
  });
  check(
    'unauthenticated → 401 JSON, no WWW-Authenticate',
    noauth.status === 401 && !noauth.headers.get('www-authenticate'),
  );

  console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

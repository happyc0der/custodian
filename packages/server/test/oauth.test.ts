import { createHash, randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startHarness, type Harness } from './harness.js';

const REDIRECT = 'https://alexa.amazon.com/api/skill/link/M3IHEJ1OZMSGZ3';
const REDIRECT_EU = 'https://layla.amazon.com/api/skill/link/M3IHEJ1OZMSGZ3';

describe('OAuth 2.1 authorization server (Alexa+ account linking shape)', () => {
  let h: Harness;
  let mcpUrl: string;
  const secret = 's3cret-value';
  const basic = `Basic ${Buffer.from(`alexa:${secret}`).toString('base64')}`;
  const form = (o: Record<string, string>) => new URLSearchParams(o).toString();

  const post = (path: string, body: string, headers: Record<string, string> = {}) =>
    fetch(`${h.baseUrl}${path}`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers }, body });

  beforeAll(async () => {
    h = await startHarness({ connect: false, config: { authMode: 'oauth', oauthClientId: 'alexa', oauthClientSecret: secret, oauthRedirectUris: [REDIRECT, REDIRECT_EU] } });
    // PUBLIC_URL must equal the address under test for issuer/audience/resource to line up.
    h.deps.config.publicUrl = h.baseUrl;
    mcpUrl = `${h.baseUrl}/mcp`;
  });
  afterAll(() => h.close());

  async function pkceLogin(opts: { household?: string; passphrase?: string; scope?: string; resource?: string; redirect?: string } = {}) {
    const verifier = randomBytes(48).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const state = randomBytes(8).toString('hex');
    const u = new URL(`${h.baseUrl}/authorize`);
    for (const [k, v] of Object.entries({
      client_id: 'alexa', redirect_uri: opts.redirect ?? REDIRECT, response_type: 'code', scope: opts.scope ?? 'mcp:tools mcp:resources', state,
      code_challenge: challenge, code_challenge_method: 'S256', resource: opts.resource ?? mcpUrl,
    })) u.searchParams.set(k, v);
    const page = await fetch(u, { redirect: 'manual' });
    const html = await page.text();
    const requestId = html.match(/name="request_id" value="([^"]+)"/)?.[1] ?? '';
    const login = await post('/authorize', form({ request_id: requestId, household: opts.household ?? 'The Rajput Home', passphrase: opts.passphrase ?? 'correct horse' }));
    const location = login.headers.get('location') ?? '';
    return { verifier, state, page, html, login, location, code: new URL(location || 'http://x/').searchParams.get('code') };
  }

  it('serves RFC 8414 / RFC 9728 discovery documents in the shape Alexa+ checks at deploy time', async () => {
    const as = await fetch(`${h.baseUrl}/.well-known/oauth-authorization-server`).then((r) => r.json());
    expect(as).toMatchObject({
      issuer: h.baseUrl,
      authorization_endpoint: `${h.baseUrl}/authorize`,
      token_endpoint: `${h.baseUrl}/token`,
      code_challenge_methods_supported: ['S256'],
      response_types_supported: ['code'],
    });
    expect(as.grant_types_supported).toEqual(expect.arrayContaining(['authorization_code', 'refresh_token', 'client_credentials']));
    expect(as.token_endpoint_auth_methods_supported).toContain('client_secret_basic');
    for (const p of ['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp']) {
      const prm = await fetch(`${h.baseUrl}${p}`).then((r) => r.json());
      expect(prm).toMatchObject({ resource: mcpUrl, authorization_servers: [h.baseUrl], bearer_methods_supported: ['header'] });
      expect(prm.scopes_supported).toEqual(expect.arrayContaining(['mcp:service', 'mcp:tools', 'mcp:resources']));
    }
    const jwks = await fetch(`${h.baseUrl}/.well-known/jwks.json`).then((r) => r.json());
    expect(jwks.keys[0]).toMatchObject({ kty: 'EC', crv: 'P-256', alg: 'ES256' });
  });

  it('serves the privacy and terms pages the add-on manifest links to', async () => {
    for (const p of ['/privacy', '/terms']) {
      const res = await fetch(`${h.baseUrl}${p}`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toMatch(/text\/html/);
    }
  });

  describe('tier 1: client_credentials', () => {
    it('issues a short-lived mcp:service token with no refresh token', async () => {
      const res = await post('/token', form({ grant_type: 'client_credentials', scope: 'mcp:service', resource: mcpUrl }), { authorization: basic });
      expect(res.status).toBe(200);
      expect(res.headers.get('cache-control')).toBe('no-store');
      const tok = await res.json();
      expect(tok).toMatchObject({ token_type: 'Bearer', scope: 'mcp:service' });
      expect(tok.expires_in).toBeLessThanOrEqual(3600);
      expect(tok.refresh_token).toBeUndefined();

      const list = await h.rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }, { Authorization: `Bearer ${tok.access_token}` });
      expect(list.status).toBe(200);
      const call = await h.rpc({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'household_briefing', arguments: {} } }, { Authorization: `Bearer ${tok.access_token}` });
      expect(call.status).toBe(403);
      expect(call.json).toMatchObject({ error: 'insufficient_scope' });
    });

    it('accepts client_secret_post and rejects wrong secrets or user scopes', async () => {
      const ok = await post('/token', form({ grant_type: 'client_credentials', client_id: 'alexa', client_secret: secret }));
      expect(ok.status).toBe(200);
      const bad = await post('/token', form({ grant_type: 'client_credentials', client_id: 'alexa', client_secret: 'nope' }));
      expect(bad.status).toBe(401);
      expect(await bad.json()).toMatchObject({ error: 'invalid_client' });
      const scope = await post('/token', form({ grant_type: 'client_credentials', scope: 'mcp:tools' }), { authorization: basic });
      expect(scope.status).toBe(400);
      expect(await scope.json()).toMatchObject({ error: 'invalid_scope' });
    });
  });

  describe('tier 2: authorization_code + PKCE', () => {
    it('rejects unregistered redirect URIs and missing PKCE before showing a page', async () => {
      const u = new URL(`${h.baseUrl}/authorize`);
      u.searchParams.set('client_id', 'alexa');
      u.searchParams.set('redirect_uri', 'https://evil.example/cb');
      u.searchParams.set('response_type', 'code');
      const res = await fetch(u, { redirect: 'manual' });
      expect(res.status).toBe(400);

      const u2 = new URL(`${h.baseUrl}/authorize`);
      for (const [k, v] of Object.entries({ client_id: 'alexa', redirect_uri: REDIRECT, response_type: 'code', state: 'xyz', code_challenge: 'abc', code_challenge_method: 'plain' })) u2.searchParams.set(k, v);
      const res2 = await fetch(u2, { redirect: 'manual' });
      expect(res2.status).toBe(302);
      const loc = new URL(res2.headers.get('location')!);
      expect(loc.origin + loc.pathname).toBe(REDIRECT);
      expect(loc.searchParams.get('error')).toBe('invalid_request');
      expect(loc.searchParams.get('state')).toBe('xyz');
    });

    it('rejects a wrong resource with invalid_target', async () => {
      const r = await pkceLogin({ resource: 'https://other.example/mcp' });
      expect(r.page.status).toBe(302);
      expect(new URL(r.page.headers.get('location')!).searchParams.get('error')).toBe('invalid_target');
    });

    it('creates the household on first login, then requires the same passphrase', async () => {
      const first = await pkceLogin();
      expect(first.page.status).toBe(200);
      expect(first.html).toMatch(/Alexa\+/);
      expect(first.login.status).toBe(302);
      expect(first.location.startsWith(REDIRECT)).toBe(true);
      expect(first.code).toBeTruthy();
      expect(new URL(first.location).searchParams.get('state')).toBe(first.state);
      expect(new URL(first.location).searchParams.get('iss')).toBe(h.baseUrl);
      const household = await h.deps.store.getHousehold('the-rajput-home');
      expect(household?.credential?.hash).toBeTruthy();

      const wrong = await pkceLogin({ passphrase: 'not it' });
      expect(wrong.login.status).toBe(400);
      expect(await wrong.login.text()).toMatch(/passphrase does not match/);
    });

    it('accepts any registered Alexa region redirect URI', async () => {
      const eu = await pkceLogin({ redirect: REDIRECT_EU });
      expect(eu.location.startsWith(REDIRECT_EU)).toBe(true);
    });

    it('exchanges the code only with the right verifier, once, and binds the token to the household', async () => {
      const r = await pkceLogin();
      const wrongVerifier = await post('/token', form({ grant_type: 'authorization_code', code: r.code!, code_verifier: 'x'.repeat(50), redirect_uri: REDIRECT, resource: mcpUrl }), { authorization: basic });
      expect(wrongVerifier.status).toBe(400);
      expect(await wrongVerifier.json()).toMatchObject({ error: 'invalid_grant' });
      // Single use: the same code is dead even with the right verifier now.
      const replay = await post('/token', form({ grant_type: 'authorization_code', code: r.code!, code_verifier: r.verifier, redirect_uri: REDIRECT, resource: mcpUrl }), { authorization: basic });
      expect(replay.status).toBe(400);

      const r2 = await pkceLogin();
      const ok = await post('/token', form({ grant_type: 'authorization_code', code: r2.code!, code_verifier: r2.verifier, redirect_uri: REDIRECT, resource: mcpUrl }), { authorization: basic });
      expect(ok.status).toBe(200);
      const tok = await ok.json();
      expect(tok).toMatchObject({ token_type: 'Bearer', expires_in: 3600, scope: 'mcp:tools mcp:resources' });
      expect(typeof tok.refresh_token).toBe('string');

      const auth = { Authorization: `Bearer ${tok.access_token}` };
      const add = await h.rpc({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'add_item', arguments: { name: 'Kidde smoke detector' } } }, auth);
      expect(add.status).toBe(200);
      const items = await h.deps.store.listItems('the-rajput-home');
      expect(items.map((i) => i.name)).toEqual(['Kidde smoke detector']);
      expect(await h.deps.store.listItems('dev')).toEqual([]);

      // Refresh rotates: new pair works, old refresh token is revoked.
      const refreshed = await post('/token', form({ grant_type: 'refresh_token', refresh_token: tok.refresh_token }), { authorization: basic });
      expect(refreshed.status).toBe(200);
      const tok2 = await refreshed.json();
      expect(tok2.refresh_token).not.toBe(tok.refresh_token);
      const reused = await post('/token', form({ grant_type: 'refresh_token', refresh_token: tok.refresh_token }), { authorization: basic });
      expect(reused.status).toBe(400);
      const broaden = await post('/token', form({ grant_type: 'refresh_token', refresh_token: tok2.refresh_token, scope: 'mcp:tools mcp:service' }), { authorization: basic });
      expect(await broaden.json()).toMatchObject({ error: 'invalid_scope' });
    });

    it('the dev bearer is rejected when AUTH_MODE=oauth', async () => {
      const res = await h.rpc({ jsonrpc: '2.0', id: 1, method: 'ping' }, { Authorization: `Bearer ${h.token}` });
      expect(res.status).toBe(401);
    });
  });
});

import { Router, type Request, type Response } from 'express';
import type { Household } from '@custodian/shared';
import type { Config } from '../config.js';
import type { Store } from '../store/types.js';
import { ALL_SCOPES, SCOPE_RESOURCES, SCOPE_SERVICE, SCOPE_TOOLS } from './bearer.js';
import { cryptoRandom, resourceUrl, signAccessToken, type SigningKeys } from './keys.js';
import { loginPage, messagePage } from './pages.js';
import { hashPassphrase, safeEqual, sha256b64url, verifyPkceS256 } from './pkce.js';

/**
 * A minimal, self-hosted OAuth 2.1 authorization server shaped to what Alexa+
 * account linking requires (see FRICTION_LOG.md #5):
 *
 *  - client_credentials  → service token, scope mcp:service, ≤ 1 h, no refresh token
 *  - authorization_code  → user token bound to a household; PKCE S256 mandatory;
 *                          `resource` (RFC 8707) checked on authorize + token
 *  - refresh_token       → rotating; the old token is revoked on use
 *  - one pre-registered confidential client; no dynamic registration
 *  - every Alexa region redirect URI accepted from an allowlist
 *
 * Discovery documents are served at /.well-known/oauth-authorization-server and
 * /.well-known/oauth-protected-resource (RFC 8414 / RFC 9728).
 */

const CODE_TTL_MS = 60_000;
const PENDING_TTL_MS = 10 * 60_000;
const ACCESS_TTL_S = 3600;
const SERVICE_TTL_S = 3600;
const REFRESH_TTL_MS = 180 * 86_400_000;
const USER_SCOPES = [SCOPE_TOOLS, SCOPE_RESOURCES];

interface PendingRequest {
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  resource: string;
  scope: string[];
  state?: string;
}
interface CodeGrant extends PendingRequest {
  household_id: string;
}
interface RefreshGrant {
  client_id: string;
  household_id: string;
  scope: string[];
  resource: string;
}

export interface OAuthDeps {
  config: Config;
  store: Store;
  keys: SigningKeys;
  now?: () => Date;
}

export function authorizationServerMetadata(config: Config) {
  const issuer = config.publicUrl;
  return {
    issuer,
    authorization_endpoint: `${issuer}/authorize`,
    token_endpoint: `${issuer}/token`,
    jwks_uri: `${issuer}/.well-known/jwks.json`,
    response_types_supported: ['code'],
    response_modes_supported: ['query'],
    grant_types_supported: ['authorization_code', 'refresh_token', 'client_credentials'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'],
    scopes_supported: ALL_SCOPES,
    service_documentation: `${issuer}/terms`,
  };
}

export function protectedResourceMetadata(config: Config) {
  return {
    resource: resourceUrl(config),
    authorization_servers: [config.publicUrl],
    scopes_supported: ALL_SCOPES,
    bearer_methods_supported: ['header'],
    resource_name: 'Custodian',
    resource_documentation: `${config.publicUrl}/privacy`,
  };
}

function oauthError(res: Response, status: number, error: string, description: string): void {
  res.status(status).set('cache-control', 'no-store').json({ error, error_description: description });
}

function redirectError(res: Response, redirectUri: string, error: string, description: string, state?: string): void {
  const u = new URL(redirectUri);
  u.searchParams.set('error', error);
  u.searchParams.set('error_description', description);
  if (state) u.searchParams.set('state', state);
  res.redirect(302, u.toString());
}

export function householdIdFromName(name: string): string {
  return name
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

export function createOAuthRouter(deps: OAuthDeps): Router {
  const { config, store, keys } = deps;
  const now = deps.now ?? (() => new Date());
  const router = Router();
  const clientName = 'Alexa+';

  const validRedirect = (uri: string) => config.oauthRedirectUris.includes(uri);
  const validResource = (r: string | undefined) => !r || r.replace(/\/+$/, '') === resourceUrl(config);

  router.get('/.well-known/oauth-authorization-server', (_req, res) => {
    res.set('cache-control', 'public, max-age=300').json(authorizationServerMetadata(config));
  });
  // RFC 9728: root document plus the path-suffixed form for the /mcp resource.
  for (const p of ['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp']) {
    router.get(p, (_req, res) => res.set('cache-control', 'public, max-age=300').json(protectedResourceMetadata(config)));
  }
  router.get('/.well-known/jwks.json', (_req, res) => res.set('cache-control', 'public, max-age=300').json(keys.jwks));

  /* ---------------- authorize ---------------- */

  router.get('/authorize', async (req, res) => {
    const q = req.query as Record<string, string | undefined>;
    const { client_id, redirect_uri, response_type, code_challenge, code_challenge_method, state, resource } = q;
    if (!client_id || client_id !== config.oauthClientId) return oauthError(res, 400, 'invalid_client', 'Unknown client_id');
    if (!redirect_uri || !validRedirect(redirect_uri)) return oauthError(res, 400, 'invalid_request', 'redirect_uri is not registered for this client');
    if (response_type !== 'code') return redirectError(res, redirect_uri, 'unsupported_response_type', 'Only response_type=code is supported', state);
    if (!code_challenge || (code_challenge_method ?? 'plain') !== 'S256') return redirectError(res, redirect_uri, 'invalid_request', 'PKCE with code_challenge_method=S256 is required', state);
    if (!validResource(resource)) return redirectError(res, redirect_uri, 'invalid_target', `resource must be ${resourceUrl(config)}`, state);
    const scope = (q.scope ?? USER_SCOPES.join(' ')).split(/\s+/).filter(Boolean);
    if (scope.some((s) => !USER_SCOPES.includes(s))) return redirectError(res, redirect_uri, 'invalid_scope', `Allowed scopes: ${USER_SCOPES.join(' ')}`, state);

    const pending: PendingRequest = { client_id, redirect_uri, code_challenge, resource: resource ?? resourceUrl(config), scope, state };
    const requestId = cryptoRandom(24);
    await store.putAuth(`pending:${requestId}`, JSON.stringify(pending), now().getTime() + PENDING_TTL_MS);
    res.set('cache-control', 'no-store').type('html').send(loginPage({ requestId, clientName, scopes: scope }));
  });

  router.post('/authorize', async (req, res) => {
    const body = (req.body ?? {}) as Record<string, string | undefined>;
    const requestId = body.request_id ?? '';
    const raw = await store.getAuth(`pending:${requestId}`);
    if (!raw) return res.status(400).type('html').send(messagePage('Link expired', 'This sign-in link has expired. Please start again from the Alexa app.'));
    const pending = JSON.parse(raw) as PendingRequest;
    const householdName = (body.household ?? '').trim();
    const passphrase = body.passphrase ?? '';
    const render = (error: string) => res.status(400).type('html').send(loginPage({ requestId, clientName, scopes: pending.scope, error, household: householdName }));
    if (householdName.length < 2 || passphrase.length < 6) return render('Please enter a household name and a passphrase of at least 6 characters.');

    const householdId = householdIdFromName(householdName);
    if (!householdId) return render('Please choose a household name with some letters or numbers in it.');
    let household = await store.getHousehold(householdId);
    if (household?.credential) {
      if (!safeEqual(hashPassphrase(passphrase, household.credential.salt), household.credential.hash)) return render('That passphrase does not match this household.');
    } else {
      const salt = cryptoRandom(16);
      household = {
        id: householdId,
        name: householdName,
        created_at: household?.created_at ?? now().toISOString(),
        last_briefed_at: household?.last_briefed_at,
        credential: { salt, hash: hashPassphrase(passphrase, salt) },
      } satisfies Household;
      await store.putHousehold(household);
    }

    await store.deleteAuth(`pending:${requestId}`);
    const code = cryptoRandom(32);
    const grant: CodeGrant = { ...pending, household_id: household.id };
    await store.putAuth(`code:${sha256b64url(code)}`, JSON.stringify(grant), now().getTime() + CODE_TTL_MS);
    const u = new URL(pending.redirect_uri);
    u.searchParams.set('code', code);
    if (pending.state) u.searchParams.set('state', pending.state);
    u.searchParams.set('iss', config.publicUrl);
    res.set('cache-control', 'no-store').redirect(302, u.toString());
  });

  /* ---------------- token ---------------- */

  router.post('/token', async (req, res) => {
    res.set('cache-control', 'no-store').set('pragma', 'no-cache');
    const body = (req.body ?? {}) as Record<string, string | undefined>;
    const creds = clientCredentials(req, body);
    if (!creds || creds.id !== config.oauthClientId || !safeEqual(creds.secret, config.oauthClientSecret)) {
      res.set('www-authenticate', 'Basic realm="custodian"');
      return oauthError(res, 401, 'invalid_client', 'Client authentication failed');
    }
    const grantType = body.grant_type;

    if (grantType === 'client_credentials') {
      const requested = (body.scope ?? SCOPE_SERVICE).split(/\s+/).filter(Boolean);
      if (requested.some((s) => s !== SCOPE_SERVICE)) return oauthError(res, 400, 'invalid_scope', `client_credentials may only request ${SCOPE_SERVICE}`);
      if (!validResource(body.resource)) return oauthError(res, 400, 'invalid_target', `resource must be ${resourceUrl(config)}`);
      const access_token = await signAccessToken(keys, config, { sub: `client:${creds.id}`, client_id: creds.id, scope: SCOPE_SERVICE }, SERVICE_TTL_S);
      return res.json({ access_token, token_type: 'Bearer', expires_in: SERVICE_TTL_S, scope: SCOPE_SERVICE });
    }

    if (grantType === 'authorization_code') {
      const { code, code_verifier, redirect_uri, resource } = body;
      if (!code || !code_verifier) return oauthError(res, 400, 'invalid_request', 'code and code_verifier are required');
      const key = `code:${sha256b64url(code)}`;
      const raw = await store.getAuth(key);
      await store.deleteAuth(key); // single use, even on failure
      if (!raw) return oauthError(res, 400, 'invalid_grant', 'Authorization code is invalid or expired');
      const grant = JSON.parse(raw) as CodeGrant;
      if (grant.client_id !== creds.id) return oauthError(res, 400, 'invalid_grant', 'Code was issued to a different client');
      if (redirect_uri && redirect_uri !== grant.redirect_uri) return oauthError(res, 400, 'invalid_grant', 'redirect_uri does not match the authorization request');
      if (!verifyPkceS256(code_verifier, grant.code_challenge)) return oauthError(res, 400, 'invalid_grant', 'PKCE verification failed');
      if (resource && resource.replace(/\/+$/, '') !== grant.resource) return oauthError(res, 400, 'invalid_target', 'resource does not match the authorization request');
      return res.json(await issueUserTokens(grant.household_id, creds.id, grant.scope, grant.resource));
    }

    if (grantType === 'refresh_token') {
      const { refresh_token, scope } = body;
      if (!refresh_token) return oauthError(res, 400, 'invalid_request', 'refresh_token is required');
      const key = `refresh:${sha256b64url(refresh_token)}`;
      const raw = await store.getAuth(key);
      if (!raw) return oauthError(res, 400, 'invalid_grant', 'Refresh token is invalid, expired or already used');
      await store.deleteAuth(key); // rotation: the presented token is dead from here on
      const grant = JSON.parse(raw) as RefreshGrant;
      if (grant.client_id !== creds.id) return oauthError(res, 400, 'invalid_grant', 'Refresh token was issued to a different client');
      const requested = scope ? scope.split(/\s+/).filter(Boolean) : grant.scope;
      if (requested.some((s) => !grant.scope.includes(s))) return oauthError(res, 400, 'invalid_scope', 'Cannot broaden scope on refresh');
      return res.json(await issueUserTokens(grant.household_id, creds.id, requested, grant.resource));
    }

    return oauthError(res, 400, 'unsupported_grant_type', 'Supported: authorization_code, refresh_token, client_credentials');
  });

  async function issueUserTokens(householdId: string, clientId: string, scope: string[], resource: string) {
    const access_token = await signAccessToken(keys, config, { sub: householdId, client_id: clientId, scope: scope.join(' '), household_id: householdId }, ACCESS_TTL_S);
    const refresh_token = cryptoRandom(32);
    const grant: RefreshGrant = { client_id: clientId, household_id: householdId, scope, resource };
    await store.putAuth(`refresh:${sha256b64url(refresh_token)}`, JSON.stringify(grant), now().getTime() + REFRESH_TTL_MS);
    return { access_token, token_type: 'Bearer', expires_in: ACCESS_TTL_S, refresh_token, scope: scope.join(' ') };
  }

  return router;
}

function clientCredentials(req: Request, body: Record<string, string | undefined>): { id: string; secret: string } | undefined {
  const header = req.headers.authorization;
  if (header?.toLowerCase().startsWith('basic ')) {
    const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
    const idx = decoded.indexOf(':');
    if (idx > 0) return { id: decodeURIComponent(decoded.slice(0, idx)), secret: decodeURIComponent(decoded.slice(idx + 1)) };
  }
  if (body.client_id && body.client_secret) return { id: body.client_id, secret: body.client_secret };
  return undefined;
}

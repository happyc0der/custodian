import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { AuthInfo } from '@modelcontextprotocol/server';
import type { Config } from '../config.js';

export const SCOPE_SERVICE = 'mcp:service';
export const SCOPE_TOOLS = 'mcp:tools';
export const SCOPE_RESOURCES = 'mcp:resources';
export const ALL_SCOPES = [SCOPE_SERVICE, SCOPE_TOOLS, SCOPE_RESOURCES];

/** Verifies a bearer token and returns the caller's AuthInfo, or throws. */
export interface TokenVerifier {
  verify(token: string): Promise<AuthInfo>;
}

/**
 * `AUTH_MODE=dev`: a single static token grants every scope for a fixed
 * household. Used by the Local Inspector, Claude Desktop, basic-host and the
 * smoke test. Never enable in production.
 */
export function devVerifier(config: Config): TokenVerifier {
  return {
    async verify(token) {
      if (token !== config.devBearerToken) throw new Error('invalid_token');
      return { token, clientId: 'dev', scopes: ALL_SCOPES, extra: { householdId: 'dev' } };
    },
  };
}

/** Which scope a JSON-RPC method needs. Anything unlisted only needs a valid token. */
function requiredScope(method: string): string | undefined {
  if (method === 'tools/call') return SCOPE_TOOLS;
  if (method === 'resources/read' || method === 'resources/subscribe') return SCOPE_RESOURCES;
  return undefined;
}

function methodsIn(body: unknown): string[] {
  const msgs = Array.isArray(body) ? body : [body];
  return msgs
    .map((m) => (m && typeof m === 'object' && typeof (m as { method?: unknown }).method === 'string' ? (m as { method: string }).method : undefined))
    .filter((m): m is string => Boolean(m));
}

function unauthorized(res: Response, status: 401 | 403, error: string, description: string): void {
  // Alexa+ does not support WWW-Authenticate challenges; a JSON body is the contract.
  res.status(status).json({ error, error_description: description });
}

/**
 * Express middleware: requires `Authorization: Bearer …`, attaches `req.auth`
 * (read by the MCP transport as `ctx.http.authInfo`) and enforces the
 * Alexa+ two-tier scope model per JSON-RPC method.
 */
export function bearerAuth(verifier: TokenVerifier): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    const header = req.headers.authorization ?? '';
    const [scheme, token] = header.split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || !token) {
      return unauthorized(res, 401, 'invalid_request', 'Missing bearer token');
    }
    let auth: AuthInfo;
    try {
      auth = await verifier.verify(token);
    } catch (err) {
      return unauthorized(res, 401, 'invalid_token', err instanceof Error ? err.message : 'Token rejected');
    }
    if (auth.expiresAt && auth.expiresAt * 1000 < Date.now()) {
      return unauthorized(res, 401, 'invalid_token', 'Token expired');
    }
    for (const method of methodsIn(req.body)) {
      const need = requiredScope(method);
      if (need && !auth.scopes.includes(need)) {
        return unauthorized(res, 403, 'insufficient_scope', `${method} requires the ${need} scope`);
      }
    }
    req.auth = auth;
    next();
  };
}

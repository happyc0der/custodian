import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { bearerAuth } from '../auth/bearer.js';
import { runWithCaller } from '../auth/context.js';
import { privacyPage, termsPage } from '../auth/pages.js';
import type { AuthRuntime } from '../auth/runtime.js';
import type { ServerDeps } from '../mcp/deps.js';
import { createMcpServer } from '../mcp/server.js';
import { latencySnapshot } from '../telemetry.js';

export interface AppOptions {
  deps: ServerDeps;
  auth: AuthRuntime;
}

/** Spec 2025-11-25 §transport: reject browser-originated requests from unknown origins with 403. */
function originGuard(allowedOrigins: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const origin = req.headers.origin;
    if (!origin) return next();
    let host: string;
    try {
      host = new URL(origin).hostname;
    } catch {
      res.status(403).json({ error: 'invalid_origin' });
      return;
    }
    const ok =
      allowedOrigins.some((o) => o === host) ||
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '[::1]';
    if (!ok) {
      res.status(403).json({ error: 'invalid_origin' });
      return;
    }
    next();
  };
}

export function createApp({ deps, auth }: AppOptions): Express {
  const app = express();
  app.set('trust proxy', true);
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false, limit: '64kb' }));

  app.get('/healthz', (_req, res) => {
    res.json({
      ok: true,
      name: 'custodian',
      authMode: deps.config.authMode,
      store: deps.config.store,
    });
  });
  app.get('/metrics.json', (_req, res) => {
    res.json({ tools: latencySnapshot() });
  });
  app.get('/privacy', (_req, res) => res.type('html').send(privacyPage(deps.config.publicUrl)));
  app.get('/terms', (_req, res) => res.type('html').send(termsPage(deps.config.publicUrl)));
  app.use(auth.router);

  // One McpServer per request (legacy 2025-era stateless serving, which is what Alexa+ speaks),
  // and the modern 2026-07-28 envelope for newer hosts — both from the same factory.
  const handler = createMcpHandler(() => createMcpServer(deps), {
    legacy: 'stateless',
    onerror: (err) => console.error('[mcp]', err),
  });
  const node = toNodeHandler(handler, { onerror: (err) => console.error('[mcp:node]', err) });
  const publicHost = new URL(deps.config.publicUrl).hostname;

  app.all('/mcp', originGuard([publicHost]), bearerAuth(auth.verifier), (req, res) => {
    const auth = req.auth!;
    const caller = {
      clientId: auth.clientId,
      scopes: auth.scopes,
      householdId: typeof auth.extra?.householdId === 'string' ? auth.extra.householdId : undefined,
    };
    void runWithCaller(caller, () => node(req, res, req.body));
  });

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error('[http]', err);
    if (!res.headersSent) res.status(500).json({ error: 'internal_error' });
  });

  return app;
}

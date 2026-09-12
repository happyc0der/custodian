import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { loadConfig, type Config } from '../src/config.js';
import { createAuthRuntime, type AuthRuntime } from '../src/auth/runtime.js';
import { createApp } from '../src/http/app.js';
import type { Hooks, ServerDeps } from '../src/mcp/deps.js';
import { FileStore } from '../src/store/file.js';

export interface Harness {
  deps: ServerDeps;
  auth: AuthRuntime;
  baseUrl: string;
  token: string;
  client: Client;
  /** Raw JSON-RPC POST helper for protocol-level assertions. */
  rpc(body: unknown, headers?: Record<string, string>): Promise<{ status: number; json: unknown; headers: Headers }>;
  close(): Promise<void>;
}

export interface HarnessOptions {
  hooks?: Hooks;
  now?: () => Date;
  config?: Partial<Config>;
  connect?: boolean;
}

/** Boots the real Express app on an ephemeral port with an in-memory store and a connected MCP client. */
export async function startHarness(opts: HarnessOptions = {}): Promise<Harness> {
  const config = loadConfig({ authMode: 'dev', store: 'file', fileStorePath: ':memory:', devBearerToken: 'test-token', sweepOnBoot: false, ...opts.config });
  const store = new FileStore(':memory:');
  const deps: ServerDeps = { config, store, hooks: opts.hooks ?? {}, now: opts.now ?? (() => new Date()) };
  const auth = await createAuthRuntime(config, store, deps.now);
  const app = createApp({ deps, auth });
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = (server.address() as AddressInfo).port;
  const baseUrl = `http://127.0.0.1:${port}`;
  const token = config.devBearerToken;

  const client = new Client({ name: 'harness', version: '0.0.0' });
  if (opts.connect !== false) {
    const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    });
    await client.connect(transport);
  }

  return {
    deps,
    auth,
    baseUrl,
    token,
    client,
    async rpc(body, headers = {}) {
      const res = await fetch(`${baseUrl}/mcp`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          Authorization: `Bearer ${token}`,
          ...headers,
        },
        body: JSON.stringify(body),
      });
      const text = await res.text();
      let json: unknown = text;
      try {
        json = text.startsWith('event:') || text.startsWith('data:') ? parseSse(text) : JSON.parse(text);
      } catch {
        /* keep raw text */
      }
      return { status: res.status, json, headers: res.headers };
    },
    async close() {
      await client.close().catch(() => {});
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

function parseSse(text: string): unknown {
  const data = text
    .split('\n')
    .filter((l) => l.startsWith('data:'))
    .map((l) => l.slice(5).trim());
  return data.length === 1 ? JSON.parse(data[0]!) : data.map((d) => JSON.parse(d));
}

/** Convenience: call a tool and return its structuredContent + spoken text. */
export async function callTool<T = Record<string, unknown>>(
  client: Client,
  name: string,
  args: Record<string, unknown> = {},
): Promise<{ speech: string; data: T; isError: boolean; raw: Awaited<ReturnType<Client['callTool']>> }> {
  const raw = await client.callTool({ name, arguments: args });
  const first = raw.content?.[0];
  const speech = first && first.type === 'text' ? first.text : '';
  return { speech, data: (raw.structuredContent ?? {}) as T, isError: raw.isError === true, raw };
}

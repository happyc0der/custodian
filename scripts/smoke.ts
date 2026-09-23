/**
 * End-to-end smoke test against a running server (default http://localhost:3001).
 *
 *   npm run smoke                       # uses DEV_BEARER_TOKEN / dev-token
 *   MCP_URL=https://x.trycloudflare.com/mcp MCP_TOKEN=… npm run smoke
 *
 * Exercises what Alexa+ will do: legacy initialize, tools/list, then a voice-shaped
 * conversation through the tools, printing what would be spoken.
 */
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

const url = process.env.MCP_URL ?? 'http://localhost:3001/mcp';
const token = process.env.MCP_TOKEN ?? process.env.DEV_BEARER_TOKEN ?? 'dev-token';

async function rpc(body: unknown): Promise<unknown> {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${text}`);
  const data =
    text.startsWith('event:') || text.startsWith('data:')
      ? text
          .split('\n')
          .find((l) => l.startsWith('data:'))!
          .slice(5)
      : text;
  return JSON.parse(data);
}

function say(label: string, speech: string) {
  console.log(`\n🗣  ${label}\n   Alexa: "${speech}"`);
}

async function main() {
  console.log(`→ ${url}`);
  for (const v of ['2025-03-26', '2025-11-25']) {
    const r = (await rpc({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: v, capabilities: {}, clientInfo: { name: 'smoke', version: '0' } },
    })) as { result: { protocolVersion: string } };
    if (r.result.protocolVersion !== v)
      throw new Error(`expected ${v}, got ${r.result.protocolVersion}`);
    console.log(`✓ initialize @ ${v}`);
  }

  const client = new Client({ name: 'smoke', version: '0.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(url), {
      requestInit: { headers: { authorization: `Bearer ${token}` } },
    }),
  );
  const tools = await client.listTools();
  console.log(`✓ tools/list → ${tools.tools.map((t) => t.name).join(', ')}`);

  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const t0 = performance.now();
    const r = await client.callTool({ name, arguments: args });
    const ms = (performance.now() - t0).toFixed(0);
    const speech = r.content?.[0]?.type === 'text' ? r.content[0].text : '(no text)';
    say(`${name}(${JSON.stringify(args)})  [${ms} ms${r.isError ? ', error' : ''}]`, speech);
    return r;
  };

  await call('household_briefing');
  await call('add_item', { name: 'Joolz Aer2 car seat adapter', purchased_on: '2026-03-01' });
  await call('add_item', {
    name: '2019 Honda Odyssey',
    vehicle: { make: 'Honda', model: 'Odyssey', year: 2019 },
  });
  await call('add_item', { name: 'Kidde smoke detector', quantity: 3, purchased_on: '2026-01-01' });
  console.log('\n… waiting 6 s for the targeted recall sweeps (off the voice path) …');
  await new Promise((r) => setTimeout(r, 6000));
  await call('list_inventory');
  await call('check_recalls');
  await call('check_recalls', { item_name: 'car seat adapter' });
  await call('whats_due', { horizon_days: 365 });
  await call('household_briefing');

  const metrics = (await fetch(new URL('/metrics.json', url)).then((r) => r.json())) as {
    tools: Record<string, { p95: number }>;
  };
  console.log(
    '\nlatency p95 (ms):',
    Object.fromEntries(Object.entries(metrics.tools).map(([k, v]) => [k, v.p95])),
  );
  await client.close();
}

main().catch((err) => {
  console.error('✗ smoke failed:', err);
  process.exit(1);
});

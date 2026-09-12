import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startHarness, type Harness } from './harness.js';

/**
 * Wire-level guarantees the Alexa+ MCP client depends on: a legacy-era
 * `initialize` handshake (Alexa sends 2025-03-26), the 2025-11-25 revision the
 * hackathon requires, JSON bodies, and bearer enforcement without a
 * WWW-Authenticate challenge.
 */
describe('protocol surface', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startHarness({ connect: false });
  });
  afterAll(() => h.close());

  for (const version of ['2025-03-26', '2025-06-18', '2025-11-25']) {
    it(`negotiates initialize at ${version}`, async () => {
      const { status, json } = await h.rpc({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: version, capabilities: {}, clientInfo: { name: 'Alexa+ MCP Client', version: '1.0.0' } },
      });
      expect(status).toBe(200);
      const result = (json as { result: { protocolVersion: string; serverInfo: { name: string }; capabilities: Record<string, unknown> } }).result;
      expect(result.protocolVersion).toBe(version);
      expect(result.serverInfo.name).toBe('custodian');
      expect(result.capabilities).toHaveProperty('tools');
    });
  }

  it('rejects a missing bearer with a JSON 401 and no WWW-Authenticate header', async () => {
    const res = await fetch(`${h.baseUrl}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
    });
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toBeNull();
    expect(await res.json()).toMatchObject({ error: 'invalid_request' });
  });

  it('rejects a wrong bearer with invalid_token', async () => {
    const { status, json } = await h.rpc({ jsonrpc: '2.0', id: 1, method: 'ping' }, { Authorization: 'Bearer nope' });
    expect(status).toBe(401);
    expect(json).toMatchObject({ error: 'invalid_token' });
  });

  it('rejects unknown browser origins with 403', async () => {
    const { status } = await h.rpc({ jsonrpc: '2.0', id: 1, method: 'ping' }, { Origin: 'https://evil.example' });
    expect(status).toBe(403);
  });

  it('lists tools with icons, annotations and output schemas', async () => {
    const { json } = await h.rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
    const tools = (json as { result: { tools: Array<Record<string, unknown>> } }).result.tools;
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(expect.arrayContaining(['add_item', 'list_inventory', 'remove_item', 'household_briefing']));
    for (const t of tools) {
      expect(t.description, `${t.name} description`).toBeTruthy();
      expect(t.inputSchema).toBeTruthy();
      expect(t.outputSchema, `${t.name} outputSchema`).toBeTruthy();
      expect(Array.isArray(t.icons), `${t.name} icons`).toBe(true);
      expect(t.annotations, `${t.name} annotations`).toBeTruthy();
    }
  });
});

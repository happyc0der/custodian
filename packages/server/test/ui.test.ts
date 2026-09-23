import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import { startHarness, type Harness } from './harness.js';

describe('MCP Apps wiring', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startHarness({
      ui: { app: '<!doctype html><title>Custodian</title><div id="root"></div>' },
    });
  });
  afterAll(() => h.close());

  it('advertises the app view on screen-worthy tools only, with a content-addressed ui:// URI', async () => {
    const { tools } = await h.client.listTools();
    const withUi = tools.filter(
      (t) => (t._meta as { ui?: { resourceUri?: string } } | undefined)?.ui?.resourceUri,
    );
    expect(withUi.map((t) => t.name).sort()).toEqual([
      'check_recalls',
      'get_recall_details',
      'household_briefing',
      'list_inventory',
      'whats_due',
    ]);
    const uri = (withUi[0]!._meta as { ui: { resourceUri: string } }).ui.resourceUri;
    expect(uri).toMatch(/^ui:\/\/custodian\/app-[a-z0-9]+\.html$/);
    // Legacy key kept for older hosts by registerAppTool.
    expect((withUi[0]!._meta as Record<string, unknown>)['ui/resourceUri']).toBe(uri);
  });

  it('serves the view as an MCP App resource with a CSP allowing recall images', async () => {
    const { resources } = await h.client.listResources();
    const view = resources.find((r) => r.uri.startsWith('ui://custodian/app-'))!;
    expect(view.mimeType).toBe(RESOURCE_MIME_TYPE);
    expect(
      (view._meta as { ui: { csp: { resourceDomains: string[] } } }).ui.csp.resourceDomains,
    ).toContain('https://www.cpsc.gov');
    const read = await h.client.readResource({ uri: view.uri });
    const content = read.contents[0]! as { mimeType?: string; text?: string };
    expect(content.mimeType).toBe(RESOURCE_MIME_TYPE);
    expect(content.text).toContain('<title>Custodian</title>');
  });

  it('runs voice-only (no _meta.ui) when no bundle is present', async () => {
    const plain = await startHarness();
    try {
      const { tools } = await plain.client.listTools();
      expect(tools.every((t) => !(t._meta as { ui?: unknown } | undefined)?.ui)).toBe(true);
    } finally {
      await plain.close();
    }
  });
});

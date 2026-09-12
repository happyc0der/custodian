import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AddItemOutput, ListInventoryOutput, RemoveItemOutput, BriefingOutput } from '@custodian/shared';
import { callTool, startHarness, type Harness } from './harness.js';

describe('inventory tools', () => {
  let h: Harness;
  const added: string[] = [];
  beforeAll(async () => {
    h = await startHarness({
      hooks: { onItemAdded: async (item) => void added.push(item.name) },
      now: () => new Date('2026-09-11T12:00:00Z'),
    });
  });
  afterAll(() => h.close());

  it('adds an item, infers category and brand, and fires the hook off the hot path', async () => {
    const r = await callTool<AddItemOutput>(h.client, 'add_item', { name: 'Graco 4Ever car seat', purchased_on: '06/01/2026' });
    expect(r.isError).toBe(false);
    expect(r.speech).toMatch(/added Graco 4Ever car seat as a car seat/i);
    expect(r.data.created).toBe(true);
    expect(r.data.item).toMatchObject({ category: 'car_seat', brand: 'Graco', purchased_on: '2026-06-01', quantity: 1 });
    await new Promise((r) => setTimeout(r, 10));
    expect(added).toContain('Graco 4Ever car seat');
  });

  it('merges a duplicate into quantity instead of creating a second record', async () => {
    const r = await callTool<AddItemOutput>(h.client, 'add_item', { name: 'graco 4ever car seat' });
    expect(r.data.merged_into_existing).toBe(true);
    expect(r.data.item.quantity).toBe(2);
    expect(r.speech).toMatch(/made it 2/);
  });

  it('never speaks a URL or an id', async () => {
    const r = await callTool<AddItemOutput>(h.client, 'add_item', { name: 'Joolz Aer2 stroller' });
    expect(r.speech).not.toMatch(/https?:|itm_/);
  });

  it('lists inventory grouped for speech', async () => {
    await callTool(h.client, 'add_item', { name: '2019 Honda Odyssey', vehicle: { make: 'Honda', model: 'Odyssey', year: 2019 } });
    const r = await callTool<ListInventoryOutput>(h.client, 'list_inventory');
    expect(r.data.total).toBe(4);
    expect(r.data.items.map((i) => i.category)).toEqual(expect.arrayContaining(['car_seat', 'stroller', 'vehicle']));
    expect(r.speech).toMatch(/You have 4 items on file/);
    const filtered = await callTool<ListInventoryOutput>(h.client, 'list_inventory', { category: 'vehicle' });
    expect(filtered.data.items).toHaveLength(1);
    expect(filtered.data.items[0]!.vehicle).toEqual({ make: 'Honda', model: 'Odyssey', year: 2019 });
  });

  it('asks for disambiguation when a removal is ambiguous, and removes on an exact name', async () => {
    await callTool(h.client, 'add_item', { name: 'Joolz Aer2 car seat adapter' });
    const ambiguous = await callTool<RemoveItemOutput>(h.client, 'remove_item', { name: 'joolz' });
    expect(ambiguous.isError).toBe(false);
    expect(ambiguous.data.candidates.length).toBeGreaterThan(1);
    expect(ambiguous.speech).toMatch(/Which one/);

    // A brand repeated in name + brand field must not double-count toward the overlap.
    const specific = await callTool<RemoveItemOutput>(h.client, 'check_recalls', { item_name: 'joolz adapter' });
    expect(specific.isError).toBe(false);
    expect((specific.data as unknown as { scope: string }).scope).toBe('item');

    const removed = await callTool<RemoveItemOutput>(h.client, 'remove_item', { name: 'Joolz Aer2 stroller' });
    expect(removed.data.removed?.name).toBe('Joolz Aer2 stroller');
    const missing = await callTool<RemoveItemOutput>(h.client, 'remove_item', { name: 'unicorn' });
    expect(missing.isError).toBe(true);
    expect(missing.speech).toMatch(/couldn't find unicorn/);
  });

  it('gives an all-clear briefing when nothing is due and marks the household as briefed', async () => {
    const r = await callTool<BriefingOutput>(h.client, 'household_briefing');
    expect(r.isError).toBe(false);
    expect(r.speech).toMatch(/no recalls on any of your \d+ tracked items/i);
    expect(r.data.new_recalls).toEqual([]);
    const household = await h.deps.store.getHousehold('dev');
    expect(household?.last_briefed_at).toBe('2026-09-11T12:00:00.000Z');
  });

  it('answers every tool call well inside the Alexa+ latency budget', async () => {
    const res = await fetch(`${h.baseUrl}/metrics.json`).then((r) => r.json() as Promise<{ tools: Record<string, { p95: number; count: number }> }>);
    for (const [tool, m] of Object.entries(res.tools)) {
      expect(m.count).toBeGreaterThan(0);
      expect(m.p95, `${tool} p95`).toBeLessThan(100);
    }
  });
});

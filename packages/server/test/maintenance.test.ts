import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { BriefingOutput, LogMaintenanceOutput, SetReminderOutput, WhatsDueOutput } from '@custodian/shared';
import { applyDefaultRules } from '../src/maintenance/service.js';
import { defaultRulesFor } from '../src/maintenance/defaults.js';
import { callTool, startHarness, type Harness } from './harness.js';

describe('maintenance defaults', () => {
  it('derives category rules from purchase/manufacture dates', () => {
    const base = { id: 'i', household_id: 'h', name: 'x', quantity: 1, aliases: [], enrichment_status: 'pending' as const, created_at: '', updated_at: '' };
    const smoke = defaultRulesFor({ ...base, category: 'smoke_detector', purchased_on: '2026-01-01' }, '2026-09-11');
    expect(smoke.map((r) => [r.kind, r.next_due])).toEqual([
      ['replace_battery', '2026-07-02'],
      ['replace_unit', '2035-12-30'],
    ]);
    const seat = defaultRulesFor({ ...base, category: 'car_seat', manufactured_on: '2021-03-15' }, '2026-09-11');
    expect(seat[0]).toMatchObject({ kind: 'expires', next_due: '2027-03-14' });
    expect(defaultRulesFor({ ...base, category: 'appliance' }, '2026-09-11')).toEqual([]);
    expect(defaultRulesFor({ ...base, category: 'appliance', purchased_on: '2026-09-01' }, '2026-09-11')[0]).toMatchObject({ kind: 'warranty_ends', next_due: '2027-09-01' });
  });
});

describe('maintenance tools', () => {
  let h: Harness;
  const now = () => new Date('2026-09-11T12:00:00Z');
  beforeAll(async () => {
    h = await startHarness({ now, hooks: { onItemAdded: async (item) => void (await applyDefaultRules(h.deps.store, item, now())) } });
  });
  afterAll(() => h.close());

  it('starts interval reminders from today when the purchase date is long past', async () => {
    await callTool(h.client, 'add_item', { name: '2019 Honda Odyssey', vehicle: { make: 'Honda', model: 'Odyssey', year: 2019 }, purchased_on: '2024-05-20' });
    await new Promise((r) => setTimeout(r, 30));
    const service = (await h.deps.store.listRules('dev')).find((r) => r.kind === 'service');
    expect(service?.next_due).toBe('2027-03-12');
    await callTool(h.client, 'remove_item', { name: '2019 Honda Odyssey' });
  });

  it('adds default reminders when items are added', async () => {
    await callTool(h.client, 'add_item', { name: 'Kidde smoke detector', purchased_on: '2026-01-01' });
    await callTool(h.client, 'add_item', { name: 'Graco 4Ever car seat', manufactured_on: '2020-10-01' });
    await callTool(h.client, 'add_item', { name: 'Brita water filter', purchased_on: '2026-08-01' });
    await new Promise((r) => setTimeout(r, 30));
    const rules = await h.deps.store.listRules('dev');
    expect(rules.map((r) => r.kind).sort()).toEqual(['expires', 'replace_battery', 'replace_filter', 'replace_unit']);
  });

  it('whats_due separates overdue from upcoming and speaks them naturally', async () => {
    const r = await callTool<WhatsDueOutput>(h.client, 'whats_due', { horizon_days: 60 });
    expect(r.data.due.map((d) => d.kind)).toEqual(['replace_battery']);
    expect(r.data.due[0]).toMatchObject({ overdue: true, next_due: '2026-07-02' });
    expect(r.data.upcoming.map((d) => [d.kind, d.next_due])).toEqual([['expires', '2026-09-30']]);
    expect(r.speech).toMatch(/One thing needs attention now/);
    expect(r.speech).toMatch(/your Kidde smoke detector needs new batteries, 71 days overdue/);
    expect(r.speech).toMatch(/your Graco 4Ever car seat expires in 19 days/);
  }, 20_000);

  it('log_maintenance rolls an interval reminder forward and clears one-shot ones', async () => {
    const r = await callTool<LogMaintenanceOutput>(h.client, 'log_maintenance', { item_name: 'brita filter' });
    expect(r.isError).toBe(false);
    expect(r.data.next_due).toBe('2027-03-12');
    expect(r.speech).toMatch(/again in about 6 months/);

    const ambiguous = await callTool<LogMaintenanceOutput>(h.client, 'log_maintenance', { item_name: 'smoke detector' });
    expect(ambiguous.data.candidates).toHaveLength(2);
    expect(ambiguous.speech).toMatch(/Which one did you do/);

    const batteries = await callTool<LogMaintenanceOutput>(h.client, 'log_maintenance', { item_name: 'smoke detector', task: 'batteries', date: '2026-09-10' });
    expect(batteries.data.next_due).toBe('2027-03-11');

    const unit = await callTool<LogMaintenanceOutput>(h.client, 'log_maintenance', { item_name: 'smoke detector', task: 'replace_unit' });
    expect(unit.speech).toMatch(/one-time reminder/);
    expect((await h.deps.store.listRules('dev')).some((x) => x.kind === 'replace_unit')).toBe(false);
  });

  it('set_maintenance_reminder creates custom recurring reminders', async () => {
    const r = await callTool<SetReminderOutput>(h.client, 'set_maintenance_reminder', { item_name: 'brita', label: 'Descale the pitcher', every_days: 90 });
    expect(r.data.rule).toMatchObject({ kind: 'custom', next_due: '2026-12-10', days_until_due: 90 });
    expect(r.speech).toMatch(/in 90 days, and every 90 days after that/);
    const missing = await callTool<SetReminderOutput>(h.client, 'set_maintenance_reminder', { item_name: 'brita', label: 'Nothing' });
    expect(missing.isError).toBe(true);
  });

  it('the briefing includes due maintenance', async () => {
    const r = await callTool<BriefingOutput>(h.client, 'household_briefing');
    expect(r.data.due_maintenance.map((d) => d.kind)).toEqual(['expires']);
    expect(r.speech).toMatch(/your Graco 4Ever car seat expires in 19 days/);
  });
});

import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type {
  AddItemOutput,
  BriefingOutput,
  CheckRecallsOutput,
  AcknowledgeRecallOutput,
  RecallDetailsOutput,
} from '@custodian/shared';
import { Sweeper, META_LAST_COMPLETED, type SweepSources } from '../src/jobs/sweep.js';
import { normalizeCpsc, type CpscRecall } from '../src/sources/cpsc.js';
import { normalizeNhtsaVehicle, type NhtsaVehicleRecall } from '../src/sources/nhtsaVehicle.js';
import { normalizeChildSeatRecalls, type ChildSeatPage } from '../src/sources/nhtsaChildSeat.js';
import { callTool, startHarness, type Harness } from './harness.js';

const fixture = <T>(name: string): T =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')) as T;
const cpsc = fixture<CpscRecall[]>('cpsc-car-seat.json');
const odyssey = fixture<{ results: NhtsaVehicleRecall[] }>('nhtsa-odyssey-2019.json');
const seatPage = fixture<ChildSeatPage>('nhtsa-childseats-page.json');

/** Fake sources replaying fixtures, counting calls so we can prove nothing hits the network from a tool. */
function fakeSources() {
  const calls = { since: 0, search: 0, vehicle: 0, seats: 0, fda: 0 };
  const sources: SweepSources = {
    cpsc: {
      async fetchSince() {
        calls.since++;
        return cpsc.map(normalizeCpsc);
      },
      async searchProduct(q: string) {
        calls.search++;
        return cpsc
          .filter((r) => r.Title.toLowerCase().includes(q.toLowerCase().split(' ')[0]!))
          .map(normalizeCpsc);
      },
    },
    nhtsaVehicle: {
      async fetchForItem(item) {
        calls.vehicle++;
        return item.vehicle?.model === 'Odyssey' ? odyssey.results.map(normalizeNhtsaVehicle) : [];
      },
    },
    nhtsaChildSeat: {
      async fetchPage(offset) {
        calls.seats++;
        return {
          records: normalizeChildSeatRecalls(seatPage.results),
          nextOffset: offset === 0 ? 100 : null,
          total: 200,
        };
      },
    },
    openFda: {
      async fetchForItem() {
        calls.fda++;
        return [];
      },
    },
  };
  return { sources, calls };
}

describe('sweep + recall tools', () => {
  let h: Harness;
  let sweeper: Sweeper;
  let calls: ReturnType<typeof fakeSources>['calls'];
  const now = () => new Date('2026-09-11T12:00:00Z');

  beforeAll(async () => {
    const fake = fakeSources();
    calls = fake.calls;
    h = await startHarness({
      now,
      hooks: { onItemAdded: async (item) => void (await sweeper.sweepItem(item)) },
    });
    sweeper = new Sweeper({ store: h.deps.store, sources: fake.sources, now, log: () => {} });
  });
  afterAll(() => h.close());

  it('full sweep ingests feeds, crawls child seats in slices, and records the completion time', async () => {
    await sweeper.runFull();
    expect(calls.since).toBe(1);
    expect(calls.seats).toBe(2);
    expect(sweeper.index.size).toBeGreaterThan(5);
    expect(await h.deps.store.getMeta(META_LAST_COMPLETED)).toBe('2026-09-11T12:00:00.000Z');
    expect(await h.deps.store.getMeta('sweep:childseat_offset')).toBe('-1');
    // Second run within a week does not re-crawl the catalogue.
    await sweeper.runFull();
    expect(calls.seats).toBe(2);
  });

  it('add_item answers immediately and the targeted sweep finds the recall afterwards', async () => {
    const added = await callTool<AddItemOutput>(h.client, 'add_item', {
      name: 'Joolz Aer2 car seat adapter',
    });
    expect(added.speech).toMatch(/Got it/);
    await new Promise((r) => setTimeout(r, 50));
    expect(calls.search).toBe(1);
    const item = await h.deps.store.getItem('dev', added.data.item.id);
    expect(item?.enrichment_status).toBe('done');
    const matches = await h.deps.store.listMatches('dev');
    expect(matches.some((m) => m.recall_id === 'cpsc:26568' && m.status === 'new')).toBe(true);
  });

  it('check_recalls speaks the hazard and the remedy without touching the network', async () => {
    const before = { ...calls };
    const r = await callTool<CheckRecallsOutput>(h.client, 'check_recalls');
    expect(calls).toEqual(before);
    expect(r.isError).toBe(false);
    expect(r.data.matches.length).toBeGreaterThanOrEqual(1);
    const top = r.data.matches[0]!;
    expect(top.recall.id).toBe('cpsc:26568');
    expect(r.speech).toMatch(/Your Joolz Aer2 car seat adapter is affected by a recall/);
    expect(r.speech).toMatch(/refund/i);
    expect(r.speech).not.toMatch(/https?:/);
    expect(r.data.last_sweep_at).toBe('2026-09-11T12:00:00.000Z');
  });

  it('check_recalls for one item scopes and disambiguates', async () => {
    const one = await callTool<CheckRecallsOutput>(h.client, 'check_recalls', {
      item_name: 'joolz adapter',
    });
    expect(one.data.scope).toBe('item');
    expect(one.data.matches).toHaveLength(1);
    const none = await callTool<CheckRecallsOutput>(h.client, 'check_recalls', {
      item_name: 'toaster',
    });
    expect(none.isError).toBe(true);
    expect(none.speech).toMatch(/don't have toaster/);
  });

  it('vehicles get NHTSA campaigns via the targeted lookup', async () => {
    await callTool(h.client, 'add_item', {
      name: '2019 Honda Odyssey',
      vehicle: { make: 'Honda', model: 'Odyssey', year: 2019 },
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(calls.vehicle).toBeGreaterThanOrEqual(1);
    const r = await callTool<CheckRecallsOutput>(h.client, 'check_recalls', {
      item_name: 'Honda Odyssey',
    });
    expect(r.data.matches.length).toBe(odyssey.results.length);
    expect(r.data.matches.every((m) => m.confidence === 1)).toBe(true);
  });

  it('household_briefing surfaces new recalls once, then marks them seen', async () => {
    const first = await callTool<BriefingOutput>(h.client, 'household_briefing');
    expect(first.speech).toMatch(/Heads up/);
    expect(first.data.new_recalls.length).toBeGreaterThan(1);
    const second = await callTool<BriefingOutput>(h.client, 'household_briefing');
    expect(second.data.new_recalls).toEqual([]);
    expect(second.speech).toMatch(/still open/);
  });

  it('get_recall_details speaks the remedy and contact; acknowledge closes the match', async () => {
    const details = await callTool<RecallDetailsOutput>(h.client, 'get_recall_details', {
      recall_id: 'cpsc:26568',
    });
    expect(details.data.recall.id).toBe('cpsc:26568');
    expect(details.speech).toMatch(/stop using/i);
    expect(details.speech).toMatch(/888-943-4889/);
    expect(details.speech).not.toMatch(/https?:|www\./);

    const ack = await callTool<AcknowledgeRecallOutput>(h.client, 'acknowledge_recall', {
      recall_id: 'cpsc:26568',
      action: 'remedy_requested',
    });
    expect(ack.data.match.status).toBe('remedy_requested');
    const after = await callTool<CheckRecallsOutput>(h.client, 'check_recalls', {
      item_name: 'joolz adapter',
    });
    expect(after.data.matches).toEqual([]);
    expect(after.speech).toMatch(/haven't found any recalls/);
    const withResolved = await callTool<CheckRecallsOutput>(h.client, 'check_recalls', {
      item_name: 'joolz adapter',
      include_resolved: true,
    });
    expect(withResolved.data.matches[0]?.status).toBe('remedy_requested');
  });

  it('a re-sweep never overrides a status the customer set', async () => {
    await sweeper.runFull();
    const m = (await h.deps.store.listMatches('dev')).find((x) => x.recall_id === 'cpsc:26568');
    expect(m?.status).toBe('remedy_requested');
  });
});

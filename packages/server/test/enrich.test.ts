import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Item } from '@custodian/shared';
import { BedrockEnricher, type ParseClient } from '../src/enrich/bedrock.js';
import { Sweeper, type SweepSources } from '../src/jobs/sweep.js';
import { normalizeCpsc, type CpscRecall } from '../src/sources/cpsc.js';
import { FileStore } from '../src/store/file.js';

const fixture = <T>(name: string): T =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)).toString()) as T;
const t = '2026-09-11T12:00:00.000Z';
const item = (name: string, extra: Partial<Item> = {}): Item => ({
  id: 'itm_1',
  household_id: 'dev',
  name,
  category: 'other',
  quantity: 1,
  aliases: [name],
  enrichment_status: 'pending',
  created_at: t,
  updated_at: t,
  ...extra,
});

function fakeClient(
  answers: Array<unknown>,
): ParseClient & { calls: Array<Record<string, unknown>> } {
  const calls: Array<Record<string, unknown>> = [];
  return {
    calls,
    messages: {
      async parse(params) {
        calls.push(params as Record<string, unknown>);
        return { parsed_output: answers.shift() };
      },
    },
  };
}

describe('BedrockEnricher', () => {
  it('normalizes a spoken description into a product record via structured output', async () => {
    const client = fakeClient([
      {
        brand: 'Graco',
        model: '4Ever DLX',
        category: 'car_seat',
        aliases: ['the car seat', 'Graco convertible seat'],
        canonical_name: 'Graco 4Ever DLX car seat',
      },
    ]);
    const e = new BedrockEnricher(
      { bedrockRegion: 'us-west-2', bedrockModel: 'anthropic.claude-opus-5' },
      client,
    );
    const n = await e.normalizeItem(item('the graco four-ever seat we got at target'));
    expect(n).toMatchObject({ brand: 'Graco', model: '4Ever DLX', category: 'car_seat' });
    expect(client.calls[0]).toMatchObject({ model: 'anthropic.claude-opus-5' });
    expect(client.calls[0]!.output_config).toBeTruthy();
  });

  it('returns undefined on malformed model output instead of throwing', async () => {
    const client = fakeClient([{ nonsense: true }]);
    const e = new BedrockEnricher({ bedrockRegion: 'us-west-2', bedrockModel: 'm' }, client);
    expect(await e.normalizeItem(item('x'))).toBeUndefined();
  });
});

describe('Sweeper with an enricher', () => {
  const joolz = fixture<CpscRecall[]>('cpsc-car-seat.json')
    .map(normalizeCpsc)
    .find((r) => r.id === 'cpsc:26568')!;
  const sources: SweepSources = {
    cpsc: {
      async fetchSince() {
        return [joolz];
      },
      async searchProduct() {
        return [joolz];
      },
    },
    nhtsaVehicle: {
      async fetchForItem() {
        return [];
      },
    },
    nhtsaChildSeat: {
      async fetchPage() {
        return { records: [], nextOffset: null, total: 0 };
      },
    },
    openFda: {
      async fetchForItem() {
        return [];
      },
    },
  };

  it('applies normalization off the hot path and lets the model veto an ambiguous match', async () => {
    const store = new FileStore(':memory:');
    await store.putHousehold({ id: 'dev', name: 'Home', created_at: t });
    // "Joolz Aer2 stroller" scores in the ambiguous band against the adapter recall; the model says it does not apply.
    const stroller = item('Joolz Aer2 stroller', { brand: 'Joolz', category: 'stroller' });
    await store.putItem(stroller);
    const client = fakeClient([
      {
        brand: 'Joolz',
        model: 'Aer2',
        category: 'stroller',
        aliases: ['the stroller'],
        canonical_name: 'Joolz Aer2 stroller',
      },
      {
        applies: 'no',
        confidence: 0.9,
        reason: 'Recall covers the car seat adapter accessory, not the stroller itself.',
      },
    ]);
    const enricher = new BedrockEnricher({ bedrockRegion: 'r', bedrockModel: 'm' }, client);
    const sweeper = new Sweeper({
      store,
      sources,
      enricher,
      now: () => new Date(t),
      log: () => {},
    });
    const matches = await sweeper.sweepItem(stroller);
    expect(matches).toEqual([]);
    expect(client.calls).toHaveLength(2);
    const updated = await store.getItem('dev', 'itm_1');
    expect(updated?.model).toBe('Aer2');
    expect(updated?.aliases).toContain('the stroller');
    expect(updated?.enrichment_status).toBe('done');
  });

  it('a confirmed ambiguous match is promoted and the judgement is not repeated', async () => {
    const store = new FileStore(':memory:');
    await store.putHousehold({ id: 'dev', name: 'Home', created_at: t });
    const stroller = item('Joolz Aer2 stroller', { brand: 'Joolz', category: 'stroller' });
    await store.putItem(stroller);
    const client = fakeClient([
      undefined,
      { applies: 'yes', confidence: 0.85, reason: 'Adapter ships with this stroller line.' },
    ]);
    const enricher = new BedrockEnricher({ bedrockRegion: 'r', bedrockModel: 'm' }, client);
    const sweeper = new Sweeper({
      store,
      sources,
      enricher,
      now: () => new Date(t),
      log: () => {},
    });
    const first = await sweeper.sweepItem(stroller);
    expect(first[0]).toMatchObject({ recall_id: 'cpsc:26568', confidence: 0.85 });
    expect(first[0]!.reason).toMatch(/^llm:/);
    await sweeper.matchItem(stroller);
    expect(client.calls).toHaveLength(2);
  });

  it('enrichment failure is recorded and matching still runs deterministically', async () => {
    const store = new FileStore(':memory:');
    await store.putHousehold({ id: 'dev', name: 'Home', created_at: t });
    const adapter = item('Joolz Aer2 car seat adapter', { brand: 'Joolz', category: 'car_seat' });
    await store.putItem(adapter);
    const failing: ParseClient = {
      messages: {
        parse: async () => {
          throw new Error('AccessDeniedException');
        },
      },
    };
    const sweeper = new Sweeper({
      store,
      sources,
      enricher: new BedrockEnricher({ bedrockRegion: 'r', bedrockModel: 'm' }, failing),
      now: () => new Date(t),
      log: () => {},
    });
    const matches = await sweeper.sweepItem(adapter);
    expect(matches.map((m) => m.recall_id)).toEqual(['cpsc:26568']);
    expect((await store.getItem('dev', 'itm_1'))?.enrichment_status).toBe('failed');
  });
});

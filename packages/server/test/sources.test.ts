import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { RecallRecord } from '@custodian/shared';
import { CpscSource, normalizeCpsc, type CpscRecall } from '../src/sources/cpsc.js';
import { NhtsaVehicleSource, normalizeNhtsaVehicle, type NhtsaVehicleRecall } from '../src/sources/nhtsaVehicle.js';
import { NhtsaChildSeatSource, normalizeChildSeatRecalls, type ChildSeatPage } from '../src/sources/nhtsaChildSeat.js';
import { OpenFdaSource, fdaQueryTerms, normalizeFda, type FdaEnforcement } from '../src/sources/openfda.js';
import type { Item } from '@custodian/shared';

const fixture = <T>(name: string): T => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')) as T;
const fakeFetch = (body: unknown, status = 200): typeof fetch => (async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch;

const baseItem: Item = {
  id: 'itm_x', household_id: 'h', name: 'x', category: 'other', quantity: 1, aliases: [], enrichment_status: 'pending',
  created_at: '2026-09-11T00:00:00Z', updated_at: '2026-09-11T00:00:00Z',
};

describe('CPSC', () => {
  const rows = fixture<CpscRecall[]>('cpsc-car-seat.json');

  it('normalizes the Joolz car-seat-adapter recall into a valid RecallRecord', () => {
    const joolz = rows.find((r) => r.RecallNumber === '26568')!;
    const rec = normalizeCpsc(joolz);
    expect(RecallRecord.safeParse(rec).success).toBe(true);
    expect(rec).toMatchObject({ id: 'cpsc:26568', source: 'cpsc', published_on: '2026-06-18', severity: 'high', remedy_options: ['Refund'] });
    expect(rec.image_url).toMatch(/^https:\/\/www\.cpsc\.gov\//);
    expect(rec.products[0]?.brand).toBe('Joolz USA');
    expect(rec.categories).toContain('car_seat');
    expect(rec.keywords).toEqual(expect.arrayContaining(['joolz', 'aer2', 'adapter']));
    expect(rec.remedy).toMatch(/stop using/i);
  });

  it('does not trust a title the record body contradicts (CPSC 26569 carries the Joolz title over a lounger recall)', () => {
    const pair = fixture<CpscRecall[]>('cpsc-joolz-pair.json').map(normalizeCpsc);
    const adapter = pair.find((r) => r.external_id === '26568')!;
    const lounger = pair.find((r) => r.external_id === '26569')!;
    expect(adapter.keywords).toEqual(expect.arrayContaining(['joolz', 'aer2', 'adapter']));
    expect(lounger.keywords).not.toContain('joolz');
    expect(lounger.keywords).toContain('lounger');
  });

  it('grades severity from the hazard language', () => {
    const recent = fixture<CpscRecall[]>('cpsc-recent.json').map(normalizeCpsc);
    expect(recent.every((r) => RecallRecord.safeParse(r).success)).toBe(true);
    const deathRecall = recent.find((r) => /death/i.test(r.title));
    expect(deathRecall?.severity).toBe('critical');
    // The Joolz adapter recall is "serious injury from fall hazard" with no death language.
    const joolz = normalizeCpsc(rows.find((r) => r.RecallNumber === '26568')!);
    expect(joolz.severity).toBe('high');
  });

  it('fetchSince hits the JSON endpoint with RecallDateStart', async () => {
    let seen = '';
    const src = new CpscSource({ fetch: (async (url: string) => { seen = url; return new Response(JSON.stringify(rows.slice(0, 2))); }) as unknown as typeof fetch });
    const out = await src.fetchSince('2026-08-01');
    expect(seen).toContain('format=json');
    expect(seen).toContain('RecallDateStart=2026-08-01');
    expect(out).toHaveLength(2);
  });
});

describe('NHTSA vehicle', () => {
  const page = fixture<{ results: NhtsaVehicleRecall[] }>('nhtsa-odyssey-2019.json');

  it('normalizes campaigns with vehicle scope and dealer remedy', () => {
    const rec = normalizeNhtsaVehicle(page.results[0]!);
    expect(RecallRecord.safeParse(rec).success).toBe(true);
    expect(rec.id).toBe('nhtsa:20V439000');
    expect(rec.vehicle).toEqual({ make: 'Honda', model: 'Odyssey', year: 2019 });
    expect(rec.published_on).toBe('2020-07-28');
    expect(rec.title).toMatch(/^2019 Honda Odyssey: /);
    expect(rec.categories).toEqual(['vehicle']);
  });

  it('leads the remedy with a park-it instruction when NHTSA flags it', () => {
    const rec = normalizeNhtsaVehicle({ ...page.results[0]!, parkIt: true });
    expect(rec.severity).toBe('critical');
    expect(rec.remedy).toMatch(/^Do not drive/);
  });

  it('fetchForItem only runs for vehicles and passes make/model/year', async () => {
    let seen = '';
    const src = new NhtsaVehicleSource({ fetch: (async (url: string) => { seen = url; return new Response(JSON.stringify(page)); }) as unknown as typeof fetch });
    expect(await src.fetchForItem(baseItem)).toEqual([]);
    const out = await src.fetchForItem({ ...baseItem, category: 'vehicle', vehicle: { make: 'Honda', model: 'Odyssey', year: 2019 } });
    expect(seen).toContain('make=Honda');
    expect(seen).toContain('modelYear=2019');
    expect(out).toHaveLength(page.results.length);
  });
});

describe('NHTSA child seats', () => {
  const page = fixture<ChildSeatPage>('nhtsa-childseats-page.json');

  it('folds seats into one record per campaign with all affected models', () => {
    const recs = normalizeChildSeatRecalls(page.results);
    expect(recs.length).toBeGreaterThan(0);
    expect(recs.every((r) => RecallRecord.safeParse(r).success)).toBe(true);
    const campaigns = recs.map((r) => r.external_id);
    expect(new Set(campaigns).size).toBe(campaigns.length);
    for (const r of recs) {
      expect(r.categories).toEqual(['car_seat']);
      expect(r.keywords).toContain('car');
      expect(r.published_on).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('fetchPage reports the next slice offset', async () => {
    const src = new NhtsaChildSeatSource({ fetch: fakeFetch(page) });
    const out = await src.fetchPage(1200);
    expect(out.total).toBe(page.meta.pagination.total);
    expect(out.nextOffset).toBe(1200 + page.meta.pagination.count);
    expect(out.records.length).toBeGreaterThan(0);
  });
});

describe('openFDA', () => {
  const food = fixture<{ results: FdaEnforcement[] }>('openfda-food-romaine.json');
  const device = fixture<{ results: FdaEnforcement[] }>('openfda-device-thermometer.json');

  it('normalizes Class I food recalls as critical', () => {
    const rec = normalizeFda(food.results[0]!, 'food');
    expect(RecallRecord.safeParse(rec).success).toBe(true);
    expect(rec.severity).toBe('critical');
    expect(rec.categories).toEqual(['food']);
    expect(rec.title).toMatch(/^Class I food recall: /);
    expect(rec.published_on).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(rec.remedy).toMatch(/Stop using/);
  });

  it('maps device enforcement to medical_device', () => {
    const rec = normalizeFda(device.results[0]!, 'device');
    expect(rec.categories).toEqual(['medical_device']);
  });

  it('builds a compact search from brand + head nouns and treats 404 as no results', async () => {
    const item: Item = { ...baseItem, name: 'Braun ThermoScan thermometer', brand: 'Braun', category: 'medical_device' };
    expect(fdaQueryTerms(item)).toEqual(['braun', 'thermoscan', 'thermometer']);
    let seen = '';
    const src = new OpenFdaSource({ fetch: (async (url: string) => { seen = url; return new Response(JSON.stringify(device)); }) as unknown as typeof fetch, now: () => new Date('2026-09-11T00:00:00Z') });
    const out = await src.fetchForItem(item);
    expect(seen).toContain('/device/enforcement.json?search=(product_description:"braun"+AND+product_description:"thermoscan"');
    expect(seen).toContain('recall_initiation_date:[20240911+TO+20260911]');
    expect(out).toHaveLength(device.results.length);
    const empty = new OpenFdaSource({ fetch: fakeFetch({ error: { code: 'NOT_FOUND' } }, 404) });
    expect(await empty.fetchForItem(item)).toEqual([]);
    expect(await empty.fetchForItem({ ...item, category: 'toy' })).toEqual([]);
  });
});

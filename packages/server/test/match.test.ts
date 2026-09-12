import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Item } from '@custodian/shared';
import { normalizeCpsc, type CpscRecall } from '../src/sources/cpsc.js';
import { normalizeNhtsaVehicle, type NhtsaVehicleRecall } from '../src/sources/nhtsaVehicle.js';
import { normalizeChildSeatRecalls, type ChildSeatPage } from '../src/sources/nhtsaChildSeat.js';
import { normalizeFda, type FdaEnforcement } from '../src/sources/openfda.js';
import { RecallIndex } from '../src/match/index.js';
import { LIKELY_THRESHOLD, MATCH_THRESHOLD, itemQuery, scoreMatch } from '../src/match/score.js';
import { defaultAliases, inferBrand, inferCategory } from '../src/enrich/categorize.js';

const fixture = <T>(name: string): T => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')) as T;

function item(name: string, extra: Partial<Item> = {}): Item {
  const brand = inferBrand(name, extra.brand);
  return {
    id: `itm_${name.replace(/\W+/g, '_')}`, household_id: 'h', name, brand, category: inferCategory(name, extra.category), quantity: 1,
    aliases: defaultAliases(name, brand), enrichment_status: 'pending', created_at: '2026-09-11T00:00:00Z', updated_at: '2026-09-11T00:00:00Z', ...extra,
  };
}

const cpsc = fixture<CpscRecall[]>('cpsc-car-seat.json').map(normalizeCpsc);
const cpscRecent = fixture<CpscRecall[]>('cpsc-recent.json').map(normalizeCpsc);
const joolz = cpsc.find((r) => r.id === 'cpsc:26568')!;
const odyssey = fixture<{ results: NhtsaVehicleRecall[] }>('nhtsa-odyssey-2019.json').results.map(normalizeNhtsaVehicle);
const seats = normalizeChildSeatRecalls(fixture<ChildSeatPage>('nhtsa-childseats-page.json').results);
const romaine = fixture<{ results: FdaEnforcement[] }>('openfda-food-romaine.json').results.map((r) => normalizeFda(r, 'food'));

describe('scoreMatch', () => {
  it('is confident when brand and model line up (Joolz Aer2 adapter)', () => {
    const s = scoreMatch(item('Joolz Aer2 car seat adapter'), joolz);
    expect(s.score).toBeGreaterThanOrEqual(LIKELY_THRESHOLD);
    expect(s.reason).toMatch(/brand Joolz matches/);
  });

  it('does not match a different brand of the same product type', () => {
    expect(scoreMatch(item('Graco 4Ever car seat'), joolz).score).toBeLessThan(MATCH_THRESHOLD);
    expect(scoreMatch(item('Chicco KeyFit 30 infant car seat'), joolz).score).toBeLessThan(MATCH_THRESHOLD);
  });

  it('flags the stroller the adapter attaches to as a possible (not likely) match', () => {
    const s = scoreMatch(item('Joolz Aer2 stroller'), joolz);
    expect(s.score).toBeGreaterThanOrEqual(MATCH_THRESHOLD);
    expect(s.score).toBeLessThan(LIKELY_THRESHOLD);
  });

  it('matches vehicles only on exact make/model/year', () => {
    const van = item('2019 Honda Odyssey', { category: 'vehicle', vehicle: { make: 'Honda', model: 'Odyssey', year: 2019 } });
    expect(scoreMatch(van, odyssey[0]!).score).toBe(1);
    const other = item('2018 Honda Odyssey', { category: 'vehicle', vehicle: { make: 'Honda', model: 'Odyssey', year: 2018 } });
    expect(scoreMatch(other, odyssey[0]!).score).toBe(0);
    expect(scoreMatch(item('Honda lawn mower'), odyssey[0]!).score).toBe(0);
  });

  it('matches child seats by brand + model name', () => {
    const advocate = seats.find((r) => r.external_id === '15C003000')!;
    expect(scoreMatch(item('Britax Advocate ClickTight car seat'), advocate).score).toBeGreaterThanOrEqual(LIKELY_THRESHOLD);
    expect(scoreMatch(item('Britax B-Safe infant seat'), advocate).score).toBeLessThan(LIKELY_THRESHOLD);
    expect(scoreMatch(item('Graco 4Ever car seat'), advocate).score).toBeLessThan(MATCH_THRESHOLD);
  });

  it('matches food on descriptive words rather than brand', () => {
    const s = scoreMatch(item('romaine lettuce', { category: 'food' }), romaine[0]!);
    expect(s.score).toBeGreaterThanOrEqual(MATCH_THRESHOLD);
    expect(scoreMatch(item('peanut butter', { category: 'food' }), romaine[0]!).score).toBeLessThan(MATCH_THRESHOLD);
  });

  it('keeps generic nouns from producing false positives across the recent CPSC feed', () => {
    const noisy = [item('Graco 4Ever car seat'), item('IKEA Malm dresser', { category: 'furniture' }), item('Dyson V8 vacuum'), item('Kidde smoke detector')];
    for (const it of noisy) {
      const likely = cpscRecent.filter((r) => scoreMatch(it, r).score >= LIKELY_THRESHOLD);
      expect(likely, `${it.name} likely-matched ${likely.map((r) => r.title).join(' | ')}`).toEqual([]);
    }
  });
});

describe('scoreMatch recency', () => {
  it('halves the score of recalls announced well before the item was bought', () => {
    const fresh = item('Joolz Aer2 car seat adapter', { purchased_on: '2026-03-01' });
    const old = item('Joolz Aer2 car seat adapter', { purchased_on: '2020-01-01' });
    // Recall published 2026-06-18: applies to both (a 2020 purchase predates it).
    expect(scoreMatch(fresh, joolz).score).toBeGreaterThanOrEqual(LIKELY_THRESHOLD);
    expect(scoreMatch(old, joolz).score).toBeGreaterThanOrEqual(LIKELY_THRESHOLD);
    // A recall from 2014 vs. a 2026 purchase is halved and drops below the threshold.
    const oldRecall = { ...joolz, id: 'cpsc:old', published_on: '2014-05-01' };
    const s = scoreMatch(fresh, oldRecall);
    expect(s.score).toBeLessThan(LIKELY_THRESHOLD);
    expect(s.reason).toMatch(/predates purchase/);
    // Without a purchase date we cannot tell, so nothing is halved.
    expect(scoreMatch(item('Joolz Aer2 car seat adapter'), oldRecall).score).toBeGreaterThanOrEqual(LIKELY_THRESHOLD);
  });
});

describe('RecallIndex', () => {
  it('returns the right recall among the whole corpus for an item query', () => {
    const idx = new RecallIndex();
    idx.add([...cpsc, ...cpscRecent, ...odyssey, ...seats, ...romaine]);
    const hits = idx.candidates(itemQuery(item('Joolz Aer2 car seat adapter')));
    expect(hits[0]?.id).toBe('cpsc:26568');
    const seatHits = idx.candidates(itemQuery(item('Britax Marathon ClickTight')));
    expect(seatHits.some((r) => r.external_id === '15C003000')).toBe(true);
    expect(idx.candidates('')).toEqual([]);
  });

  it('replaces a record on re-add instead of duplicating it', () => {
    const idx = new RecallIndex();
    idx.add([joolz]);
    idx.add([{ ...joolz, title: 'updated' }]);
    expect(idx.size).toBe(1);
    expect(idx.get(joolz.id)?.title).toBe('updated');
  });
});

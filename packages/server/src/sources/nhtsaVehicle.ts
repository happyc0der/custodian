import { recallId, tokenize, type Item, type RecallRecord } from '@custodian/shared';
import { fetchJson, type FetchLike } from './http.js';
import { truncate, type RecallSourceClient } from './types.js';

/** Shape of https://api.nhtsa.gov/recalls/recallsByVehicle */
export interface NhtsaVehicleRecall {
  Manufacturer: string;
  NHTSACampaignNumber: string;
  parkIt: boolean;
  parkOutSide: boolean;
  overTheAirUpdate: boolean;
  ReportReceivedDate: string; // DD/MM/YYYY
  Component: string;
  Summary: string;
  Consequence: string;
  Remedy: string;
  Notes: string;
  ModelYear: string;
  Make: string;
  Model: string;
}

const BASE = 'https://api.nhtsa.gov/recalls/recallsByVehicle';

export function isoFromDdMmYyyy(s: string): string {
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? '1970-01-01' : d.toISOString().slice(0, 10);
}

export function titleCase(s: string): string {
  return s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

export function normalizeNhtsaVehicle(r: NhtsaVehicleRecall): RecallRecord {
  const year = Number(r.ModelYear);
  const make = titleCase(r.Make);
  const model = titleCase(r.Model);
  const vehicleLabel = `${r.ModelYear} ${make} ${model}`;
  const component = titleCase(r.Component.split(':')[0] ?? r.Component);
  const urgent = r.parkIt
    ? 'Do not drive this vehicle until it is repaired.'
    : r.parkOutSide
      ? 'Park this vehicle outside and away from structures until it is repaired.'
      : '';
  return {
    id: recallId('nhtsa', r.NHTSACampaignNumber),
    source: 'nhtsa',
    external_id: r.NHTSACampaignNumber,
    title: `${vehicleLabel}: ${component} recall`,
    summary: truncate(r.Summary),
    hazard: truncate(r.Consequence, 400),
    remedy: [urgent, truncate(r.Remedy, 500)].filter(Boolean).join(' '),
    remedy_options: r.overTheAirUpdate ? ['Over-the-air update'] : ['Free dealer repair'],
    contact: r.Manufacturer,
    url: `https://www.nhtsa.gov/recalls?nhtsaId=${encodeURIComponent(r.NHTSACampaignNumber)}`,
    published_on: isoFromDdMmYyyy(r.ReportReceivedDate),
    products: [{ name: vehicleLabel, brand: make, model }],
    categories: ['vehicle'],
    severity: r.parkIt || r.parkOutSide ? 'critical' : /crash|fire|injur|death/i.test(r.Consequence) ? 'high' : 'moderate',
    keywords: [...new Set(tokenize(`${r.Make} ${r.Model} ${r.ModelYear} ${r.Component}`))],
    vehicle: Number.isFinite(year) ? { make, model, year } : undefined,
  };
}

/** Vehicle campaigns are looked up per (make, model, year) — there is no useful "since" feed. */
export class NhtsaVehicleSource implements RecallSourceClient {
  readonly source = 'nhtsa' as const;
  constructor(private readonly opts: { fetch?: FetchLike; baseUrl?: string } = {}) {}

  async fetchForItem(item: Item): Promise<RecallRecord[]> {
    if (!item.vehicle) return [];
    const u = new URL(this.opts.baseUrl ?? BASE);
    u.searchParams.set('make', item.vehicle.make);
    u.searchParams.set('model', item.vehicle.model);
    u.searchParams.set('modelYear', String(item.vehicle.year));
    const data = await fetchJson<{ Count: number; results: NhtsaVehicleRecall[] }>(u.toString(), { fetch: this.opts.fetch, timeoutMs: 20_000 });
    return (data.results ?? []).map(normalizeNhtsaVehicle);
  }
}

import { recallId, tokenize, type RecallRecord } from '@custodian/shared';
import { fetchJson, type FetchLike } from './http.js';
import { isoFromDdMmYyyy, titleCase } from './nhtsaVehicle.js';
import { truncate, type RecallSourceClient } from './types.js';

/**
 * https://api.nhtsa.gov/childSeats?issueType=r is a product catalogue (≈7,600
 * seats, 100 per page, no server-side filtering) where each seat embeds its
 * recall campaigns. We crawl it in slices across sweeps, keeping a cursor in
 * the store, and fold seats into one RecallRecord per campaign number.
 */
export interface ChildSeatRow {
  id: number;
  active: boolean;
  make: string | null;
  productModel: string | null;
  modelNumber: string | null;
  manufacturerDate: string | null;
  seatType: string | null;
  picture: string | null;
  recallsCount: number;
  safetyIssues: { recalls?: ChildSeatRecall[] };
}

export interface ChildSeatRecall {
  nhtsaCampaignNumber: string;
  manufacturer: string | null;
  reportReceivedDate: string | null; // ISO timestamp
  subject: string | null;
  summary: string | null;
  consequence: string | null;
  correctiveAction: string | null;
  potentialNumberOfUnitsAffected?: number;
}

export interface ChildSeatPage {
  meta: {
    pagination: {
      count: number;
      max: number;
      offset: number;
      total: number;
      nextUrl: string | null;
    };
  };
  results: ChildSeatRow[];
}

const BASE = 'https://api.nhtsa.gov/childSeats';
export const PAGE_SIZE = 100;

export function normalizeChildSeatRecalls(rows: ChildSeatRow[]): RecallRecord[] {
  const byCampaign = new Map<string, RecallRecord>();
  for (const row of rows) {
    for (const rec of row.safetyIssues?.recalls ?? []) {
      if (!rec?.nhtsaCampaignNumber) continue;
      const brand = titleCase(row.make ?? rec.manufacturer ?? 'Unknown');
      const model = titleCase(row.productModel ?? row.modelNumber ?? '');
      const product = {
        name: `${brand} ${model} car seat`.replace(/\s+/g, ' ').trim(),
        brand,
        model: row.modelNumber ?? model,
      };
      const existing = byCampaign.get(rec.nhtsaCampaignNumber);
      if (existing) {
        if (!existing.products.some((p) => p.model === product.model))
          existing.products.push(product);
        for (const k of tokenize(
          `${row.make ?? ''} ${row.productModel ?? ''} ${row.modelNumber ?? ''}`,
        ))
          if (!existing.keywords.includes(k)) existing.keywords.push(k);
        continue;
      }
      const received = rec.reportReceivedDate ?? '';
      const published = received.includes('/')
        ? isoFromDdMmYyyy(received)
        : received.slice(0, 10) || '1970-01-01';
      byCampaign.set(rec.nhtsaCampaignNumber, {
        id: recallId('nhtsa', rec.nhtsaCampaignNumber),
        source: 'nhtsa',
        external_id: rec.nhtsaCampaignNumber,
        title: `${brand} ${model} car seat: ${rec.subject}`,
        summary: truncate(rec.summary ?? ''),
        hazard: truncate(rec.consequence ?? rec.subject ?? '', 400),
        remedy: truncate(rec.correctiveAction ?? '', 500),
        remedy_options: /replace/i.test(rec.correctiveAction ?? '')
          ? ['Free replacement']
          : /kit|repair|remedy/i.test(rec.correctiveAction ?? '')
            ? ['Free repair kit']
            : ['Contact manufacturer'],
        contact: rec.manufacturer ?? undefined,
        url: `https://www.nhtsa.gov/recalls?nhtsaId=${encodeURIComponent(rec.nhtsaCampaignNumber)}`,
        image_url: row.picture ?? undefined,
        published_on: published,
        products: [product],
        categories: ['car_seat'],
        severity: /death|fatal/i.test(rec.consequence ?? '') ? 'critical' : 'high',
        keywords: [
          ...new Set(
            tokenize(
              `${row.make ?? ''} ${row.productModel ?? ''} ${row.modelNumber ?? ''} ${rec.subject ?? ''} car seat`,
            ),
          ),
        ],
      });
    }
  }
  return [...byCampaign.values()];
}

export class NhtsaChildSeatSource implements RecallSourceClient {
  readonly source = 'nhtsa' as const;
  constructor(private readonly opts: { fetch?: FetchLike; baseUrl?: string } = {}) {}

  /** Fetches one catalogue page; returns the normalized recalls and where the next slice starts. */
  async fetchPage(
    offset: number,
  ): Promise<{ records: RecallRecord[]; nextOffset: number | null; total: number }> {
    const u = new URL(this.opts.baseUrl ?? BASE);
    u.searchParams.set('issueType', 'r');
    u.searchParams.set('max', String(PAGE_SIZE));
    u.searchParams.set('offset', String(offset));
    const page = await fetchJson<ChildSeatPage>(u.toString(), {
      fetch: this.opts.fetch,
      timeoutMs: 40_000,
    });
    const rows = (page.results ?? []).filter((r) => (r.recallsCount ?? 0) > 0);
    const { count, total } = page.meta.pagination;
    const nextOffset = offset + count < total && count > 0 ? offset + count : null;
    return { records: normalizeChildSeatRecalls(rows), nextOffset, total };
  }
}

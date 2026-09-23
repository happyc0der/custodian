import {
  addDays,
  recallId,
  todayIso,
  tokenize,
  type Item,
  type ItemCategory,
  type RecallRecord,
} from '@custodian/shared';
import { HttpError, fetchJson, type FetchLike } from './http.js';
import { truncate, type RecallSourceClient } from './types.js';

/** Shape of https://api.fda.gov/{food,drug,device}/enforcement.json results[] */
export interface FdaEnforcement {
  recall_number: string;
  event_id: string;
  product_type: 'Food' | 'Drugs' | 'Devices' | string;
  product_description: string;
  reason_for_recall: string;
  classification: 'Class I' | 'Class II' | 'Class III' | string;
  recalling_firm: string;
  city?: string;
  state?: string;
  recall_initiation_date: string; // YYYYMMDD
  report_date?: string;
  status: string;
  distribution_pattern?: string;
  code_info?: string;
  voluntary_mandated?: string;
}

type Endpoint = 'food' | 'drug' | 'device';
const ENDPOINT_FOR_CATEGORY: Partial<Record<ItemCategory, Endpoint>> = {
  food: 'food',
  medication: 'drug',
  medical_device: 'device',
};
const CATEGORY_FOR_ENDPOINT: Record<Endpoint, ItemCategory> = {
  food: 'food',
  drug: 'medication',
  device: 'medical_device',
};
const BASE = 'https://api.fda.gov';
/** Enforcement reports stay "Ongoing" for a long time; older than this is noise for a household. */
const LOOKBACK_DAYS = 730;

export function isoFromYyyymmdd(s: string): string {
  return /^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : '1970-01-01';
}

export function normalizeFda(r: FdaEnforcement, endpoint: Endpoint): RecallRecord {
  const category = CATEGORY_FOR_ENDPOINT[endpoint];
  const cls = r.classification;
  const severity = cls === 'Class I' ? 'critical' : cls === 'Class II' ? 'high' : 'low';
  const shortProduct = truncate(r.product_description, 90).replace(/…$/, '');
  const lots = r.code_info ? ` Affected lots: ${truncate(r.code_info, 200)}` : '';
  return {
    id: recallId('fda', r.recall_number),
    source: 'fda',
    external_id: r.recall_number,
    title: `${cls} ${category === 'food' ? 'food' : category === 'medication' ? 'drug' : 'device'} recall: ${shortProduct}`,
    summary: truncate(r.product_description),
    hazard: truncate(r.reason_for_recall, 400),
    remedy: `Stop using it and contact ${r.recalling_firm} or the place you bought it for a refund or replacement.${lots}`,
    remedy_options: ['Refund', 'Replacement'],
    contact: [r.recalling_firm, r.city, r.state].filter(Boolean).join(', '),
    url: `https://www.accessdata.fda.gov/scripts/ires/index.cfm?Event=${encodeURIComponent(r.event_id)}`,
    published_on: isoFromYyyymmdd(r.recall_initiation_date),
    products: [{ name: shortProduct, brand: r.recalling_firm }],
    categories: [category],
    severity,
    keywords: [...new Set(tokenize(`${r.product_description} ${r.recalling_firm}`))],
  };
}

/** Picks the 2–3 most distinctive words of an item to search openFDA with (brand + head noun). */
export function fdaQueryTerms(item: Item): string[] {
  const brandTokens = item.brand ? tokenize(item.brand) : [];
  const nameTokens = tokenize(item.name).filter((t) => !brandTokens.includes(t));
  return [...brandTokens.slice(0, 1), ...nameTokens.slice(0, 2)];
}

export class OpenFdaSource implements RecallSourceClient {
  readonly source = 'fda' as const;
  constructor(
    private readonly opts: {
      fetch?: FetchLike;
      baseUrl?: string;
      apiKey?: string;
      now?: () => Date;
    } = {},
  ) {}

  async fetchForItem(item: Item): Promise<RecallRecord[]> {
    const endpoint = ENDPOINT_FOR_CATEGORY[item.category];
    if (!endpoint) return [];
    const terms = fdaQueryTerms(item);
    if (terms.length === 0) return [];
    const today = todayIso(this.opts.now?.() ?? new Date());
    const since = addDays(today, -LOOKBACK_DAYS).replace(/-/g, '');
    const search = [
      `(${terms.map((t) => `product_description:"${t}"`).join('+AND+')})`,
      `recall_initiation_date:[${since}+TO+${today.replace(/-/g, '')}]`,
    ].join('+AND+');
    const u = new URL(`/${endpoint}/enforcement.json`, this.opts.baseUrl ?? BASE);
    // openFDA's `search` grammar uses `+` for spaces; build the query string by hand to keep it un-encoded.
    const qs = [
      `search=${search}`,
      'sort=recall_initiation_date:desc',
      'limit=25',
      this.opts.apiKey ? `api_key=${this.opts.apiKey}` : '',
    ]
      .filter(Boolean)
      .join('&');
    try {
      const data = await fetchJson<{ results: FdaEnforcement[] }>(`${u.toString()}?${qs}`, {
        fetch: this.opts.fetch,
        timeoutMs: 15_000,
      });
      return (data.results ?? []).map((r) => normalizeFda(r, endpoint));
    } catch (err) {
      // openFDA answers 404 for "no matches" — that is a normal empty result, not a failure.
      if (err instanceof HttpError && err.status === 404) return [];
      throw err;
    }
  }
}

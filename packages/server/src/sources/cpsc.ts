import { recallId, tokenize, type RecallRecord } from '@custodian/shared';
import { inferCategory } from '../enrich/categorize.js';
import { fetchJson, type FetchLike } from './http.js';
import { severityFromText } from './severity.js';
import { truncate, type RecallSourceClient } from './types.js';

/** Shape of https://www.saferproducts.gov/RestWebServices/Recall?format=json */
export interface CpscRecall {
  RecallID: number;
  RecallNumber: string;
  RecallDate: string;
  Description: string;
  URL: string;
  Title: string;
  ConsumerContact: string;
  LastPublishDate: string;
  Products: Array<{ Name: string; Description: string; Model: string; Type: string }>;
  Images: Array<{ URL: string; Caption: string }>;
  Hazards: Array<{ Name: string }>;
  Remedies: Array<{ Name: string }>;
  RemedyOptions: Array<{ Option: string }>;
  Manufacturers: Array<{ Name: string }>;
  Importers: Array<{ Name: string }>;
  Retailers: Array<{ Name: string }>;
  ProductUPCs: Array<{ UPC: string }>;
}

const BASE = 'https://www.saferproducts.gov/RestWebServices/Recall';

/** "Joolz USA Inc., of New York, New York" → "Joolz USA" */
function companyName(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const name = raw.split(/,| of /)[0]?.replace(/\b(inc|llc|ltd|corp|co)\b\.?/gi, '').trim();
  return name || undefined;
}

export function normalizeCpsc(r: CpscRecall): RecallRecord {
  const products = (r.Products ?? []).map((p) => ({ name: p.Name, model: p.Model || undefined }));
  const brand = companyName(r.Manufacturers?.[0]?.Name) ?? companyName(r.Importers?.[0]?.Name);
  const hazard = r.Hazards?.map((h) => h.Name).join(' ') || r.Title;
  const titleText = `${r.Title} ${products.map((p) => p.name).join(' ')}`;
  const categories = [...new Set([inferCategory(r.Title), ...products.map((p) => inferCategory(p.name))])].filter((c) => c !== 'other');
  const keywords = new Set<string>([
    ...tokenize(titleText),
    ...products.flatMap((p) => tokenize(`${p.name} ${p.model ?? ''}`)),
    ...(brand ? tokenize(brand) : []),
    ...(r.ProductUPCs ?? []).map((u) => u.UPC).filter(Boolean),
  ]);
  return {
    id: recallId('cpsc', r.RecallNumber || String(r.RecallID)),
    source: 'cpsc',
    external_id: r.RecallNumber || String(r.RecallID),
    title: r.Title.trim(),
    summary: truncate(r.Description ?? ''),
    hazard: truncate(hazard, 400),
    remedy: truncate(r.Remedies?.map((x) => x.Name).join(' ') ?? '', 600),
    remedy_options: (r.RemedyOptions ?? []).map((o) => o.Option).filter(Boolean),
    contact: r.ConsumerContact?.trim() || undefined,
    url: r.URL || undefined,
    image_url: r.Images?.[0]?.URL || undefined,
    published_on: (r.RecallDate ?? r.LastPublishDate).slice(0, 10),
    products: products.map((p) => ({ ...p, brand })),
    categories,
    severity: severityFromText(r.Title, hazard),
    keywords: [...keywords],
  };
}

export class CpscSource implements RecallSourceClient {
  readonly source = 'cpsc' as const;
  constructor(private readonly opts: { fetch?: FetchLike; baseUrl?: string } = {}) {}

  private url(params: Record<string, string>): string {
    const u = new URL(this.opts.baseUrl ?? BASE);
    u.searchParams.set('format', 'json');
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    return u.toString();
  }

  async fetchSince(sinceIso: string): Promise<RecallRecord[]> {
    const rows = await fetchJson<CpscRecall[]>(this.url({ RecallDateStart: sinceIso }), { fetch: this.opts.fetch, timeoutMs: 30_000 });
    return rows.map(normalizeCpsc);
  }

  /** Free-text product search; used when an item is added so an old recall is found without a full backfill. */
  async searchProduct(name: string): Promise<RecallRecord[]> {
    const rows = await fetchJson<CpscRecall[]>(this.url({ ProductName: name }), { fetch: this.opts.fetch, timeoutMs: 30_000 });
    return rows.map(normalizeCpsc);
  }
}

import MiniSearch from 'minisearch';
import type { RecallRecord } from '@custodian/shared';

interface Doc {
  id: string;
  text: string;
}

/**
 * In-memory candidate generator over the recall corpus. MiniSearch gives us
 * fast prefix/fuzzy retrieval; `scoreMatch` then decides confidence. Kept
 * separate from the Store so the voice path never touches the network or disk.
 */
export class RecallIndex {
  private readonly ms = new MiniSearch<Doc>({
    fields: ['text'],
    storeFields: [],
    searchOptions: { prefix: true, fuzzy: 0.15, combineWith: 'OR' },
  });
  private readonly records = new Map<string, RecallRecord>();

  get size(): number {
    return this.records.size;
  }

  add(records: RecallRecord[]): void {
    for (const r of records) {
      if (this.records.has(r.id)) this.ms.discard(r.id);
      this.records.set(r.id, r);
      this.ms.add({ id: r.id, text: docText(r) });
    }
  }

  get(id: string): RecallRecord | undefined {
    return this.records.get(id);
  }

  /** Top-N candidate recalls for a free-text query (item name + brand + model). */
  candidates(query: string, limit = 60): RecallRecord[] {
    if (!query.trim()) return [];
    return this.ms
      .search(query)
      .slice(0, limit)
      .map((hit) => this.records.get(String(hit.id)))
      .filter((r): r is RecallRecord => Boolean(r));
  }

  all(): RecallRecord[] {
    return [...this.records.values()];
  }
}

function docText(r: RecallRecord): string {
  const products = r.products.map((p) => `${p.brand ?? ''} ${p.name} ${p.model ?? ''}`).join(' ');
  return `${r.title} ${products} ${r.keywords.join(' ')}`;
}

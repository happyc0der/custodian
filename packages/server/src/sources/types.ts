import type { Item, RecallRecord, RecallSource } from '@custodian/shared';

/**
 * A recall data source. Sources are only ever called by the sweeper — never
 * from a tool handler — so their latency does not affect the voice path.
 */
export interface RecallSourceClient {
  readonly source: RecallSource;
  /** Records published on/after the given date. Used for the shared index (CPSC). */
  fetchSince?(sinceIso: string): Promise<RecallRecord[]>;
  /** Records relevant to one specific item (vehicle campaigns, FDA enforcement by product text). */
  fetchForItem?(item: Item): Promise<RecallRecord[]>;
}

export function truncate(text: string, max = 700): string {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf('. '), cut.lastIndexOf(' ')))}…`;
}

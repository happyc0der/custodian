import type { Item, ItemCategory, RecallRecord } from '@custodian/shared';

export interface ItemNormalization {
  brand?: string;
  model?: string;
  category?: ItemCategory;
  /** Alternative names a person might say for the same thing. */
  aliases: string[];
  /** A short, spoken-friendly canonical name, e.g. "Graco 4Ever car seat". */
  canonical_name?: string;
}

export interface MatchJudgement {
  applies: 'yes' | 'no' | 'unsure';
  confidence: number;
  reason: string;
}

/**
 * Optional LLM-backed enrichment. Never called on the voice path — only from
 * the sweeper after a tool has already answered.
 */
export interface Enricher {
  normalizeItem(item: Item): Promise<ItemNormalization | undefined>;
  judgeMatch(item: Item, recall: RecallRecord): Promise<MatchJudgement | undefined>;
}

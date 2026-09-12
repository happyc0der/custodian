import { tokenize, type Item, type RecallRecord } from '@custodian/shared';

export interface MatchScore {
  score: number;
  reason: string;
}

/** Confidence at or above which a Match is recorded and surfaced to the household. */
export const MATCH_THRESHOLD = 0.5;
/** Confidence at or above which speech says "there is a recall" rather than "there may be". */
export const LIKELY_THRESHOLD = 0.8;

/** Words too common to identify a product on their own. */
export const GENERIC = new Set(['car', 'seat', 'baby', 'kid', 'child', 'children', 'infant', 'toddler', 'home', 'kitchen', 'portable', 'electric', 'set', 'pack']);

function looksLikeModelCode(t: string): boolean {
  return /\d/.test(t) && /[a-z]/.test(t) && t.length >= 3 || /^[a-z]\d{2,}/.test(t) || /^\d[a-z]/.test(t);
}

/**
 * Explainable, deterministic confidence that a recall applies to an item.
 *
 * Signals, in order of weight: an exact vehicle (make, model, year) match;
 * brand agreement; model/code agreement; overlap of the item's descriptive
 * words with the recall's keywords; category compatibility as a gate.
 */
export function scoreMatch(item: Item, recall: RecallRecord): MatchScore {
  // Vehicles: campaigns are scoped precisely, so it is all or nothing.
  if (item.vehicle || recall.vehicle) {
    if (item.vehicle && recall.vehicle) {
      const same =
        item.vehicle.make.toLowerCase() === recall.vehicle.make.toLowerCase() &&
        item.vehicle.model.toLowerCase() === recall.vehicle.model.toLowerCase() &&
        item.vehicle.year === recall.vehicle.year;
      return same ? { score: 1, reason: `${item.vehicle.year} ${item.vehicle.make} ${item.vehicle.model} is named in this campaign` } : { score: 0, reason: 'different vehicle' };
    }
    return { score: 0, reason: 'vehicle campaign does not apply to a non-vehicle item' };
  }

  const recallTokens = new Set(recall.keywords);
  // Model names from the recall's product list (child-seat catalogues, CPSC "Model" fields) count as model evidence
  // even when they contain no digits, e.g. "Advocate ClickTight".
  const recallModelTokens = new Set(recall.products.flatMap((p) => (p.model ? tokenize(p.model) : [])));
  const brandTokens = new Set(item.brand ? tokenize(item.brand) : []);
  const modelTokens = new Set([...(item.model ? tokenize(item.model) : []), ...tokenize(item.name).filter(looksLikeModelCode)]);
  const descriptive = tokenize([item.name, ...item.aliases].join(' ')).filter((t) => !brandTokens.has(t) && !modelTokens.has(t));
  const distinctive = descriptive.filter((t) => !GENERIC.has(t));

  const brandHit = [...brandTokens].some((t) => recallTokens.has(t));
  const modelHit = [...modelTokens].some((t) => recallTokens.has(t)) || descriptive.some((t) => !GENERIC.has(t) && recallModelTokens.has(t));
  const overlapWords = (distinctive.length ? distinctive : descriptive).filter((t) => recallTokens.has(t));
  const overlap = (distinctive.length ? distinctive : descriptive).length ? overlapWords.length / (distinctive.length || descriptive.length) : 0;

  const categoryOk = recall.categories.length === 0 || item.category === 'other' || recall.categories.includes(item.category);
  const textual = item.category === 'food' || item.category === 'medication';

  // Food and drugs rarely carry a brand the customer says aloud; each distinctive word that appears in the
  // enforcement text is strong evidence ("romaine", "listeria" …). Durable goods need brand/model agreement.
  let score = textual
    ? 0.4 * +brandHit + (overlapWords.length ? Math.min(1, 0.55 + 0.25 * (overlapWords.length - 1)) : 0)
    : 0.45 * +brandHit + 0.35 * +modelHit + 0.3 * overlap;
  if (!textual && !brandHit && !modelHit && overlap < 0.6) score = Math.min(score, 0.3);
  if (!categoryOk) score *= 0.6;
  // A recall announced more than a year before the item was bought almost never applies to a unit bought new
  // (e.g. a 2009 Kidde alarm recall vs. a detector bought in 2025). Halve rather than drop: refurbished and
  // second-hand goods exist.
  const stale = !textual && item.purchased_on && recall.published_on < shiftYears(item.purchased_on, -1);
  if (stale) score *= 0.5;
  score = Math.min(1, +score.toFixed(3));

  const why: string[] = [];
  if (stale) why.push(`recall predates purchase (${recall.published_on})`);
  if (brandHit) why.push(`brand ${item.brand} matches`);
  if (modelHit) why.push(`model ${[...modelTokens].filter((t) => recallTokens.has(t)).join(' ')} matches`);
  if (overlapWords.length) why.push(`mentions ${overlapWords.slice(0, 3).join(', ')}`);
  if (!categoryOk) why.push('different product category');
  return { score, reason: why.join('; ') || 'no meaningful overlap' };
}

/** Text used to pull candidates from the index for an item. */
export function itemQuery(item: Item): string {
  if (item.vehicle) return `${item.vehicle.make} ${item.vehicle.model} ${item.vehicle.year}`;
  return [item.brand, item.model, item.name, ...item.aliases].filter(Boolean).join(' ');
}

function shiftYears(iso: string, years: number): string {
  const y = Number(iso.slice(0, 4)) + years;
  return `${String(y).padStart(4, '0')}${iso.slice(4)}`;
}

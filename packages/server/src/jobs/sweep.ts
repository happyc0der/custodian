import { addDays, todayIso, type Item, type Match, type RecallRecord } from '@custodian/shared';
import { RecallIndex } from '../match/index.js';
import { MATCH_THRESHOLD, itemQuery, scoreMatch } from '../match/score.js';
import { CpscSource } from '../sources/cpsc.js';
import { NhtsaChildSeatSource } from '../sources/nhtsaChildSeat.js';
import { NhtsaVehicleSource } from '../sources/nhtsaVehicle.js';
import { OpenFdaSource } from '../sources/openfda.js';
import type { Store } from '../store/types.js';

export interface SweepSources {
  cpsc: Pick<CpscSource, 'fetchSince' | 'searchProduct'>;
  nhtsaVehicle: Pick<NhtsaVehicleSource, 'fetchForItem'>;
  nhtsaChildSeat: Pick<NhtsaChildSeatSource, 'fetchPage'>;
  openFda: Pick<OpenFdaSource, 'fetchForItem'>;
}

export interface SweepOptions {
  store: Store;
  sources: SweepSources;
  now?: () => Date;
  /** How far back the first CPSC backfill reaches. */
  backfillDays?: number;
  /** Child-seat catalogue pages crawled per sweep (100 seats each). */
  childSeatPagesPerSweep?: number;
  log?: (msg: string) => void;
}

/**
 * Bump when a source normalizer changes shape or keyword rules: the persisted
 * corpus is dropped and re-fetched so old records cannot linger with stale keywords.
 */
export const NORMALIZER_VERSION = '2';
const META_NORMALIZER = 'sweep:normalizer_version';
const META_CPSC_CURSOR = 'sweep:cpsc_since';
const META_CHILDSEAT_OFFSET = 'sweep:childseat_offset';
const META_CHILDSEAT_DONE_AT = 'sweep:childseat_completed_at';
export const META_LAST_COMPLETED = 'sweep:last_completed_at';

/**
 * The background job that does every network call Custodian ever makes:
 * pulls recall feeds into the shared index, refreshes item-specific lookups,
 * and records Match rows the tools read instantly.
 */
export class Sweeper {
  readonly index = new RecallIndex();
  private running: Promise<void> | undefined;
  private readonly now: () => Date;
  private readonly log: (msg: string) => void;

  constructor(private readonly opts: SweepOptions) {
    this.now = opts.now ?? (() => new Date());
    this.log = opts.log ?? ((m) => console.log(`[sweep] ${m}`));
  }

  /** Loads the persisted recall corpus into the in-memory index, discarding it if it predates the current normalizer. */
  async warm(): Promise<void> {
    const store = this.opts.store;
    const version = await store.getMeta(META_NORMALIZER);
    if (version !== NORMALIZER_VERSION) {
      await store.clearRecalls();
      await store.setMeta(META_CPSC_CURSOR, '');
      await store.setMeta(META_CHILDSEAT_OFFSET, '0');
      await store.setMeta(META_NORMALIZER, NORMALIZER_VERSION);
      if (version) this.log(`normalizer changed (${version} → ${NORMALIZER_VERSION}); recall corpus reset`);
    }
    this.index.add(await store.listRecalls());
    this.log(`index warmed with ${this.index.size} recalls`);
  }

  /** Full sweep; concurrent calls share one run. */
  runFull(): Promise<void> {
    if (!this.running) {
      this.running = this.doRunFull().finally(() => {
        this.running = undefined;
      });
    }
    return this.running;
  }

  private async doRunFull(): Promise<void> {
    const started = this.now();
    await this.pullCpsc();
    await this.crawlChildSeats();
    for (const householdId of await this.opts.store.listHouseholdIds()) {
      const items = await this.opts.store.listItems(householdId);
      for (const item of items) {
        await this.refreshItemSources(item);
        await this.matchItem(item);
      }
    }
    await this.opts.store.setMeta(META_LAST_COMPLETED, started.toISOString());
    await this.opts.store.flush();
    this.log(`full sweep done in ${this.now().getTime() - started.getTime()} ms; index=${this.index.size}`);
  }

  /** Targeted sweep after add_item: search sources for this item, then match it. */
  async sweepItem(item: Item): Promise<Match[]> {
    try {
      await this.refreshItemSources(item, { includeCpscSearch: true });
    } catch (err) {
      this.log(`item refresh failed for ${item.name}: ${(err as Error).message}`);
    }
    const matches = await this.matchItem(item);
    const fresh = await this.opts.store.getItem(item.household_id, item.id);
    if (fresh) await this.opts.store.putItem({ ...fresh, enrichment_status: 'done', updated_at: this.now().toISOString() });
    return matches;
  }

  private async pullCpsc(): Promise<void> {
    const store = this.opts.store;
    const today = todayIso(this.now());
    const since = (await store.getMeta(META_CPSC_CURSOR)) || addDays(today, -(this.opts.backfillDays ?? 365));
    try {
      const records = await this.opts.sources.cpsc.fetchSince(since);
      await this.ingest(records);
      // Overlap by a few days: CPSC occasionally back-dates entries.
      await store.setMeta(META_CPSC_CURSOR, addDays(today, -3));
      this.log(`cpsc: ${records.length} records since ${since}`);
    } catch (err) {
      this.log(`cpsc pull failed: ${(err as Error).message}`);
    }
  }

  private async crawlChildSeats(): Promise<void> {
    const store = this.opts.store;
    const pages = this.opts.childSeatPagesPerSweep ?? 10;
    let offset = Number((await store.getMeta(META_CHILDSEAT_OFFSET)) ?? 0);
    const doneAt = await store.getMeta(META_CHILDSEAT_DONE_AT);
    // Re-crawl weekly once complete.
    if (Number.isNaN(offset) || (offset < 0 && doneAt && Date.parse(doneAt) > this.now().getTime() - 7 * 86_400_000)) return;
    if (offset < 0) offset = 0;
    try {
      for (let i = 0; i < pages; i++) {
        const page = await this.opts.sources.nhtsaChildSeat.fetchPage(offset);
        await this.ingest(page.records);
        if (page.nextOffset === null) {
          await store.setMeta(META_CHILDSEAT_OFFSET, '-1');
          await store.setMeta(META_CHILDSEAT_DONE_AT, this.now().toISOString());
          this.log(`child seats: crawl complete (${page.total} seats)`);
          return;
        }
        offset = page.nextOffset;
        await store.setMeta(META_CHILDSEAT_OFFSET, String(offset));
      }
      this.log(`child seats: crawled to offset ${offset}`);
    } catch (err) {
      this.log(`child seat crawl failed at offset ${offset}: ${(err as Error).message}`);
    }
  }

  private async refreshItemSources(item: Item, opts: { includeCpscSearch?: boolean } = {}): Promise<void> {
    const found: RecallRecord[] = [];
    if (item.vehicle) found.push(...(await this.opts.sources.nhtsaVehicle.fetchForItem(item)));
    if (item.category === 'food' || item.category === 'medication' || item.category === 'medical_device') {
      found.push(...(await this.opts.sources.openFda.fetchForItem(item)));
    }
    if (opts.includeCpscSearch && !item.vehicle) {
      const q = [item.brand, item.model].filter(Boolean).join(' ') || item.name;
      found.push(...(await this.opts.sources.cpsc.searchProduct(q)));
    }
    await this.ingest(found);
  }

  private async ingest(records: RecallRecord[]): Promise<void> {
    if (!records.length) return;
    await this.opts.store.putRecalls(records);
    this.index.add(records);
  }

  /** Scores this item against candidate recalls and upserts Match rows. Never overwrites a status the customer set. */
  async matchItem(item: Item): Promise<Match[]> {
    const store = this.opts.store;
    const nowIso = this.now().toISOString();
    const existing = new Map((await store.listMatches(item.household_id)).filter((m) => m.item_id === item.id).map((m) => [m.recall_id, m]));
    const out: Match[] = [];
    const kept = new Set<string>();
    for (const recall of this.index.candidates(itemQuery(item))) {
      const { score, reason } = scoreMatch(item, recall);
      if (score < MATCH_THRESHOLD) continue;
      kept.add(recall.id);
      const prior = existing.get(recall.id);
      const match: Match = prior
        ? { ...prior, confidence: score, reason, updated_at: nowIso }
        : { id: `${item.id}:${recall.id}`, household_id: item.household_id, item_id: item.id, recall_id: recall.id, confidence: score, reason, status: 'new', created_at: nowIso, updated_at: nowIso };
      await store.putMatch(match);
      out.push(match);
    }
    // Scoring got stricter or the item's details changed: retire open matches that no longer qualify.
    for (const prior of existing.values()) {
      if (!kept.has(prior.recall_id) && (prior.status === 'new' || prior.status === 'seen')) await store.deleteMatch(item.household_id, prior.id);
    }
    return out;
  }
}

export function defaultSources(): SweepSources {
  return {
    cpsc: new CpscSource(),
    nhtsaVehicle: new NhtsaVehicleSource(),
    nhtsaChildSeat: new NhtsaChildSeatSource(),
    openFda: new OpenFdaSource(),
  };
}

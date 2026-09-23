import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Household, Item, Match, MaintenanceRule, RecallRecord } from '@custodian/shared';
import type { Store } from './types.js';

interface Snapshot {
  version: 1;
  households: Household[];
  items: Item[];
  matches: Match[];
  rules: MaintenanceRule[];
  recalls: RecallRecord[];
  meta: Record<string, string>;
  auth?: Record<string, { value: string; expiresAt: number }>;
}

/**
 * In-memory store persisted to a single JSON file with debounced writes.
 * Pass `':memory:'` to skip persistence (tests).
 */
export class FileStore implements Store {
  private households = new Map<string, Household>();
  private items = new Map<string, Item>();
  private matches = new Map<string, Match>();
  private rules = new Map<string, MaintenanceRule>();
  private recalls = new Map<string, RecallRecord>();
  private meta = new Map<string, string>();
  private auth = new Map<string, { value: string; expiresAt: number }>();
  private dirty = false;
  private timer: NodeJS.Timeout | undefined;
  private writing: Promise<void> = Promise.resolve();

  constructor(
    private readonly filePath: string,
    private readonly debounceMs = 250,
  ) {}

  static async open(filePath: string): Promise<FileStore> {
    const store = new FileStore(filePath);
    await store.load();
    return store;
  }

  private get persistent(): boolean {
    return this.filePath !== ':memory:';
  }

  async load(): Promise<void> {
    if (!this.persistent) return;
    try {
      const raw = await readFile(this.filePath, 'utf8');
      const snap = JSON.parse(raw) as Snapshot;
      for (const h of snap.households ?? []) this.households.set(h.id, h);
      for (const i of snap.items ?? []) this.items.set(i.id, i);
      for (const m of snap.matches ?? []) this.matches.set(m.id, m);
      for (const r of snap.rules ?? []) this.rules.set(r.id, r);
      for (const r of snap.recalls ?? []) this.recalls.set(r.id, r);
      for (const [k, v] of Object.entries(snap.meta ?? {})) this.meta.set(k, v);
      for (const [k, v] of Object.entries(snap.auth ?? {}))
        if (v.expiresAt > Date.now()) this.auth.set(k, v);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
  }

  private schedule(): void {
    this.dirty = true;
    if (!this.persistent) return;
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.flush();
    }, this.debounceMs);
    this.timer.unref?.();
  }

  async flush(): Promise<void> {
    if (!this.persistent || !this.dirty) return;
    this.dirty = false;
    const snap: Snapshot = {
      version: 1,
      households: [...this.households.values()],
      items: [...this.items.values()],
      matches: [...this.matches.values()],
      rules: [...this.rules.values()],
      recalls: [...this.recalls.values()],
      meta: Object.fromEntries(this.meta),
      auth: Object.fromEntries([...this.auth].filter(([, v]) => v.expiresAt > Date.now())),
    };
    // Serialise writes so a slow disk never interleaves two snapshots.
    this.writing = this.writing.then(async () => {
      await mkdir(path.dirname(this.filePath), { recursive: true });
      const tmp = `${this.filePath}.tmp`;
      await writeFile(tmp, JSON.stringify(snap));
      const { rename } = await import('node:fs/promises');
      await rename(tmp, this.filePath);
    });
    await this.writing;
  }

  /* households */
  async getHousehold(id: string) {
    return this.households.get(id);
  }
  async putHousehold(h: Household) {
    this.households.set(h.id, h);
    this.schedule();
  }
  async listHouseholdIds() {
    return [...this.households.keys()];
  }

  /* items */
  async listItems(householdId: string) {
    return [...this.items.values()].filter((i) => i.household_id === householdId);
  }
  async getItem(householdId: string, itemId: string) {
    const item = this.items.get(itemId);
    return item && item.household_id === householdId ? item : undefined;
  }
  async putItem(item: Item) {
    this.items.set(item.id, item);
    this.schedule();
  }
  async deleteItem(householdId: string, itemId: string) {
    const item = await this.getItem(householdId, itemId);
    if (!item) return false;
    this.items.delete(itemId);
    this.schedule();
    return true;
  }

  /* matches */
  async listMatches(householdId: string) {
    return [...this.matches.values()].filter((m) => m.household_id === householdId);
  }
  async getMatch(householdId: string, matchId: string) {
    const m = this.matches.get(matchId);
    return m && m.household_id === householdId ? m : undefined;
  }
  async putMatch(match: Match) {
    this.matches.set(match.id, match);
    this.schedule();
  }
  async deleteMatch(householdId: string, matchId: string) {
    const m = await this.getMatch(householdId, matchId);
    if (!m) return false;
    this.matches.delete(matchId);
    this.schedule();
    return true;
  }
  async deleteMatchesForItem(householdId: string, itemId: string) {
    for (const [id, m] of this.matches) {
      if (m.household_id === householdId && m.item_id === itemId) this.matches.delete(id);
    }
    this.schedule();
  }

  /* rules */
  async listRules(householdId: string) {
    return [...this.rules.values()].filter((r) => r.household_id === householdId);
  }
  async getRule(householdId: string, ruleId: string) {
    const r = this.rules.get(ruleId);
    return r && r.household_id === householdId ? r : undefined;
  }
  async putRule(rule: MaintenanceRule) {
    this.rules.set(rule.id, rule);
    this.schedule();
  }
  async deleteRule(householdId: string, ruleId: string) {
    const r = await this.getRule(householdId, ruleId);
    if (!r) return false;
    this.rules.delete(ruleId);
    this.schedule();
    return true;
  }
  async deleteRulesForItem(householdId: string, itemId: string) {
    for (const [id, r] of this.rules) {
      if (r.household_id === householdId && r.item_id === itemId) this.rules.delete(id);
    }
    this.schedule();
  }

  /* recalls */
  async getRecall(id: string) {
    return this.recalls.get(id);
  }
  async putRecalls(records: RecallRecord[]) {
    for (const r of records) this.recalls.set(r.id, r);
    if (records.length) this.schedule();
  }
  async listRecalls() {
    return [...this.recalls.values()];
  }
  async clearRecalls() {
    this.recalls.clear();
    this.schedule();
  }

  /* auth */
  async getAuth(key: string) {
    const v = this.auth.get(key);
    if (!v) return undefined;
    if (v.expiresAt <= Date.now()) {
      this.auth.delete(key);
      return undefined;
    }
    return v.value;
  }
  async putAuth(key: string, value: string, expiresAt: number) {
    this.auth.set(key, { value, expiresAt });
    this.schedule();
  }
  async deleteAuth(key: string) {
    this.auth.delete(key);
    this.schedule();
  }

  /* meta */
  async getMeta(key: string) {
    return this.meta.get(key);
  }
  async setMeta(key: string, value: string) {
    this.meta.set(key, value);
    this.schedule();
  }
}

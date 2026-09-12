import type { Household, Item, Match, MaintenanceRule, RecallRecord } from '@custodian/shared';

/**
 * Persistence boundary. Every method is scoped by household except the recall
 * index, which is shared across households (public data).
 *
 * Implementations: FileStore (dev/tests) and DynamoStore (AWS).
 */
export interface Store {
  getHousehold(id: string): Promise<Household | undefined>;
  putHousehold(h: Household): Promise<void>;

  listItems(householdId: string): Promise<Item[]>;
  getItem(householdId: string, itemId: string): Promise<Item | undefined>;
  putItem(item: Item): Promise<void>;
  deleteItem(householdId: string, itemId: string): Promise<boolean>;

  listMatches(householdId: string): Promise<Match[]>;
  getMatch(householdId: string, matchId: string): Promise<Match | undefined>;
  putMatch(match: Match): Promise<void>;
  deleteMatch(householdId: string, matchId: string): Promise<boolean>;
  deleteMatchesForItem(householdId: string, itemId: string): Promise<void>;

  listRules(householdId: string): Promise<MaintenanceRule[]>;
  getRule(householdId: string, ruleId: string): Promise<MaintenanceRule | undefined>;
  putRule(rule: MaintenanceRule): Promise<void>;
  deleteRule(householdId: string, ruleId: string): Promise<boolean>;
  deleteRulesForItem(householdId: string, itemId: string): Promise<void>;

  getRecall(id: string): Promise<RecallRecord | undefined>;
  putRecalls(records: RecallRecord[]): Promise<void>;
  listRecalls(): Promise<RecallRecord[]>;
  /** Drops the shared recall corpus (used when the normalizer changes and records must be re-fetched). */
  clearRecalls(): Promise<void>;

  /** Small key/value bag for sweep cursors and similar bookkeeping. */
  getMeta(key: string): Promise<string | undefined>;
  setMeta(key: string, value: string): Promise<void>;

  /** Short-lived auth artefacts (codes, refresh tokens, pending requests) keyed by opaque id, with expiry. */
  getAuth(key: string): Promise<string | undefined>;
  putAuth(key: string, value: string, expiresAt: number): Promise<void>;
  deleteAuth(key: string): Promise<void>;

  /** All household ids known to the store (used by the sweeper). */
  listHouseholdIds(): Promise<string[]>;

  flush(): Promise<void>;
}

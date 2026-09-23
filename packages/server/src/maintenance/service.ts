import {
  addDays,
  daysBetween,
  newId,
  todayIso,
  type Item,
  type MaintenanceRule,
} from '@custodian/shared';
import type { Store } from '../store/types.js';
import { defaultRulesFor, isOneShot } from './defaults.js';

/** Creates the category defaults for a freshly added item (idempotent per kind). */
export async function applyDefaultRules(
  store: Store,
  item: Item,
  now: Date,
): Promise<MaintenanceRule[]> {
  const today = todayIso(now);
  const existing = await store.listRules(item.household_id);
  const have = new Set(existing.filter((r) => r.item_id === item.id).map((r) => r.kind));
  const created: MaintenanceRule[] = [];
  for (const t of defaultRulesFor(item, today)) {
    if (have.has(t.kind)) continue;
    // An interval reminder computed from an old purchase date would start out absurdly overdue
    // ("663 days"); assume it was kept up until now and start the cycle from today instead.
    if (t.interval_days && daysBetween(t.next_due, today) > t.interval_days)
      t.next_due = addDays(today, t.interval_days);
    const rule: MaintenanceRule = {
      id: newId('rule'),
      household_id: item.household_id,
      item_id: item.id,
      kind: t.kind,
      label: t.label,
      interval_days: t.interval_days,
      next_due: t.next_due,
      created_at: now.toISOString(),
    };
    await store.putRule(rule);
    created.push(rule);
  }
  return created;
}

/** Marks a rule done on `doneOn`; interval rules roll forward, one-shot rules are removed. Returns the rule as it stands afterwards (or undefined if removed). */
export async function completeRule(
  store: Store,
  rule: MaintenanceRule,
  doneOn: string,
): Promise<MaintenanceRule | undefined> {
  if (isOneShot(rule.kind) || !rule.interval_days) {
    await store.deleteRule(rule.household_id, rule.id);
    return undefined;
  }
  const updated: MaintenanceRule = {
    ...rule,
    last_done: doneOn,
    next_due: addDays(doneOn, rule.interval_days),
  };
  await store.putRule(updated);
  return updated;
}

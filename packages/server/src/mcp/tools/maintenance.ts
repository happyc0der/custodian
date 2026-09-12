import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import {
  LogMaintenanceOutput,
  MaintenanceKind,
  SetReminderOutput,
  WhatsDueOutput,
  addDays,
  coerceIsoDate,
  joinNatural,
  newId,
  normalizeName,
  todayIso,
  type MaintenanceRule,
  type MaintenanceView,
} from '@custodian/shared';
import { requireHousehold } from '../../auth/context.js';
import { completeRule } from '../../maintenance/service.js';
import { defineTool } from '../define.js';
import type { ServerDeps } from '../deps.js';
import { ICONS } from '../icons.js';
import { fail, ok } from '../result.js';
import { toMaintenanceView } from '../views.js';
import { findItemsByName } from './inventory.js';

const DEFAULT_HORIZON = 30;

function speakDue(v: MaintenanceView): string {
  const what = `${v.label.toLowerCase().replace(/\s*\(.*\)$/, '')} for your ${v.item.name}`;
  if (v.days_until_due < 0) return `${what} is ${-v.days_until_due === 1 ? 'a day' : `${-v.days_until_due} days`} overdue`;
  if (v.days_until_due === 0) return `${what} is due today`;
  return `${what} is due in ${v.days_until_due === 1 ? 'a day' : `${v.days_until_due} days`}`;
}

export function registerMaintenanceTools(server: McpServer, deps: ServerDeps): void {
  defineTool(server, deps, {
    name: 'whats_due',
    title: 'Upcoming maintenance',
    description:
      'List maintenance and expiry reminders that are overdue or coming up for things the household owns: smoke-detector batteries, water and air filters, car-seat expiry, vehicle service, warranties, and any custom reminders. ' +
      'Call when the customer asks what needs doing, what is due, or whether something needs replacing.',
    inputSchema: z.object({
      horizon_days: z.number().int().min(1).max(365).optional().describe('How far ahead to look; default 30'),
    }),
    outputSchema: WhatsDueOutput,
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    icons: ICONS.calendar,
    ui: { resourceUri: 'ui://custodian/maintenance.html', displayModes: ['inline', 'fullscreen'] },
    async handler(input) {
      const householdId = requireHousehold();
      const horizon = input.horizon_days ?? DEFAULT_HORIZON;
      const today = todayIso(deps.now());
      const until = addDays(today, horizon);
      const items = new Map((await deps.store.listItems(householdId)).map((i) => [i.id, i]));
      const views = (await deps.store.listRules(householdId))
        .filter((r) => r.next_due <= until)
        .map((r) => {
          const item = items.get(r.item_id);
          return item ? toMaintenanceView(r, item, today) : undefined;
        })
        .filter((v): v is MaintenanceView => Boolean(v))
        .sort((a, b) => a.days_until_due - b.days_until_due);
      const due = views.filter((v) => v.days_until_due <= 0);
      const upcoming = views.filter((v) => v.days_until_due > 0);

      let speech: string;
      if (!views.length) {
        speech = items.size
          ? `Nothing is due in the next ${horizon} days. You're all caught up.`
          : "I'm not tracking anything yet, so there's nothing due. Tell me what you own and I'll set up reminders.";
      } else {
        const parts: string[] = [];
        if (due.length) parts.push(`${due.length === 1 ? 'One thing needs' : `${due.length} things need`} attention now: ${joinNatural(due.slice(0, 3).map(speakDue))}${due.length > 3 ? ', and more on screen' : ''}.`);
        if (upcoming.length) parts.push(`${due.length ? 'Coming up' : `In the next ${horizon} days`}: ${joinNatural(upcoming.slice(0, 3).map(speakDue))}${upcoming.length > 3 ? ', and more on screen' : ''}.`);
        speech = parts.join(' ');
      }
      return ok(speech, { horizon_days: horizon, due, upcoming });
    },
  });

  defineTool(server, deps, {
    name: 'log_maintenance',
    title: 'Log completed maintenance',
    description:
      'Record that a maintenance task was done ("I changed the smoke detector batteries", "the car was serviced today") so the reminder rolls forward. ' +
      'Give the item name; add the task if the item has more than one reminder. If several reminders could apply, the result lists candidates and nothing is logged — ask which one.',
    inputSchema: z.object({
      item_name: z.string().describe('The item as the customer said it'),
      task: z.string().optional().describe('Which reminder: a kind (replace_battery, replace_filter, service, inspect…) or words from its label'),
      date: z.string().optional().describe('When it was done; defaults to today'),
    }),
    outputSchema: LogMaintenanceOutput,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    icons: ICONS.wrench,
    async handler(input) {
      const householdId = requireHousehold();
      const today = todayIso(deps.now());
      const doneOn = coerceIsoDate(input.date) ?? today;
      const candidates = await findItemsByName(deps, householdId, input.item_name);
      if (!candidates.length) return fail(`I don't have ${input.item_name} in your inventory, so I can't log anything for it.`);
      if (candidates.length > 1) {
        return ok(`I have ${candidates.length} items that could be that: ${joinNatural(candidates.map((c) => c.name))}. Which one?`, { candidates: [] });
      }
      const item = candidates[0]!;
      let rules = (await deps.store.listRules(householdId)).filter((r) => r.item_id === item.id);
      if (!rules.length) return fail(`There are no reminders set up for your ${item.name} yet. Want me to add one?`);
      if (input.task) {
        // Most specific tier that yields anything wins: exact kind, then label words, then kind words.
        const t = normalizeName(input.task);
        const tiers = [
          rules.filter((r) => r.kind === input.task),
          rules.filter((r) => normalizeName(r.label).includes(t)),
          rules.filter((r) => t.split(' ').some((w) => r.kind.includes(w))),
        ];
        const hit = tiers.find((tier) => tier.length > 0);
        if (hit) rules = hit;
      }
      if (rules.length > 1) {
        return ok(`Which one did you do for your ${item.name}: ${joinNatural(rules.map((r) => r.label.toLowerCase()))}?`, {
          candidates: rules.map((r) => toMaintenanceView(r, item, today)),
        });
      }
      const rule = rules[0]!;
      const after = await completeRule(deps.store, rule, doneOn);
      if (!after) {
        return ok(`Logged. That was a one-time reminder for your ${item.name}, so I've cleared it.`, { candidates: [] });
      }
      const view = toMaintenanceView(after, item, today);
      return ok(`Logged. I'll remind you to ${rule.label.toLowerCase()} for your ${item.name} again in about ${Math.round((rule.interval_days ?? 0) / 30)} months.`, {
        rule: view,
        next_due: after.next_due,
        candidates: [],
      });
    },
  });

  defineTool(server, deps, {
    name: 'set_maintenance_reminder',
    title: 'Add a maintenance reminder',
    description:
      'Create a custom reminder for an item: recurring ("change the furnace filter every 3 months") or one-off ("the extended warranty ends next June"). ' +
      'Use when the customer asks to be reminded about something for a product they own.',
    inputSchema: z.object({
      item_name: z.string().describe('The item as the customer said it'),
      label: z.string().min(2).describe('What to do, e.g. "Descale the espresso machine"'),
      every_days: z.number().int().min(1).max(3650).optional().describe('Repeat interval in days, for recurring reminders'),
      due_on: z.string().optional().describe('First (or only) due date; defaults to today + every_days'),
      kind: MaintenanceKind.optional().describe('Reminder kind; defaults to custom'),
    }),
    outputSchema: SetReminderOutput,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    icons: ICONS.calendar,
    async handler(input) {
      const householdId = requireHousehold();
      const today = todayIso(deps.now());
      const candidates = await findItemsByName(deps, householdId, input.item_name);
      if (!candidates.length) return fail(`I don't have ${input.item_name} in your inventory. Add it first and I'll set the reminder.`);
      if (candidates.length > 1) return fail(`I have ${candidates.length} items that could be that: ${joinNatural(candidates.map((c) => c.name))}. Which one?`);
      const item = candidates[0]!;
      const due = coerceIsoDate(input.due_on) ?? (input.every_days ? addDays(today, input.every_days) : undefined);
      if (!due) return fail('Tell me either how often to remind you or a date, and I will set it up.');
      const rule: MaintenanceRule = {
        id: newId('rule'),
        household_id: householdId,
        item_id: item.id,
        kind: input.kind ?? 'custom',
        label: input.label.trim(),
        interval_days: input.every_days,
        next_due: due,
        created_at: deps.now().toISOString(),
      };
      await deps.store.putRule(rule);
      const view = toMaintenanceView(rule, item, today);
      const when = view.days_until_due <= 0 ? 'today' : view.days_until_due === 1 ? 'tomorrow' : `in ${view.days_until_due} days`;
      return ok(`Done. I'll remind you to ${rule.label.toLowerCase()} for your ${item.name} ${when}${input.every_days ? `, and every ${input.every_days} days after that` : ''}.`, { rule: view });
    },
  });
}

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import { BriefingOutput, addDays, joinNatural, pluralize, todayIso, type MaintenanceView, type RecallMatchView } from '@custodian/shared';
import { requireHousehold } from '../../auth/context.js';
import { defineTool } from '../define.js';
import type { ServerDeps } from '../deps.js';
import { ICONS } from '../icons.js';
import { ok } from '../result.js';
import { toMaintenanceView, toMatchView } from '../views.js';
import { ensureHousehold } from './inventory.js';

const DUE_SOON_DAYS = 30;

export function registerBriefingTool(server: McpServer, deps: ServerDeps): void {
  defineTool(server, deps, {
    name: 'household_briefing',
    title: 'Household safety briefing',
    description:
      'Summarise what needs the household\'s attention: new product recalls matching things they own, and maintenance that is due or overdue (smoke-detector batteries, filters, expiring car seats, warranties). ' +
      'Call when the customer asks "anything I should know?", "any recalls?", "what needs doing?", or asks for a home safety check. Marks the reported recalls as seen.',
    inputSchema: z.object({}),
    outputSchema: BriefingOutput,
    annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: false },
    icons: ICONS.home,
    async handler() {
      const householdId = requireHousehold();
      await ensureHousehold(deps, householdId);
      const household = (await deps.store.getHousehold(householdId))!;
      const today = todayIso(deps.now());
      const [items, matches, rules] = await Promise.all([
        deps.store.listItems(householdId),
        deps.store.listMatches(householdId),
        deps.store.listRules(householdId),
      ]);
      const itemById = new Map(items.map((i) => [i.id, i]));

      const newRecalls: RecallMatchView[] = [];
      let openRecalls = 0;
      for (const m of matches) {
        if (m.status === 'new' || m.status === 'seen') openRecalls += 1;
        if (m.status !== 'new') continue;
        const item = itemById.get(m.item_id);
        const recall = await deps.store.getRecall(m.recall_id);
        if (!item || !recall) continue;
        newRecalls.push(toMatchView(m, item, recall));
      }
      newRecalls.sort((a, b) => severityRank(a.recall.severity) - severityRank(b.recall.severity));

      const horizon = addDays(today, DUE_SOON_DAYS);
      const due: MaintenanceView[] = rules
        .filter((r) => r.next_due <= horizon)
        .map((r) => {
          const item = itemById.get(r.item_id);
          return item ? toMaintenanceView(r, item, today) : undefined;
        })
        .filter((v): v is MaintenanceView => Boolean(v))
        .sort((a, b) => a.days_until_due - b.days_until_due);

      const lastSweep = await deps.store.getMeta('sweep:last_completed_at');
      const since = household.last_briefed_at;

      // Reporting marks recalls as seen, so the next briefing only surfaces what is new.
      const nowIso = deps.now().toISOString();
      for (const m of matches) {
        if (m.status === 'new') await deps.store.putMatch({ ...m, status: 'seen', updated_at: nowIso });
      }
      await deps.store.putHousehold({ ...household, last_briefed_at: nowIso });

      const speech = buildSpeech({ itemCount: items.length, newRecalls, openRecalls, due });
      return ok(speech, {
        since,
        new_recalls: newRecalls,
        open_recalls: openRecalls,
        due_maintenance: due,
        item_count: items.length,
        last_sweep_at: lastSweep,
      });
    },
  });
}

function severityRank(s: RecallMatchView['recall']['severity']): number {
  return { critical: 0, high: 1, moderate: 2, low: 3 }[s];
}

function buildSpeech(b: { itemCount: number; newRecalls: RecallMatchView[]; openRecalls: number; due: MaintenanceView[] }): string {
  const parts: string[] = [];
  if (b.newRecalls.length) {
    const first = b.newRecalls[0]!;
    const lead = b.newRecalls.length === 1
      ? `Heads up: there's a new recall on your ${first.item.name}.`
      : `Heads up: ${b.newRecalls.length} things you own have new recalls, including your ${first.item.name}.`;
    parts.push(`${lead} ${first.recall.hazard.split(/(?<=\.)\s/)[0] ?? ''} ${shortRemedy(first.recall.remedy_options)}`.trim());
  } else if (b.openRecalls) {
    parts.push(`No new recalls, but ${pluralize(b.openRecalls, 'recall is', 'recalls are')} still open from before.`);
  } else if (b.itemCount) {
    parts.push(`Good news: no recalls on any of your ${b.itemCount} tracked items.`);
  } else {
    parts.push("I'm not tracking anything for you yet. Tell me what you own and I'll start watching for recalls.");
  }
  if (b.due.length) {
    const overdue = b.due.filter((d) => d.overdue);
    const soon = b.due.filter((d) => !d.overdue);
    const bits: string[] = [];
    if (overdue.length) bits.push(`${joinNatural(overdue.slice(0, 2).map((d) => d.label.toLowerCase()))} ${overdue.length === 1 ? 'is' : 'are'} overdue`);
    if (soon.length) bits.push(`${joinNatural(soon.slice(0, 2).map((d) => d.label.toLowerCase()))} ${soon.length === 1 ? 'is' : 'are'} due soon`);
    parts.push(`Also, ${bits.join(', and ')}.`);
  }
  return parts.join(' ');
}

function shortRemedy(options: string[]): string {
  if (!options.length) return 'Want the details?';
  const o = options.map((x) => x.toLowerCase());
  if (o.some((x) => x.includes('refund'))) return 'The maker is offering a refund. Want the details?';
  if (o.some((x) => x.includes('repair'))) return 'There is a free repair. Want the details?';
  if (o.some((x) => x.includes('replace'))) return 'They will replace it for free. Want the details?';
  return 'Want the details?';
}

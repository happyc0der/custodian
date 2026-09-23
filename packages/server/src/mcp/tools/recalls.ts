import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import {
  AcknowledgeRecallOutput,
  CheckRecallsOutput,
  MatchStatus,
  RecallDetailsOutput,
  joinNatural,
  pluralize,
  type Item,
  type Match,
  type RecallMatchView,
} from '@custodian/shared';
import { requireHousehold } from '../../auth/context.js';
import { META_LAST_COMPLETED } from '../../jobs/sweep.js';
import { LIKELY_THRESHOLD } from '../../match/score.js';
import { defineTool } from '../define.js';
import type { ServerDeps } from '../deps.js';
import { ICONS } from '../icons.js';
import { fail, ok } from '../result.js';
import { toItemSummary, toMatchView } from '../views.js';
import { findItemsByName } from './inventory.js';

const OPEN: ReadonlySet<Match['status']> = new Set(['new', 'seen']);

async function viewsFor(
  deps: ServerDeps,
  householdId: string,
  matches: Match[],
  items: Map<string, Item>,
): Promise<RecallMatchView[]> {
  const views: RecallMatchView[] = [];
  for (const m of matches) {
    const item = items.get(m.item_id);
    const recall = await deps.store.getRecall(m.recall_id);
    if (item && recall) views.push(toMatchView(m, item, recall));
  }
  const rank = { critical: 0, high: 1, moderate: 2, low: 3 };
  return views.sort(
    (a, b) => rank[a.recall.severity] - rank[b.recall.severity] || b.confidence - a.confidence,
  );
}

function speakMatch(v: RecallMatchView): string {
  const verb = v.confidence >= LIKELY_THRESHOLD ? 'is' : 'may be';
  const hazard = v.recall.hazard.split(/(?<=\.)\s/)[0] ?? v.recall.hazard;
  return `Your ${v.item.name} ${verb} affected by a recall: ${hazard}`;
}

function speakRemedy(v: RecallMatchView): string {
  const o = v.recall.remedy_options.map((x) => x.toLowerCase());
  if (o.some((x) => x.includes('refund'))) return 'The maker is offering a refund.';
  if (o.some((x) => x.includes('replace'))) return 'They will replace it free of charge.';
  if (o.some((x) => x.includes('repair') || x.includes('kit'))) return 'There is a free repair.';
  if (o.some((x) => x.includes('over-the-air'))) return 'The fix is a free software update.';
  return '';
}

export function registerRecallTools(server: McpServer, deps: ServerDeps): void {
  defineTool(server, deps, {
    name: 'check_recalls',
    title: 'Check for recalls',
    description:
      'Report safety recalls (CPSC, NHTSA, FDA) that match things this household owns. ' +
      'Omit item_name to check everything; pass it to check one product ("is my car seat recalled?"). ' +
      "Results are precomputed by Custodian's continuous recall sweep, so this is instant. Includes the remedy in plain language.",
    inputSchema: z.object({
      item_name: z
        .string()
        .optional()
        .describe('A specific item to check, as the customer said it'),
      include_resolved: z
        .boolean()
        .optional()
        .describe('Also include recalls the customer already handled'),
    }),
    outputSchema: CheckRecallsOutput,
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    icons: ICONS.shield,
    ui: 'app',
    async handler(input) {
      const householdId = requireHousehold();
      const items = new Map((await deps.store.listItems(householdId)).map((i) => [i.id, i]));
      const lastSweep = await deps.store.getMeta(META_LAST_COMPLETED);
      let scopeItems = [...items.values()];
      let scope: 'household' | 'item' = 'household';
      let target: Item | undefined;
      if (input.item_name) {
        const candidates = await findItemsByName(deps, householdId, input.item_name);
        if (candidates.length === 0) {
          return fail(
            `I don't have ${input.item_name} in your inventory, so I can't check it. Want me to add it and start watching?`,
          );
        }
        if (candidates.length > 1) {
          return ok(
            `I have ${candidates.length} items that could be that: ${joinNatural(candidates.map((c) => c.name))}. Which one do you mean?`,
            {
              scope: 'item',
              candidates: candidates.map(toItemSummary),
              matches: [],
              checked_items: 0,
              last_sweep_at: lastSweep,
            },
          );
        }
        target = candidates[0];
        scopeItems = [target!];
        scope = 'item';
      }
      const ids = new Set(scopeItems.map((i) => i.id));
      const all = (await deps.store.listMatches(householdId)).filter(
        (m) => ids.has(m.item_id) && (input.include_resolved || OPEN.has(m.status)),
      );
      const views = await viewsFor(deps, householdId, all, items);

      let speech: string;
      if (views.length === 0) {
        speech = target
          ? `Good news: I haven't found any recalls for your ${target.name}. I'll keep checking.`
          : scopeItems.length
            ? `Good news: no open recalls on any of your ${pluralize(scopeItems.length, 'tracked item')}.`
            : "I'm not tracking anything yet, so there's nothing to check. Tell me what you own.";
      } else {
        const first = views[0]!;
        const more =
          views.length > 1
            ? ` There ${views.length - 1 === 1 ? 'is one more' : `are ${views.length - 1} more`} on screen.`
            : '';
        speech = `${speakMatch(first)} ${speakRemedy(first)}${more}`.trim();
      }
      return ok(speech, {
        scope,
        item: target ? toItemSummary(target) : undefined,
        candidates: [],
        matches: views,
        checked_items: scopeItems.length,
        last_sweep_at: lastSweep,
      });
    },
  });

  defineTool(server, deps, {
    name: 'get_recall_details',
    title: 'Recall details',
    description:
      'Full details of one recall: what is wrong, exactly which models are affected, what the manufacturer will do, and how to contact them. ' +
      'Use the recall_id from check_recalls or household_briefing after the customer asks for details, the remedy, or who to call.',
    inputSchema: z.object({
      recall_id: z.string().describe('Recall id, e.g. cpsc:26568 or nhtsa:20V439000'),
    }),
    outputSchema: RecallDetailsOutput,
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    icons: ICONS.detail,
    ui: 'app',
    async handler(input) {
      const householdId = requireHousehold();
      const recall = await deps.store.getRecall(input.recall_id);
      if (!recall)
        return fail("I couldn't find that recall. Try asking me to check recalls again.");
      const match = (await deps.store.listMatches(householdId)).find(
        (m) => m.recall_id === recall.id,
      );
      const item = match ? await deps.store.getItem(householdId, match.item_id) : undefined;
      const view = match && item ? toMatchView(match, item, recall) : undefined;
      const contact = recall.contact
        ? ` You can reach them at ${recall.contact
            .replace(/https?:\/\/\S+|www\.\S+/gi, '')
            .replace(/\s+/g, ' ')
            .trim()}`
        : '';
      const speech = `${recall.remedy}${contact}`.trim();
      return ok(speech, { match: view, recall });
    },
  });

  defineTool(server, deps, {
    name: 'acknowledge_recall',
    title: "Update a recall's status",
    description:
      'Record what the household did about a recall so Custodian stops nagging: they requested the remedy, disposed of the product, or confirmed their unit is not affected (different lot or model). ' +
      'Use after the customer says they handled it.',
    inputSchema: z.object({
      recall_id: z.string().describe('Recall id from a previous result'),
      action: MatchStatus.exclude(['new', 'seen']).describe(
        'remedy_requested | disposed | not_affected',
      ),
    }),
    outputSchema: AcknowledgeRecallOutput,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    icons: ICONS.check,
    async handler(input) {
      const householdId = requireHousehold();
      const match = (await deps.store.listMatches(householdId)).find(
        (m) => m.recall_id === input.recall_id,
      );
      if (!match)
        return fail(
          "I don't have that recall linked to anything you own, so there's nothing to update.",
        );
      const item = await deps.store.getItem(householdId, match.item_id);
      const recall = await deps.store.getRecall(match.recall_id);
      if (!item || !recall) return fail("I couldn't load that recall. Try again in a moment.");
      const updated: Match = {
        ...match,
        status: input.action,
        updated_at: deps.now().toISOString(),
      };
      await deps.store.putMatch(updated);
      const speech = {
        remedy_requested: `Noted, you've requested the remedy for your ${item.name}. I'll stop flagging it.`,
        disposed: `Got it, your ${item.name} is gone. I've closed that recall and stopped tracking the item's recall.`,
        not_affected: `Okay, I've marked your ${item.name} as not affected by that recall.`,
      }[input.action];
      return ok(speech, { match: toMatchView(updated, item, recall) });
    },
  });
}

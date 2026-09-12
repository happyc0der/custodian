import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import {
  AddItemOutput,
  ItemCategory,
  ListInventoryOutput,
  RemoveItemOutput,
  Vehicle,
  coerceIsoDate,
  joinNatural,
  newId,
  normalizeName,
  pluralize,
  todayIso,
  type Item,
} from '@custodian/shared';
import { requireHousehold } from '../../auth/context.js';
import { defaultAliases, inferBrand, inferCategory } from '../../enrich/categorize.js';
import { defineTool } from '../define.js';
import type { ServerDeps } from '../deps.js';
import { ICONS } from '../icons.js';
import { fail, ok } from '../result.js';
import { spokenItem, toItemSummary } from '../views.js';

const CATEGORY_LABEL: Record<Item['category'], [string, string]> = {
  car_seat: ['car seat', 'car seats'],
  stroller: ['stroller', 'strollers'],
  crib: ['crib', 'cribs'],
  toy: ['toy', 'toys'],
  appliance: ['appliance', 'appliances'],
  electronics: ['electronic device', 'electronic devices'],
  furniture: ['piece of furniture', 'pieces of furniture'],
  vehicle: ['vehicle', 'vehicles'],
  food: ['food item', 'food items'],
  medication: ['medication', 'medications'],
  medical_device: ['medical device', 'medical devices'],
  tool: ['tool', 'tools'],
  heater: ['heater', 'heaters'],
  smoke_detector: ['smoke detector', 'smoke detectors'],
  water_filter: ['water filter', 'water filters'],
  hvac_filter: ['air filter', 'air filters'],
  other: ['item', 'items'],
};

export async function ensureHousehold(deps: ServerDeps, householdId: string): Promise<void> {
  if (await deps.store.getHousehold(householdId)) return;
  await deps.store.putHousehold({ id: householdId, name: 'My home', created_at: deps.now().toISOString() });
}

/** Case/punctuation-insensitive lookup of an item by spoken name; returns all plausible candidates. */
export async function findItemsByName(deps: ServerDeps, householdId: string, name: string): Promise<Item[]> {
  const wanted = normalizeName(name);
  if (!wanted) return [];
  const items = await deps.store.listItems(householdId);
  const exact = items.filter((i) => normalizeName(i.name) === wanted || i.aliases.some((a) => normalizeName(a) === wanted));
  if (exact.length) return exact;
  const wantedTokens = new Set(wanted.split(' '));
  return items.filter((i) => {
    const tokens = new Set(normalizeName(`${i.name} ${i.brand ?? ''} ${i.model ?? ''}`).split(' '));
    const overlap = [...tokens].filter((t) => wantedTokens.has(t)).length;
    return overlap > 0 && overlap >= Math.min(wantedTokens.size, tokens.size) * 0.6;
  });
}

export function registerInventoryTools(server: McpServer, deps: ServerDeps): void {
  defineTool(server, deps, {
    name: 'add_item',
    title: 'Add an item to the household inventory',
    description:
      'Record something the household owns so Custodian can watch it for safety recalls and maintenance. ' +
      'Call when the customer says they bought, own, received, or want to track a product (car seat, stroller, crib, appliance, vehicle, medication, food, toy…). ' +
      'Pass the product name as spoken; brand, model, category, purchase date and vehicle details are optional but improve recall matching. Returns the stored item.',
    inputSchema: z.object({
      name: z.string().min(1).describe('The product as the customer described it, e.g. "Graco 4Ever car seat"'),
      brand: z.string().optional().describe('Manufacturer or brand if known'),
      model: z.string().optional().describe('Model name or number if known'),
      category: ItemCategory.optional().describe('Product category; inferred from the name when omitted'),
      quantity: z.number().int().min(1).optional().describe('How many; defaults to 1'),
      purchased_on: z.string().optional().describe('Purchase date (YYYY-MM-DD or natural language)'),
      manufactured_on: z.string().optional().describe('Manufacture date printed on the label, if known'),
      vehicle: Vehicle.optional().describe('For vehicles: make, model and model year'),
      notes: z.string().optional(),
    }),
    outputSchema: AddItemOutput,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    icons: ICONS.add,
    async handler(input) {
      const householdId = requireHousehold();
      await ensureHousehold(deps, householdId);
      const nowIso = deps.now().toISOString();

      const existing = (await findItemsByName(deps, householdId, input.name)).find(
        (i) => normalizeName(i.name) === normalizeName(input.name),
      );
      if (existing) {
        const merged: Item = {
          ...existing,
          quantity: existing.quantity + (input.quantity ?? 1),
          updated_at: nowIso,
          notes: input.notes ?? existing.notes,
        };
        await deps.store.putItem(merged);
        return ok(
          `You already had ${existing.name} on file, so I've made it ${merged.quantity}. I'm still watching it for recalls.`,
          { item: toItemSummary(merged), created: false, merged_into_existing: true },
        );
      }

      const brand = inferBrand(input.name, input.brand);
      const category = inferCategory(input.name, input.category ?? (input.vehicle ? 'vehicle' : undefined));
      const item: Item = {
        id: newId('itm'),
        household_id: householdId,
        name: input.name.trim(),
        brand,
        model: input.model,
        category,
        quantity: input.quantity ?? 1,
        purchased_on: coerceIsoDate(input.purchased_on),
        manufactured_on: coerceIsoDate(input.manufactured_on),
        vehicle: input.vehicle,
        notes: input.notes,
        aliases: defaultAliases(input.name, brand),
        enrichment_status: 'pending',
        created_at: nowIso,
        updated_at: nowIso,
      };
      await deps.store.putItem(item);
      // Enrichment and the recall sweep happen after we answer — never on the voice path.
      void deps.hooks.onItemAdded?.(item).catch((err) => console.error('[hooks.onItemAdded]', err));

      const label = CATEGORY_LABEL[category][0];
      const speech =
        category === 'other'
          ? `Got it, I've added ${item.name} to your inventory and I'll watch it for recalls.`
          : `Got it, I've added ${item.name} as a ${label}. I'll keep an eye on recalls and let you know if anything comes up.`;
      return ok(speech, { item: toItemSummary(item), created: true, merged_into_existing: false });
    },
  });

  defineTool(server, deps, {
    name: 'list_inventory',
    title: 'List household inventory',
    description:
      'List the items Custodian is tracking for this household, optionally filtered by category or a search phrase. ' +
      'Call when the customer asks what they have on file, what Custodian is watching, or wants to review their inventory.',
    inputSchema: z.object({
      category: ItemCategory.optional().describe('Only items in this category'),
      query: z.string().optional().describe('Free-text filter on name, brand or model'),
    }),
    outputSchema: ListInventoryOutput,
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    icons: ICONS.list,
    ui: 'app',
    async handler(input) {
      const householdId = requireHousehold();
      let items = await deps.store.listItems(householdId);
      if (input.category) items = items.filter((i) => i.category === input.category);
      if (input.query) {
        const q = normalizeName(input.query).split(' ');
        items = items.filter((i) => {
          const hay = normalizeName(`${i.name} ${i.brand ?? ''} ${i.model ?? ''}`);
          return q.every((t) => hay.includes(t));
        });
      }
      items.sort((a, b) => b.created_at.localeCompare(a.created_at));
      const matches = await deps.store.listMatches(householdId);
      const openMatches = matches.filter((m) => m.status === 'new' || m.status === 'seen');
      const openRecalls = openMatches.length;
      const openByItem: Record<string, number> = {};
      for (const m of openMatches) openByItem[m.item_id] = (openByItem[m.item_id] ?? 0) + 1;
      const total = items.reduce((n, i) => n + i.quantity, 0);

      if (items.length === 0) {
        const scope = input.category ? ` in ${CATEGORY_LABEL[input.category][1]}` : input.query ? ` matching ${input.query}` : '';
        return ok(`You don't have anything on file${scope} yet. Tell me what you own and I'll start watching it.`, {
          items: [],
          total: 0,
          open_recalls: openRecalls,
          open_recalls_by_item: openByItem,
        });
      }

      const byCategory = new Map<Item['category'], number>();
      for (const i of items) byCategory.set(i.category, (byCategory.get(i.category) ?? 0) + i.quantity);
      const parts = [...byCategory.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4)
        .map(([c, n]) => pluralize(n, CATEGORY_LABEL[c][0], CATEGORY_LABEL[c][1]));
      const more = byCategory.size > 4 ? ' and a few other things' : '';
      const recallNote = openRecalls > 0 ? ` ${pluralize(openRecalls, 'item has', 'items have')} an open recall.` : '';
      return ok(`You have ${pluralize(total, 'item')} on file: ${joinNatural(parts)}${more}.${recallNote}`, {
        items: items.map(toItemSummary),
        total,
        open_recalls: openRecalls,
        open_recalls_by_item: openByItem,
      });
    },
  });

  defineTool(server, deps, {
    name: 'remove_item',
    title: 'Remove an item from the inventory',
    description:
      'Stop tracking an item the household no longer owns (sold, thrown away, returned). ' +
      'Provide the item name as the customer said it, or the item id from a previous result. ' +
      'If several items match, the result lists candidates and nothing is removed — ask the customer which one they mean.',
    inputSchema: z.object({
      item_id: z.string().optional().describe('Exact item id from a previous result'),
      name: z.string().optional().describe('Item name as spoken by the customer'),
    }),
    outputSchema: RemoveItemOutput,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    icons: ICONS.remove,
    async handler(input) {
      const householdId = requireHousehold();
      let target: Item | undefined;
      if (input.item_id) target = await deps.store.getItem(householdId, input.item_id);
      if (!target && input.name) {
        const candidates = await findItemsByName(deps, householdId, input.name);
        if (candidates.length > 1) {
          return ok(
            `I found ${candidates.length} things that could be that: ${joinNatural(candidates.map((c) => c.name))}. Which one should I remove?`,
            { candidates: candidates.map(toItemSummary) },
          );
        }
        target = candidates[0];
      }
      if (!target) {
        return fail(`I couldn't find ${input.name ?? 'that item'} in your inventory, so there's nothing to remove.`);
      }
      await deps.store.deleteItem(householdId, target.id);
      await deps.store.deleteMatchesForItem(householdId, target.id);
      await deps.store.deleteRulesForItem(householdId, target.id);
      void deps.hooks.onItemRemoved?.(target).catch((err) => console.error('[hooks.onItemRemoved]', err));
      return ok(`Done, I've removed ${spokenItem(target)} and stopped watching it.`, {
        removed: toItemSummary(target),
        candidates: [],
      });
    },
  });
}

export { todayIso };

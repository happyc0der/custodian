import type { Item, ItemSummary, MaintenanceRule, MaintenanceView, Match, RecallMatchView, RecallRecord } from '@custodian/shared';
import { daysBetween } from '@custodian/shared';

export function toItemSummary(item: Item): ItemSummary {
  const { id, name, brand, model, category, quantity, purchased_on, vehicle } = item;
  return { id, name, brand, model, category, quantity, purchased_on, vehicle };
}

export function toMatchView(match: Match, item: Item, recall: RecallRecord): RecallMatchView {
  return {
    match_id: match.id,
    status: match.status,
    confidence: match.confidence,
    item: toItemSummary(item),
    recall: {
      id: recall.id,
      source: recall.source,
      title: recall.title,
      summary: recall.summary,
      hazard: recall.hazard,
      remedy: recall.remedy,
      remedy_options: recall.remedy_options,
      contact: recall.contact,
      url: recall.url,
      image_url: recall.image_url,
      published_on: recall.published_on,
      severity: recall.severity,
    },
  };
}

export function toMaintenanceView(rule: MaintenanceRule, item: Item, today: string): MaintenanceView {
  const days = daysBetween(today, rule.next_due);
  return {
    rule_id: rule.id,
    item: toItemSummary(item),
    kind: rule.kind,
    label: rule.label,
    next_due: rule.next_due,
    days_until_due: days,
    overdue: days < 0,
  };
}

/** Human label for speech: "Graco 4Ever car seat" → "your Graco 4Ever car seat". */
export function spokenItem(item: Pick<Item, 'name' | 'quantity'>): string {
  return item.quantity > 1 ? `your ${item.name} (you have ${item.quantity})` : `your ${item.name}`;
}

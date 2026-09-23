import type {
  Item,
  ItemSummary,
  MaintenanceRule,
  MaintenanceView,
  Match,
  RecallMatchView,
  RecallRecord,
} from '@custodian/shared';
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

export function toMaintenanceView(
  rule: MaintenanceRule,
  item: Item,
  today: string,
): MaintenanceView {
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

/**
 * "Your Kidde smoke detector needs new batteries, 71 days overdue." — one clause per reminder,
 * phrased per kind so the item name carries the sentence instead of the label.
 */
export function speakMaintenance(v: MaintenanceView): string {
  const item = `your ${v.item.name}`;
  const when =
    v.days_until_due < 0
      ? `, ${-v.days_until_due === 1 ? 'a day' : `${-v.days_until_due} days`} overdue`
      : v.days_until_due === 0
        ? ' today'
        : ` in ${v.days_until_due === 1 ? 'a day' : `${v.days_until_due} days`}`;
  switch (v.kind) {
    case 'replace_battery':
      return `${item} needs new batteries${when}`;
    case 'replace_filter':
      return `${item} needs a new filter${when}`;
    case 'replace_unit':
      return `${item} needs replacing${when}`;
    case 'service':
      return `${item} is due for ${v.item.category === 'vehicle' ? 'an oil change and service' : 'a service'}${when}`;
    case 'inspect':
      return `${item} is due for an inspection${when}`;
    case 'expires':
      return `${item} expires${when}`;
    case 'warranty_ends':
      return `the warranty on ${item} ends${when}`;
    default:
      return `${v.label.toLowerCase().replace(/\.$/, '')} for ${item}${when}`;
  }
}

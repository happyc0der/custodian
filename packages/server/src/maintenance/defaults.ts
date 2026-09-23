import { addDays, type Item, type MaintenanceKind } from '@custodian/shared';

export interface RuleTemplate {
  kind: MaintenanceKind;
  label: string;
  interval_days?: number;
  next_due: string;
}

const YEAR = 365;

/**
 * Sensible defaults per category. Intervals follow the common manufacturer
 * guidance (NFPA for smoke alarms, typical filter life, car-seat expiry floors);
 * the customer can always add or log their own.
 */
export function defaultRulesFor(item: Item, today: string): RuleTemplate[] {
  const bought = item.purchased_on ?? today;
  const made = item.manufactured_on ?? item.purchased_on ?? today;
  switch (item.category) {
    case 'smoke_detector':
      return [
        {
          kind: 'replace_battery',
          label: 'Replace the batteries',
          interval_days: 182,
          next_due: addDays(bought, 182),
        },
        {
          kind: 'replace_unit',
          label: 'Replace the unit (10-year life)',
          next_due: addDays(made, 10 * YEAR),
        },
      ];
    case 'water_filter':
      return [
        {
          kind: 'replace_filter',
          label: 'Replace the filter',
          interval_days: 182,
          next_due: addDays(bought, 182),
        },
      ];
    case 'hvac_filter':
      return [
        {
          kind: 'replace_filter',
          label: 'Replace the filter',
          interval_days: 90,
          next_due: addDays(bought, 90),
        },
      ];
    case 'car_seat':
      return [
        {
          kind: 'expires',
          label: 'Car seat expires (6 years from manufacture)',
          next_due: addDays(made, 6 * YEAR),
        },
      ];
    case 'vehicle':
      return [
        {
          kind: 'service',
          label: 'Oil change and service',
          interval_days: 182,
          next_due: addDays(bought, 182),
        },
      ];
    case 'heater':
      return [
        {
          kind: 'inspect',
          label: 'Inspect before the heating season',
          interval_days: YEAR,
          next_due: addDays(bought, YEAR),
        },
      ];
    case 'appliance':
    case 'electronics':
      return item.purchased_on
        ? [
            {
              kind: 'warranty_ends',
              label: 'Warranty ends (1 year)',
              next_due: addDays(item.purchased_on, YEAR),
            },
          ]
        : [];
    default:
      return [];
  }
}

/** One-shot rules are removed once done; interval rules roll forward. */
export function isOneShot(kind: MaintenanceKind): boolean {
  return kind === 'expires' || kind === 'warranty_ends' || kind === 'replace_unit';
}

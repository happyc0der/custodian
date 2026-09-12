import type { ItemCategory } from '@custodian/shared';
import { tokenize } from '@custodian/shared';

/**
 * Deterministic category inference from the spoken item name. Ordered: the
 * first rule whose keyword appears wins, so more specific phrases come first.
 */
const RULES: Array<[ItemCategory, string[]]> = [
  ['smoke_detector', ['smoke detector', 'smoke alarm', 'carbon monoxide', 'co detector', 'co alarm']],
  ['water_filter', ['water filter', 'fridge filter', 'refrigerator filter', 'brita', 'pitcher filter']],
  ['hvac_filter', ['hvac filter', 'furnace filter', 'air filter', 'ac filter']],
  ['car_seat', ['car seat', 'carseat', 'booster seat', 'infant seat', 'convertible seat', 'booster']],
  ['stroller', ['stroller', 'pram', 'buggy', 'jogger']],
  ['crib', ['crib', 'bassinet', 'cradle', 'play yard', 'playard', 'pack n play', 'toddler bed']],
  ['heater', ['space heater', 'heater', 'radiator', 'fireplace']],
  ['vehicle', ['car', 'truck', 'suv', 'minivan', 'van', 'sedan', 'vehicle', 'motorcycle']],
  ['medication', ['medication', 'medicine', 'pills', 'tablets', 'prescription', 'insulin', 'inhaler']],
  ['medical_device', ['thermometer', 'blood pressure', 'glucose', 'cpap', 'nebulizer', 'monitor', 'pulse ox']],
  ['food', ['formula', 'baby food', 'lettuce', 'romaine', 'spinach', 'salad', 'yogurt', 'cheese', 'snack', 'cereal', 'peanut butter']],
  ['toy', ['toy', 'lego', 'doll', 'plush', 'teether', 'rattle', 'puzzle', 'magnet']],
  ['appliance', ['dishwasher', 'washer', 'dryer', 'oven', 'range', 'stove', 'microwave', 'fridge', 'refrigerator', 'freezer', 'blender', 'air fryer', 'toaster', 'kettle', 'vacuum', 'dehumidifier', 'humidifier', 'pressure cooker', 'instant pot']],
  ['electronics', ['laptop', 'phone', 'tablet', 'charger', 'battery', 'power bank', 'tv', 'television', 'speaker', 'headphones', 'e-bike', 'ebike', 'scooter', 'hoverboard']],
  ['furniture', ['dresser', 'bookcase', 'bookshelf', 'table', 'chair', 'sofa', 'couch', 'bed frame', 'cabinet', 'desk', 'bunk bed']],
  ['tool', ['drill', 'saw', 'ladder', 'mower', 'lawn mower', 'chainsaw', 'generator', 'pressure washer']],
];

const KNOWN_BRANDS = [
  'graco', 'chicco', 'britax', 'evenflo', 'nuna', 'cybex', 'maxi-cosi', 'uppababy', 'joolz', 'bugaboo', 'baby jogger',
  'fisher-price', 'fisher price', 'mattel', 'hasbro', 'lego', 'melissa & doug', 'hape',
  'samsung', 'lg', 'whirlpool', 'ge', 'frigidaire', 'bosch', 'kitchenaid', 'cuisinart', 'instant pot', 'ninja', 'dyson', 'shark', 'bissell', 'vitamix', 'breville', 'keurig',
  'apple', 'anker', 'belkin', 'sony', 'peloton', 'segway', 'razor',
  'honda', 'toyota', 'ford', 'chevrolet', 'chevy', 'tesla', 'subaru', 'nissan', 'hyundai', 'kia', 'jeep', 'ram', 'gmc', 'bmw', 'mercedes', 'volkswagen', 'vw', 'audi', 'mazda', 'volvo', 'lexus', 'acura',
  'ikea', 'wayfair', 'ashley', 'pottery barn', 'crate & barrel',
  'kidde', 'first alert', 'nest', 'google', 'amazon', 'ring',
  'brita', 'pur', 'zerowater',
  'similac', 'enfamil', 'gerber',
];

export function inferCategory(name: string, explicit?: ItemCategory): ItemCategory {
  if (explicit) return explicit;
  const lower = ` ${name.toLowerCase().replace(/[^a-z0-9&-]+/g, ' ')} `;
  for (const [category, keywords] of RULES) {
    for (const kw of keywords) {
      if (lower.includes(` ${kw} `)) return category;
    }
  }
  return 'other';
}

export function inferBrand(name: string, explicit?: string): string | undefined {
  if (explicit) return explicit;
  const lower = ` ${name.toLowerCase()} `;
  const hit = KNOWN_BRANDS.find((b) => lower.includes(` ${b} `));
  if (!hit) return undefined;
  // Title-case the brand as we know it, preserving all-caps acronyms.
  return hit.length <= 3 ? hit.toUpperCase() : hit.replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Spoken aliases: the raw name plus a brand-less variant so "car seat" still matches "Graco car seat". */
export function defaultAliases(name: string, brand?: string): string[] {
  const aliases = new Set<string>([name.trim()]);
  if (brand) {
    const stripped = name.replace(new RegExp(brand, 'i'), '').trim();
    if (stripped && stripped !== name.trim()) aliases.add(stripped);
  }
  const normalized = tokenize(name).join(' ');
  if (normalized) aliases.add(normalized);
  return [...aliases];
}

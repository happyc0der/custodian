const STOP = new Set([
  'the',
  'a',
  'an',
  'and',
  'or',
  'of',
  'for',
  'with',
  'my',
  'our',
  'new',
  'in',
  'on',
  'to',
  'by',
  'from',
  'this',
  'that',
  'is',
  'are',
  'it',
  'its',
  'i',
  'we',
  'just',
  'bought',
  'got',
  'have',
  'recall',
  'recalls',
  'recalled',
  'due',
  'hazard',
  'risk',
  'injury',
  'serious',
  'death',
]);

/** Lower-case alphanumeric tokens, stop-words removed, plural-trimmed. */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[’']/g, '')
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !STOP.has(t))
    .map((t) => (t.length > 4 && t.endsWith('s') && !t.endsWith('ss') ? t.slice(0, -1) : t));
}

export function normalizeName(text: string): string {
  return tokenize(text).join(' ');
}

/** Sentence-cases and trims a string for speech; strips URLs and phone-number noise. */
export function forSpeech(text: string): string {
  return text
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/www\.\S+/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export function pluralize(n: number, singular: string, plural = `${singular}s`): string {
  return `${n} ${n === 1 ? singular : plural}`;
}

export function joinNatural(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? '';
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}`;
}

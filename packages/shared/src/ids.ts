import { randomBytes } from 'node:crypto';

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

/** Short, URL-safe, voice-irrelevant identifiers (base36, 12 chars). */
export function newId(prefix?: string): string {
  const bytes = randomBytes(9);
  let out = '';
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return prefix ? `${prefix}_${out}` : out;
}

export function recallId(source: string, externalId: string): string {
  return `${source}:${externalId}`;
}

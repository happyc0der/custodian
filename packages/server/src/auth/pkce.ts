import { createHash, scryptSync, timingSafeEqual } from 'node:crypto';

/** RFC 7636 S256: BASE64URL(SHA256(code_verifier)) must equal code_challenge. */
export function verifyPkceS256(codeVerifier: string, codeChallenge: string): boolean {
  if (!/^[A-Za-z0-9\-._~]{43,128}$/.test(codeVerifier)) return false;
  const digest = createHash('sha256').update(codeVerifier).digest('base64url');
  return safeEqual(digest, codeChallenge);
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function sha256b64url(input: string): string {
  return createHash('sha256').update(input).digest('base64url');
}

export function hashPassphrase(passphrase: string, salt: string): string {
  return scryptSync(passphrase.normalize('NFKC'), salt, 32, { N: 16384, r: 8, p: 1 }).toString('base64url');
}

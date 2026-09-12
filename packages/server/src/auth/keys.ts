import { SignJWT, calculateJwkThumbprint, exportJWK, exportPKCS8, generateKeyPair, importJWK, importPKCS8, jwtVerify, type CryptoKey, type JWK } from 'jose';
import type { Config } from '../config.js';
import type { Store } from '../store/types.js';

const ALG = 'ES256';
const META_KEY = 'auth:jwt_private_key_pem';

export interface SigningKeys {
  privateKey: CryptoKey;
  publicKey: CryptoKey;
  kid: string;
  jwks: { keys: JWK[] };
}

/**
 * ES256 signing key for access tokens. Order of precedence: JWT_PRIVATE_KEY
 * (PEM, production — comes from Secrets Manager), a key persisted in the
 * store (so dev restarts keep tokens valid), else a freshly generated one.
 */
export async function loadSigningKeys(config: Config, store: Store): Promise<SigningKeys> {
  let pem = config.jwtPrivateKey ?? (await store.getMeta(META_KEY));
  if (!pem) {
    const { privateKey } = await generateKeyPair(ALG, { extractable: true });
    pem = await exportPKCS8(privateKey);
    await store.setMeta(META_KEY, pem);
  }
  const privateKey = await importPKCS8(pem, ALG, { extractable: true });
  const jwk = await exportJWK(privateKey);
  const publicJwk: JWK = { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, alg: ALG, use: 'sig' };
  const kid = await calculateJwkThumbprint(publicJwk);
  publicJwk.kid = kid;
  const publicKey = (await importJWK(publicJwk, ALG)) as CryptoKey;
  return { privateKey: privateKey as CryptoKey, publicKey, kid, jwks: { keys: [publicJwk] } };
}

export interface AccessTokenClaims {
  sub: string;
  client_id: string;
  scope: string;
  household_id?: string;
}

export async function signAccessToken(keys: SigningKeys, config: Config, claims: AccessTokenClaims, ttlSeconds: number): Promise<string> {
  return new SignJWT({ client_id: claims.client_id, scope: claims.scope, household_id: claims.household_id })
    .setProtectedHeader({ alg: ALG, kid: keys.kid, typ: 'at+jwt' })
    .setIssuer(config.publicUrl)
    .setAudience(resourceUrl(config))
    .setSubject(claims.sub)
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + ttlSeconds)
    .setJti(cryptoRandom())
    .sign(keys.privateKey);
}

export async function verifyAccessToken(keys: SigningKeys, config: Config, token: string) {
  const { payload } = await jwtVerify(token, keys.publicKey, { issuer: config.publicUrl, audience: resourceUrl(config), algorithms: [ALG] });
  return payload as typeof payload & Partial<AccessTokenClaims>;
}

/** The RFC 8707 resource identifier of the MCP endpoint (also the JWT audience). */
export function resourceUrl(config: Config): string {
  return `${config.publicUrl}/mcp`;
}

export function cryptoRandom(bytes = 32): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(bytes))).toString('base64url');
}

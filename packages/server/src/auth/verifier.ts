import type { AuthInfo } from '@modelcontextprotocol/server';
import type { Config } from '../config.js';
import { ALL_SCOPES, type TokenVerifier } from './bearer.js';
import { resourceUrl, verifyAccessToken, type SigningKeys } from './keys.js';

/** Verifies our own ES256 access tokens (issuer = PUBLIC_URL, audience = PUBLIC_URL/mcp). */
export function jwtVerifier(config: Config, keys: SigningKeys): TokenVerifier {
  return {
    async verify(token) {
      let claims;
      try {
        claims = await verifyAccessToken(keys, config, token);
      } catch {
        throw new Error('invalid_token');
      }
      const scopes = String(claims.scope ?? '')
        .split(' ')
        .filter((s) => ALL_SCOPES.includes(s));
      const info: AuthInfo = {
        token,
        clientId: String(claims.client_id ?? ''),
        scopes,
        expiresAt: claims.exp,
        resource: new URL(resourceUrl(config)),
        extra: claims.household_id ? { householdId: claims.household_id } : {},
      };
      return info;
    },
  };
}

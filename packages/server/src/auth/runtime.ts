import type { Router } from 'express';
import type { Config } from '../config.js';
import type { Store } from '../store/types.js';
import { devVerifier, type TokenVerifier } from './bearer.js';
import { loadSigningKeys, type SigningKeys } from './keys.js';
import { createOAuthRouter } from './oauth.js';
import { jwtVerifier } from './verifier.js';

export interface AuthRuntime {
  verifier: TokenVerifier;
  router: Router;
  keys: SigningKeys;
}

/**
 * The OAuth 2.1 server is always mounted (so discovery, /token and the login
 * page work in every mode). `AUTH_MODE=dev` additionally accepts the static
 * DEV_BEARER_TOKEN for local tooling; `oauth` accepts only our JWTs.
 */
export async function createAuthRuntime(config: Config, store: Store, now?: () => Date): Promise<AuthRuntime> {
  const keys = await loadSigningKeys(config, store);
  const jwt = jwtVerifier(config, keys);
  const verifier: TokenVerifier =
    config.authMode === 'dev'
      ? {
          async verify(token) {
            const dev = devVerifier(config);
            try {
              return await dev.verify(token);
            } catch {
              return jwt.verify(token);
            }
          },
        }
      : jwt;
  return { verifier, keys, router: createOAuthRouter({ config, store, keys, now }) };
}

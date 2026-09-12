import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Identity of the caller for the duration of one MCP request.
 *
 * `householdId` is the OAuth subject for user-level tokens. Service-level
 * tokens (client_credentials) have no household and may only list tools.
 */
export interface CallerContext {
  householdId?: string;
  scopes: string[];
  clientId: string;
}

const als = new AsyncLocalStorage<CallerContext>();

export function runWithCaller<T>(ctx: CallerContext, fn: () => T): T {
  return als.run(ctx, fn);
}

export function currentCaller(): CallerContext | undefined {
  return als.getStore();
}

export class NotLinkedError extends Error {
  constructor() {
    super('This request is not linked to a household. Please link your account first.');
    this.name = 'NotLinkedError';
  }
}

/** Household id for the current request, or throws a spoken-friendly error. */
export function requireHousehold(): string {
  const id = currentCaller()?.householdId;
  if (!id) throw new NotLinkedError();
  return id;
}

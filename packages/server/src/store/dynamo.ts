import type { Config } from '../config.js';
import type { Store } from './types.js';

/** Implemented in Phase 7 (AWS deploy). Kept as a module so `openStore` can lazy-load it. */
export class DynamoStore {
  static async open(_config: Config): Promise<Store> {
    throw new Error('DynamoStore is not implemented yet — set STORE=file');
  }
}

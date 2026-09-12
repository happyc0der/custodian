import type { Config } from '../config.js';
import { FileStore } from './file.js';
import type { Store } from './types.js';

export type { Store } from './types.js';
export { FileStore } from './file.js';

export async function openStore(config: Config): Promise<Store> {
  if (config.store === 'dynamo') {
    const { DynamoStore } = await import('./dynamo.js');
    return DynamoStore.open(config);
  }
  return FileStore.open(config.fileStorePath);
}

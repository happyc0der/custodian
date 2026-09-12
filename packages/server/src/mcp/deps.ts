import type { Item } from '@custodian/shared';
import type { Config } from '../config.js';
import type { Store } from '../store/types.js';

/** Hooks let later phases (sweep, maintenance defaults) react to inventory changes without coupling. */
export interface Hooks {
  onItemAdded?: (item: Item) => Promise<void>;
  onItemRemoved?: (item: Item) => Promise<void>;
}

/** Bundled MCP App views keyed by their ui:// URI (built by packages/ui). */
export interface UiBundle {
  has(uri: string): boolean;
  read(uri: string): Promise<string>;
  uris(): string[];
}

export interface ServerDeps {
  config: Config;
  store: Store;
  hooks: Hooks;
  now: () => Date;
  ui?: UiBundle;
}

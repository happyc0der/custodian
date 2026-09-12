import { loadConfig } from './config.js';
import { devVerifier } from './auth/bearer.js';
import { createApp } from './http/app.js';
import type { ServerDeps } from './mcp/deps.js';
import { openStore } from './store/index.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const store = await openStore(config);
  const deps: ServerDeps = { config, store, hooks: {}, now: () => new Date() };

  if (config.authMode !== 'dev') {
    throw new Error('AUTH_MODE=oauth is wired in Phase 5; use AUTH_MODE=dev for now');
  }
  const app = createApp({ deps, verifier: devVerifier(config) });

  const server = app.listen(config.port, () => {
    console.log(`custodian listening on http://localhost:${config.port}/mcp  (auth=${config.authMode}, store=${config.store})`);
  });

  const shutdown = async (signal: string) => {
    console.log(`\n${signal} received, flushing store…`);
    server.close();
    await store.flush();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

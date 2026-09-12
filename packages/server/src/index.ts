import cron from 'node-cron';
import { loadConfig } from './config.js';
import { createAuthRuntime } from './auth/runtime.js';
import { createApp } from './http/app.js';
import { createEnricher } from './enrich/bedrock.js';
import { Sweeper, defaultSources } from './jobs/sweep.js';
import { applyDefaultRules } from './maintenance/service.js';
import type { ServerDeps } from './mcp/deps.js';
import { openStore } from './store/index.js';
import { loadUiBundle } from './ui.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const store = await openStore(config);
  const enricher = createEnricher(config);
  console.log(enricher ? `[enrich] Bedrock enabled (${config.bedrockModel} @ ${config.bedrockRegion})` : '[enrich] Bedrock disabled — deterministic matching only');
  const sweeper = new Sweeper({ store, sources: defaultSources(), enricher });
  await sweeper.warm();

  const ui = await loadUiBundle(config.uiDist);
  console.log(ui ? `[ui] views: ${ui.entries().map((e) => e.view).join(', ')}` : '[ui] no bundle found — tools run voice-only');
  const deps: ServerDeps = {
    config,
    store,
    ui,
    now: () => new Date(),
    hooks: {
      // Runs after add_item has already answered the customer.
      onItemAdded: async (item) => {
        await applyDefaultRules(store, item, new Date());
        const matches = await sweeper.sweepItem(item);
        if (matches.length) console.log(`[sweep] ${item.name}: ${matches.length} recall match(es)`);
      },
    },
  };

  const auth = await createAuthRuntime(config, store);
  const app = createApp({ deps, auth });

  const server = app.listen(config.port, () => {
    console.log(`custodian listening on http://localhost:${config.port}/mcp  (auth=${config.authMode}, store=${config.store})`);
  });

  if (cron.validate(config.sweepCron)) {
    cron.schedule(config.sweepCron, () => void sweeper.runFull().catch((err) => console.error('[sweep]', err)));
    console.log(`[sweep] scheduled: ${config.sweepCron}`);
  } else {
    console.warn(`[sweep] invalid SWEEP_CRON "${config.sweepCron}" — scheduler disabled`);
  }
  if (config.sweepOnBoot) void sweeper.runFull().catch((err) => console.error('[sweep]', err));

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

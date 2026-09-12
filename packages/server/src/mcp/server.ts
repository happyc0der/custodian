import { McpServer } from '@modelcontextprotocol/server';
import { createRequire } from 'node:module';
import type { ServerDeps } from './deps.js';
import { registerBriefingTool } from './tools/briefing.js';
import { registerInventoryTools } from './tools/inventory.js';
import { registerMaintenanceTools } from './tools/maintenance.js';
import { registerRecallTools } from './tools/recalls.js';

const pkg = createRequire(import.meta.url)('../../package.json') as { version: string };

export const SERVER_INSTRUCTIONS =
  'Custodian tracks what a household owns and watches it for product-safety recalls (CPSC, NHTSA, FDA) and routine maintenance. ' +
  'Prefer household_briefing for open-ended "anything I should know?" questions, check_recalls for specific recall questions, and add_item whenever the customer mentions owning or buying something. ' +
  'Speak the text content; the structured content is for on-screen display.';

/**
 * Builds one McpServer instance. `createMcpHandler` calls this per HTTP
 * request (stateless serving), so registration must stay cheap.
 */
export function createMcpServer(deps: ServerDeps): McpServer {
  const server = new McpServer({ name: 'custodian', version: pkg.version, title: 'Custodian' }, { instructions: SERVER_INSTRUCTIONS });
  registerInventoryTools(server, deps);
  registerRecallTools(server, deps);
  registerMaintenanceTools(server, deps);
  registerBriefingTool(server, deps);
  return server;
}

import type {
  CallToolResult,
  Icon,
  McpServer,
  ServerContext,
  ToolAnnotations,
} from '@modelcontextprotocol/server';
import { registerAppTool } from '@modelcontextprotocol/ext-apps/server';
import type { z } from 'zod';
import {
  NotLinkedError,
  runWithCaller,
  type CallerContext,
  currentCaller,
} from '../auth/context.js';
import { timed } from '../telemetry.js';
import type { ServerDeps } from './deps.js';
import { fail } from './result.js';

export interface ToolSpec<I extends z.ZodObject, O extends z.ZodObject> {
  name: string;
  title: string;
  description: string;
  inputSchema: I;
  outputSchema: O;
  annotations?: ToolAnnotations;
  icons?: Icon[];
  /** Name of the MCP Apps view (from packages/ui) that renders this tool's result, e.g. "app". */
  ui?: string;
  handler: (input: z.infer<I>, ctx: ServerContext) => Promise<CallToolResult>;
}

function callerFromCtx(ctx: ServerContext): CallerContext | undefined {
  const auth = ctx.http?.authInfo;
  if (!auth) return undefined;
  return {
    clientId: auth.clientId,
    scopes: auth.scopes,
    householdId: typeof auth.extra?.householdId === 'string' ? auth.extra.householdId : undefined,
  };
}

/**
 * Registers a tool with uniform behaviour:
 *  - timed for the latency budget,
 *  - caller identity propagated (from the transport's authInfo, falling back
 *    to the HTTP layer's AsyncLocalStorage),
 *  - every thrown error converted into a spoken tool-execution error so Alexa
 *    never receives an empty result.
 */
export function defineTool<I extends z.ZodObject, O extends z.ZodObject>(
  server: McpServer,
  deps: ServerDeps,
  spec: ToolSpec<I, O>,
): void {
  const cb = async (input: z.infer<I>, ctx: ServerContext): Promise<CallToolResult> =>
    timed(
      spec.name,
      async () => {
        const caller = callerFromCtx(ctx) ?? currentCaller();
        const run = () => spec.handler(input, ctx);
        try {
          return caller ? await runWithCaller(caller, run) : await run();
        } catch (err) {
          if (err instanceof NotLinkedError) return fail(err.message);
          console.error(`[tool:${spec.name}]`, err);
          return fail('Sorry, something went wrong on my end. Please try that again in a moment.');
        }
      },
      (r) => r.isError === true,
    );

  const config = {
    title: spec.title,
    description: spec.description,
    inputSchema: spec.inputSchema,
    outputSchema: spec.outputSchema,
    annotations: spec.annotations,
    icons: spec.icons,
  };

  // Only advertise a view when its bundle is actually available; otherwise hosts would fetch a missing ui:// resource.
  const resourceUri = spec.ui ? deps.ui?.uriFor(spec.ui) : undefined;
  if (resourceUri) {
    registerAppTool(server, spec.name, { ...config, _meta: { ui: { resourceUri } } }, cb as never);
  } else {
    server.registerTool(spec.name, config, cb as never);
  }
}

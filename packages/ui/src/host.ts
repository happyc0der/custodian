import { App, applyDocumentTheme, applyHostFonts, applyHostStyleVariables, type McpUiHostContext } from '@modelcontextprotocol/ext-apps';

/** One App instance for the page; views talk to the host only through these helpers. */
export const app = new App({ name: 'Custodian', version: '0.1.0' }, { availableDisplayModes: ['inline', 'fullscreen'] });

/** The payload the host pushes via ui/notifications/tool-result (a CallToolResult). */
export type ToolResult = Parameters<NonNullable<App['ontoolresult']>>[0];

export function applyHost(ctx: McpUiHostContext | undefined): void {
  if (!ctx) return;
  if (ctx.theme) applyDocumentTheme(ctx.theme);
  if (ctx.styles?.variables) applyHostStyleVariables(ctx.styles.variables);
  if (ctx.styles?.css?.fonts) applyHostFonts(ctx.styles.css.fonts);
}

/** Width class from the host's container; Alexa's guide asks for one breakpoint class on the root. */
export function widthClass(ctx: McpUiHostContext | undefined): 'w-narrow' | 'w-medium' | 'w-wide' {
  const dims = (ctx?.containerDimensions ?? {}) as { width?: number; maxWidth?: number };
  const w = dims.width ?? dims.maxWidth ?? (typeof ctx?.maxWidth === 'number' ? (ctx.maxWidth as number) : window.innerWidth);
  if (w < 520) return 'w-narrow';
  if (w < 960) return 'w-medium';
  return 'w-wide';
}

export async function callTool<T = Record<string, unknown>>(name: string, args: Record<string, unknown>): Promise<{ data: T; speech: string; isError: boolean }> {
  const r = await app.callServerTool({ name, arguments: args });
  const first = r.content?.[0];
  return { data: (r.structuredContent ?? {}) as T, speech: first?.type === 'text' ? first.text : '', isError: r.isError === true };
}

/** Tell the model what the customer did on screen so the next voice turn is coherent. */
export function tellModel(text: string): void {
  void app.updateModelContext({ content: [{ type: 'text', text }] }).catch(() => {});
}

export function openLink(url: string): void {
  void app.openLink({ url }).catch(() => {});
}

export async function expand(): Promise<void> {
  try {
    await app.requestDisplayMode({ mode: 'fullscreen' });
  } catch {
    /* host may not support it */
  }
}

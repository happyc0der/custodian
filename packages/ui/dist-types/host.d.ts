import { App, type McpUiHostContext } from '@modelcontextprotocol/ext-apps';
/** One App instance for the page; views talk to the host only through these helpers. */
export declare const app: App;
/** The payload the host pushes via ui/notifications/tool-result (a CallToolResult). */
export type ToolResult = Parameters<NonNullable<App['ontoolresult']>>[0];
export declare function applyHost(ctx: McpUiHostContext | undefined): void;
/** Width class from the host's container; Alexa's guide asks for one breakpoint class on the root. */
export declare function widthClass(ctx: McpUiHostContext | undefined): 'w-narrow' | 'w-medium' | 'w-wide';
export declare function callTool<T = Record<string, unknown>>(name: string, args: Record<string, unknown>): Promise<{
    data: T;
    speech: string;
    isError: boolean;
}>;
/** Tell the model what the customer did on screen so the next voice turn is coherent. */
export declare function tellModel(text: string): void;
export declare function openLink(url: string): void;
export declare function expand(): Promise<void>;

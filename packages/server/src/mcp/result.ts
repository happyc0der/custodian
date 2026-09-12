import type { CallToolResult } from '@modelcontextprotocol/server';
import { forSpeech } from '@custodian/shared';

/**
 * Every tool returns two things: a short spoken sentence in `content[0].text`
 * (what Alexa reads aloud) and the full payload in `structuredContent` (what
 * the MCP App renders). Keep speech to one or two sentences and never put URLs
 * or identifiers in it.
 */
export function ok<T extends Record<string, unknown>>(speech: string, structured: T): CallToolResult {
  return {
    content: [{ type: 'text', text: forSpeech(speech) }],
    structuredContent: structured,
  };
}

/** A tool *execution* error (spec 2025-11-25 §tools): the model can recover and rephrase. */
export function fail(speech: string): CallToolResult {
  return {
    content: [{ type: 'text', text: forSpeech(speech) }],
    isError: true,
  };
}

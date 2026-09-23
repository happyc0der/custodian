import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import type { UiBundle } from './mcp/deps.js';

/**
 * Loads the MCP App bundles built by packages/ui. Each `<view>.html` becomes
 * `ui://custodian/<view>-<hash>.html` — content-hashed as Alexa recommends so
 * a redeploy never serves a stale cached view.
 */
export async function loadUiBundle(distDir: string): Promise<UiBundle | undefined> {
  let files: string[];
  try {
    files = (await readdir(distDir)).filter((f) => f.endsWith('.html'));
  } catch {
    return undefined;
  }
  if (files.length === 0) return undefined;
  const byView = new Map<string, { uri: string; html: string }>();
  const byUri = new Map<string, string>();
  for (const f of files) {
    const html = await readFile(path.join(distDir, f), 'utf8');
    const view = f.replace(/\.html$/, '');
    const hash = createHash('sha256').update(html).digest('hex').slice(0, 10);
    const uri = `ui://custodian/${view}-${hash}.html`;
    byView.set(view, { uri, html });
    byUri.set(uri, html);
  }
  return {
    uriFor: (view) => byView.get(view)?.uri,
    has: (uri) => byUri.has(uri),
    read: async (uri) => {
      const html = byUri.get(uri);
      if (html === undefined) throw new Error(`unknown ui resource ${uri}`);
      return html;
    },
    entries: () => [...byView.entries()].map(([view, v]) => ({ view, uri: v.uri })),
  };
}

/** Test double: a bundle with fixed HTML per view. */
export function staticUiBundle(views: Record<string, string>): UiBundle {
  const byView = new Map(
    Object.entries(views).map(([view, html]) => [
      view,
      { uri: `ui://custodian/${view}-test.html`, html },
    ]),
  );
  return {
    uriFor: (view) => byView.get(view)?.uri,
    has: (uri) => [...byView.values()].some((v) => v.uri === uri),
    read: async (uri) => {
      const hit = [...byView.values()].find((v) => v.uri === uri);
      if (!hit) throw new Error(`unknown ui resource ${uri}`);
      return hit.html;
    },
    entries: () => [...byView.entries()].map(([view, v]) => ({ view, uri: v.uri })),
  };
}

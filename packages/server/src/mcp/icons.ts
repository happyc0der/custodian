import type { Icon } from '@modelcontextprotocol/server';

/** Tool icons (SEP-973). Inline SVG keeps the tools/list payload self-contained. */
function svg(body: string): Icon[] {
  const doc = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
  return [
    {
      src: `data:image/svg+xml;base64,${Buffer.from(doc).toString('base64')}`,
      mimeType: 'image/svg+xml',
      sizes: ['any'],
    },
  ];
}

export const ICONS = {
  add: svg('<path d="M12 5v14M5 12h14"/>'),
  list: svg('<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>'),
  remove: svg('<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/>'),
  shield: svg(
    '<path d="M12 3l8 3v6c0 5-3.5 8.5-8 9-4.5-.5-8-4-8-9V6l8-3z"/><path d="M12 8v4M12 16h.01"/>',
  ),
  detail: svg('<path d="M4 4h16v16H4z"/><path d="M8 9h8M8 13h6"/>'),
  check: svg('<path d="M20 6L9 17l-5-5"/>'),
  calendar: svg(
    '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18"/>',
  ),
  wrench: svg(
    '<path d="M14.7 6.3a4 4 0 0 0 5 5l-7.4 7.4a2 2 0 0 1-2.8-2.8l7.4-7.4z"/><path d="M3 21l3-3"/>',
  ),
  home: svg('<path d="M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>'),
};

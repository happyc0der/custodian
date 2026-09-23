/**
 * Seeds a household with a realistic demo inventory through the MCP tools
 * (so hooks, enrichment and the recall sweep all run exactly as in production).
 *
 *   npm run seed                                  # dev household on http://localhost:3001
 *   MCP_URL=… MCP_TOKEN=… npm run seed            # any server / token
 */
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

const url = process.env.MCP_URL ?? 'http://localhost:3001/mcp';
const token = process.env.MCP_TOKEN ?? process.env.DEV_BEARER_TOKEN ?? 'dev-token';

const ITEMS: Array<Record<string, unknown>> = [
  { name: 'Joolz Aer2 car seat adapter', purchased_on: '2026-03-01' },
  { name: 'Joolz Aer2 stroller', purchased_on: '2026-03-01' },
  { name: 'Britax Advocate ClickTight car seat', manufactured_on: '2021-06-10' },
  {
    name: '2019 Honda Odyssey',
    vehicle: { make: 'Honda', model: 'Odyssey', year: 2019 },
    purchased_on: '2024-05-20',
  },
  { name: 'Kidde smoke detector', quantity: 3, purchased_on: '2025-12-01' },
  { name: 'Brita water filter pitcher', purchased_on: '2026-06-15' },
  { name: 'Furnace air filter', category: 'hvac_filter', purchased_on: '2026-07-01' },
  { name: 'Dyson V8 vacuum', purchased_on: '2025-11-28' },
  { name: 'IKEA Malm dresser', category: 'furniture' },
  { name: 'Fisher-Price baby swing', purchased_on: '2026-01-10' },
  { name: 'Romaine lettuce', category: 'food' },
  { name: "Children's acetaminophen", category: 'medication' },
];

async function main() {
  const client = new Client({ name: 'seed', version: '0.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(url), {
      requestInit: { headers: { authorization: `Bearer ${token}` } },
    }),
  );
  for (const item of ITEMS) {
    const r = await client.callTool({ name: 'add_item', arguments: item });
    console.log(`+ ${item.name}${r.isError ? '  (error)' : ''}`);
  }
  console.log('\nwaiting for targeted sweeps…');
  await new Promise((r) => setTimeout(r, 8000));
  const check = await client.callTool({ name: 'check_recalls', arguments: {} });
  const data = check.structuredContent as {
    matches: Array<{
      item: { name: string };
      recall: { id: string; title: string };
      confidence: number;
    }>;
  };
  console.log(`\n${data.matches.length} recall match(es):`);
  for (const m of data.matches)
    console.log(
      `  ${m.confidence.toFixed(2)}  ${m.item.name}  ←  ${m.recall.id}  ${m.recall.title.slice(0, 70)}`,
    );
  await client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

import { AnthropicBedrockMantle } from '@anthropic-ai/bedrock-sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import { ItemCategory, type Item, type RecallRecord } from '@custodian/shared';
import type { Config } from '../config.js';
import type { Enricher, ItemNormalization, MatchJudgement } from './types.js';

const Normalization = z.object({
  brand: z.string().nullable(),
  model: z.string().nullable(),
  category: ItemCategory,
  aliases: z.array(z.string()).max(6),
  canonical_name: z.string(),
});

const Judgement = z.object({
  applies: z.enum(['yes', 'no', 'unsure']),
  confidence: z.number().min(0).max(1),
  reason: z.string().max(200),
});

/** The subset of the Anthropic client the enricher uses — lets tests inject a fake. */
export interface ParseClient {
  messages: {
    parse: (params: {
      model: string;
      max_tokens: number;
      system?: string;
      messages: Array<{ role: 'user'; content: string }>;
      output_config: unknown;
    }) => Promise<{ parsed_output: unknown }>;
  };
}

const SYSTEM_NORMALIZE =
  'You turn how a person describes something they own into a structured product record for recall matching. ' +
  'Use only what the text implies; do not invent model numbers. Aliases are other short phrases the same person might say for this item. ' +
  'Categories: car_seat, stroller, crib, toy, appliance, electronics, furniture, vehicle, food, medication, medical_device, tool, heater, smoke_detector, water_filter, hvac_filter, other.';

const SYSTEM_JUDGE =
  'You decide whether a published product recall applies to a specific item a household owns. ' +
  'Say "yes" only when brand and product line clearly match; "no" when the brand, product type or model plainly differ; "unsure" otherwise. Be brief.';

/**
 * Claude on Amazon Bedrock via the Mantle (Messages API) endpoint with structured outputs.
 * Runs only inside the sweep; a failure degrades to the deterministic path.
 */
export class BedrockEnricher implements Enricher {
  private readonly client: ParseClient;
  private readonly model: string;

  constructor(config: Pick<Config, 'bedrockRegion' | 'bedrockModel'>, client?: ParseClient) {
    this.client = client ?? (new AnthropicBedrockMantle({ awsRegion: config.bedrockRegion }) as unknown as ParseClient);
    this.model = config.bedrockModel;
  }

  async normalizeItem(item: Item): Promise<ItemNormalization | undefined> {
    const text = [
      `Spoken description: "${item.name}"`,
      item.brand ? `Brand given: ${item.brand}` : '',
      item.model ? `Model given: ${item.model}` : '',
      item.notes ? `Notes: ${item.notes}` : '',
    ]
      .filter(Boolean)
      .join('\n');
    const res = await this.client.messages.parse({
      model: this.model,
      max_tokens: 1024,
      system: SYSTEM_NORMALIZE,
      messages: [{ role: 'user', content: text }],
      output_config: { format: zodOutputFormat(Normalization) },
    });
    const parsed = Normalization.safeParse(res.parsed_output);
    if (!parsed.success) return undefined;
    const p = parsed.data;
    return { brand: p.brand ?? undefined, model: p.model ?? undefined, category: p.category, aliases: p.aliases, canonical_name: p.canonical_name };
  }

  async judgeMatch(item: Item, recall: RecallRecord): Promise<MatchJudgement | undefined> {
    const owned = [item.name, item.brand && `brand ${item.brand}`, item.model && `model ${item.model}`, `category ${item.category}`, item.purchased_on && `bought ${item.purchased_on}`]
      .filter(Boolean)
      .join(', ');
    const products = recall.products.map((p) => [p.brand, p.name, p.model].filter(Boolean).join(' ')).join('; ');
    const content = `Household item: ${owned}\n\nRecall (${recall.source.toUpperCase()}, ${recall.published_on}): ${recall.title}\nProducts: ${products || 'n/a'}\nDetails: ${recall.summary}`;
    const res = await this.client.messages.parse({
      model: this.model,
      max_tokens: 512,
      system: SYSTEM_JUDGE,
      messages: [{ role: 'user', content }],
      output_config: { format: zodOutputFormat(Judgement) },
    });
    const parsed = Judgement.safeParse(res.parsed_output);
    return parsed.success ? parsed.data : undefined;
  }
}

export function createEnricher(config: Config): Enricher | undefined {
  return config.bedrockEnabled ? new BedrockEnricher(config) : undefined;
}

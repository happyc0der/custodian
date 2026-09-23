import {
  CreateTableCommand,
  DynamoDBClient,
  UpdateTimeToLiveCommand,
  waitUntilTableExists,
} from '@aws-sdk/client-dynamodb';
import {
  BatchWriteCommand,
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import type { Household, Item, Match, MaintenanceRule, RecallRecord } from '@custodian/shared';
import type { Config } from '../config.js';
import type { Store } from './types.js';

/**
 * Single-table DynamoDB store.
 *
 *   PK               SK                 payload
 *   H#<household>    HOUSEHOLD          Household
 *   H#<household>    ITEM#<id>          Item
 *   H#<household>    MATCH#<id>         Match
 *   H#<household>    RULE#<id>          MaintenanceRule
 *   HOUSEHOLDS       <household>        (index row for the sweeper)
 *   RECALL           <recall id>        RecallRecord (shared corpus)
 *   META             <key>              { value }
 *   AUTH             <key>              { value, expiresAt, ttl }   ← DynamoDB TTL on `ttl`
 */
export class DynamoStore implements Store {
  private constructor(
    private readonly doc: DynamoDBDocumentClient,
    private readonly table: string,
  ) {}

  static async open(config: Config, client?: DynamoDBClient): Promise<DynamoStore> {
    const raw = client ?? new DynamoDBClient({ region: config.awsRegion });
    const doc = DynamoDBDocumentClient.from(raw, {
      marshallOptions: { removeUndefinedValues: true },
    });
    return new DynamoStore(doc, config.dynamoTable);
  }

  /** Creates the table (used by tests and the first local run; CDK owns it in production). */
  static async ensureTable(client: DynamoDBClient, table: string): Promise<void> {
    try {
      await client.send(
        new CreateTableCommand({
          TableName: table,
          BillingMode: 'PAY_PER_REQUEST',
          AttributeDefinitions: [
            { AttributeName: 'PK', AttributeType: 'S' },
            { AttributeName: 'SK', AttributeType: 'S' },
          ],
          KeySchema: [
            { AttributeName: 'PK', KeyType: 'HASH' },
            { AttributeName: 'SK', KeyType: 'RANGE' },
          ],
        }),
      );
      await waitUntilTableExists({ client, maxWaitTime: 30 }, { TableName: table });
      await client
        .send(
          new UpdateTimeToLiveCommand({
            TableName: table,
            TimeToLiveSpecification: { AttributeName: 'ttl', Enabled: true },
          }),
        )
        .catch(() => {});
    } catch (err) {
      if ((err as { name?: string }).name !== 'ResourceInUseException') throw err;
    }
  }

  private async get<T>(pk: string, sk: string): Promise<T | undefined> {
    const r = await this.doc.send(
      new GetCommand({ TableName: this.table, Key: { PK: pk, SK: sk } }),
    );
    return r.Item ? (r.Item.data as T) : undefined;
  }

  private async put(
    pk: string,
    sk: string,
    data: unknown,
    extra: Record<string, unknown> = {},
  ): Promise<void> {
    await this.doc.send(
      new PutCommand({ TableName: this.table, Item: { PK: pk, SK: sk, data, ...extra } }),
    );
  }

  private async del(pk: string, sk: string): Promise<boolean> {
    const r = await this.doc.send(
      new DeleteCommand({
        TableName: this.table,
        Key: { PK: pk, SK: sk },
        ReturnValues: 'ALL_OLD',
      }),
    );
    return Boolean(r.Attributes);
  }

  private async query<T>(
    pk: string,
    skPrefix?: string,
  ): Promise<Array<{ sk: string; data: T; raw: Record<string, unknown> }>> {
    const out: Array<{ sk: string; data: T; raw: Record<string, unknown> }> = [];
    let ExclusiveStartKey: Record<string, unknown> | undefined;
    do {
      const r = await this.doc.send(
        new QueryCommand({
          TableName: this.table,
          KeyConditionExpression: skPrefix ? 'PK = :pk AND begins_with(SK, :sk)' : 'PK = :pk',
          ExpressionAttributeValues: skPrefix ? { ':pk': pk, ':sk': skPrefix } : { ':pk': pk },
          ExclusiveStartKey,
        }),
      );
      for (const it of r.Items ?? [])
        out.push({ sk: it.SK as string, data: it.data as T, raw: it });
      ExclusiveStartKey = r.LastEvaluatedKey;
    } while (ExclusiveStartKey);
    return out;
  }

  private async batchDelete(keys: Array<{ PK: string; SK: string }>): Promise<void> {
    for (let i = 0; i < keys.length; i += 25) {
      const chunk = keys.slice(i, i + 25);
      let unprocessed: Record<string, unknown[]> | undefined = {
        [this.table]: chunk.map((Key) => ({ DeleteRequest: { Key } })),
      };
      while (unprocessed && Object.keys(unprocessed).length) {
        const r = await this.doc.send(
          new BatchWriteCommand({ RequestItems: unprocessed as never }),
        );
        unprocessed = r.UnprocessedItems as Record<string, unknown[]> | undefined;
      }
    }
  }

  /* households */
  getHousehold(id: string) {
    return this.get<Household>(`H#${id}`, 'HOUSEHOLD');
  }
  async putHousehold(h: Household) {
    await this.put(`H#${h.id}`, 'HOUSEHOLD', h);
    await this.put('HOUSEHOLDS', h.id, { id: h.id });
  }
  async listHouseholdIds() {
    return (await this.query<{ id: string }>('HOUSEHOLDS')).map((r) => r.data.id);
  }

  /* items */
  async listItems(householdId: string) {
    return (await this.query<Item>(`H#${householdId}`, 'ITEM#')).map((r) => r.data);
  }
  getItem(householdId: string, itemId: string) {
    return this.get<Item>(`H#${householdId}`, `ITEM#${itemId}`);
  }
  putItem(item: Item) {
    return this.put(`H#${item.household_id}`, `ITEM#${item.id}`, item);
  }
  deleteItem(householdId: string, itemId: string) {
    return this.del(`H#${householdId}`, `ITEM#${itemId}`);
  }

  /* matches */
  async listMatches(householdId: string) {
    return (await this.query<Match>(`H#${householdId}`, 'MATCH#')).map((r) => r.data);
  }
  getMatch(householdId: string, matchId: string) {
    return this.get<Match>(`H#${householdId}`, `MATCH#${matchId}`);
  }
  putMatch(match: Match) {
    return this.put(`H#${match.household_id}`, `MATCH#${match.id}`, match);
  }
  deleteMatch(householdId: string, matchId: string) {
    return this.del(`H#${householdId}`, `MATCH#${matchId}`);
  }
  async deleteMatchesForItem(householdId: string, itemId: string) {
    const rows = (await this.query<Match>(`H#${householdId}`, 'MATCH#')).filter(
      (r) => r.data.item_id === itemId,
    );
    await this.batchDelete(rows.map((r) => ({ PK: `H#${householdId}`, SK: r.sk })));
  }

  /* rules */
  async listRules(householdId: string) {
    return (await this.query<MaintenanceRule>(`H#${householdId}`, 'RULE#')).map((r) => r.data);
  }
  getRule(householdId: string, ruleId: string) {
    return this.get<MaintenanceRule>(`H#${householdId}`, `RULE#${ruleId}`);
  }
  putRule(rule: MaintenanceRule) {
    return this.put(`H#${rule.household_id}`, `RULE#${rule.id}`, rule);
  }
  deleteRule(householdId: string, ruleId: string) {
    return this.del(`H#${householdId}`, `RULE#${ruleId}`);
  }
  async deleteRulesForItem(householdId: string, itemId: string) {
    const rows = (await this.query<MaintenanceRule>(`H#${householdId}`, 'RULE#')).filter(
      (r) => r.data.item_id === itemId,
    );
    await this.batchDelete(rows.map((r) => ({ PK: `H#${householdId}`, SK: r.sk })));
  }

  /* recalls */
  getRecall(id: string) {
    return this.get<RecallRecord>('RECALL', id);
  }
  async putRecalls(records: RecallRecord[]) {
    for (let i = 0; i < records.length; i += 25) {
      const chunk = records.slice(i, i + 25);
      let unprocessed: Record<string, unknown[]> | undefined = {
        [this.table]: chunk.map((r) => ({
          PutRequest: { Item: { PK: 'RECALL', SK: r.id, data: r } },
        })),
      };
      while (unprocessed && Object.keys(unprocessed).length) {
        const res = await this.doc.send(
          new BatchWriteCommand({ RequestItems: unprocessed as never }),
        );
        unprocessed = res.UnprocessedItems as Record<string, unknown[]> | undefined;
      }
    }
  }
  async listRecalls() {
    return (await this.query<RecallRecord>('RECALL')).map((r) => r.data);
  }
  async clearRecalls() {
    const rows = await this.query<RecallRecord>('RECALL');
    await this.batchDelete(rows.map((r) => ({ PK: 'RECALL', SK: r.sk })));
  }

  /* auth */
  async getAuth(key: string) {
    const r = await this.doc.send(
      new GetCommand({ TableName: this.table, Key: { PK: 'AUTH', SK: key } }),
    );
    if (!r.Item) return undefined;
    if ((r.Item.expiresAt as number) <= Date.now()) {
      await this.del('AUTH', key);
      return undefined;
    }
    return r.Item.value as string;
  }
  async putAuth(key: string, value: string, expiresAt: number) {
    await this.doc.send(
      new PutCommand({
        TableName: this.table,
        Item: { PK: 'AUTH', SK: key, value, expiresAt, ttl: Math.ceil(expiresAt / 1000) },
      }),
    );
  }
  async deleteAuth(key: string) {
    await this.del('AUTH', key);
  }

  /* meta */
  async getMeta(key: string) {
    return (await this.get<{ value: string }>('META', key))?.value;
  }
  putMeta(key: string, value: string) {
    return this.put('META', key, { value });
  }
  setMeta(key: string, value: string) {
    return this.putMeta(key, value);
  }

  async flush() {
    /* writes are synchronous with respect to the API */
  }
}

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import dynalite from 'dynalite';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Household, Item, Match, MaintenanceRule, RecallRecord } from '@custodian/shared';
import { loadConfig } from '../src/config.js';
import { DynamoStore } from '../src/store/dynamo.js';
import { FileStore } from '../src/store/file.js';
import type { Store } from '../src/store/types.js';

const t = '2026-09-11T00:00:00.000Z';
const household: Household = { id: 'h1', name: 'Home', created_at: t };
const item = (id: string, name: string): Item => ({ id, household_id: 'h1', name, category: 'other', quantity: 1, aliases: [], enrichment_status: 'pending', created_at: t, updated_at: t });
const match = (id: string, itemId: string): Match => ({ id, household_id: 'h1', item_id: itemId, recall_id: 'cpsc:1', confidence: 1, reason: 'r', status: 'new', created_at: t, updated_at: t });
const rule = (id: string, itemId: string): MaintenanceRule => ({ id, household_id: 'h1', item_id: itemId, kind: 'custom', label: 'x', next_due: '2026-10-01', created_at: t });
const recall = (id: string): RecallRecord => ({ id, source: 'cpsc', external_id: id, title: 't', summary: 's', hazard: 'h', remedy: 'r', remedy_options: [], published_on: '2026-01-01', products: [], categories: [], severity: 'low', keywords: [] });

/** The Store contract every backend must satisfy. */
function contract(name: string, open: () => Promise<Store>) {
  describe(`Store contract: ${name}`, () => {
    let s: Store;
    beforeAll(async () => {
      s = await open();
    });

    it('households + index', async () => {
      expect(await s.getHousehold('h1')).toBeUndefined();
      await s.putHousehold(household);
      expect(await s.getHousehold('h1')).toEqual(household);
      expect(await s.listHouseholdIds()).toEqual(['h1']);
    });

    it('items are scoped per household', async () => {
      await s.putItem(item('i1', 'one'));
      await s.putItem(item('i2', 'two'));
      await s.putItem({ ...item('i3', 'other house'), household_id: 'h2' });
      expect((await s.listItems('h1')).map((i) => i.id).sort()).toEqual(['i1', 'i2']);
      expect(await s.getItem('h1', 'i3')).toBeUndefined();
      expect(await s.deleteItem('h1', 'i2')).toBe(true);
      expect(await s.deleteItem('h1', 'i2')).toBe(false);
    });

    it('matches and rules cascade per item', async () => {
      await s.putMatch(match('m1', 'i1'));
      await s.putMatch(match('m2', 'i1'));
      await s.putMatch(match('m3', 'ix'));
      await s.putRule(rule('r1', 'i1'));
      await s.putRule(rule('r2', 'ix'));
      expect((await s.listMatches('h1')).length).toBe(3);
      expect(await s.deleteMatch('h1', 'm2')).toBe(true);
      await s.deleteMatchesForItem('h1', 'i1');
      expect((await s.listMatches('h1')).map((m) => m.id)).toEqual(['m3']);
      expect(await s.deleteRule('h1', 'r1')).toBe(true);
      await s.deleteRulesForItem('h1', 'ix');
      expect(await s.listRules('h1')).toEqual([]);
    });

    it('recalls are a shared corpus with batch writes and clear', async () => {
      const many = Array.from({ length: 60 }, (_, i) => recall(`cpsc:${i}`));
      await s.putRecalls(many);
      expect((await s.listRecalls()).length).toBe(60);
      expect(await s.getRecall('cpsc:59')).toMatchObject({ id: 'cpsc:59' });
      await s.putRecalls([{ ...recall('cpsc:59'), title: 'updated' }]);
      expect((await s.getRecall('cpsc:59'))?.title).toBe('updated');
      await s.clearRecalls();
      expect(await s.listRecalls()).toEqual([]);
    });

    it('meta and expiring auth entries', async () => {
      await s.setMeta('k', 'v');
      expect(await s.getMeta('k')).toBe('v');
      await s.putAuth('code:1', 'grant', Date.now() + 60_000);
      await s.putAuth('code:old', 'stale', Date.now() - 1);
      expect(await s.getAuth('code:1')).toBe('grant');
      expect(await s.getAuth('code:old')).toBeUndefined();
      await s.deleteAuth('code:1');
      expect(await s.getAuth('code:1')).toBeUndefined();
    });
  });
}

contract('FileStore', async () => new FileStore(':memory:'));

describe('DynamoStore (dynalite)', () => {
  const server = dynalite({ createTableMs: 0, deleteTableMs: 0, updateTableMs: 0 });
  let client: DynamoDBClient;
  beforeAll(async () => {
    await new Promise<void>((resolve) => server.listen(0, () => resolve()));
    const port = (server.address() as AddressInfo).port;
    client = new DynamoDBClient({ region: 'local', endpoint: `http://127.0.0.1:${port}`, credentials: { accessKeyId: 'x', secretAccessKey: 'y' } });
    await DynamoStore.ensureTable(client, 'custodian-test');
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  contract('DynamoStore', async () => DynamoStore.open(loadConfig({ dynamoTable: 'custodian-test' }), client));
});

require('reflect-metadata');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { randomUUID } = require('node:crypto');
const jwt = require('jsonwebtoken');
const { Module } = require('@nestjs/common');
const { NestFactory } = require('@nestjs/core');
const { ConfigService } = require('@nestjs/config');
const { PrismaClient } = require('@prisma/client');
const { AuthMiddleware } = require('../dist/auth/auth.middleware');
const { SalesforceSyncController } = require('../dist/salesforce-sync/salesforce-sync.controller');
const { SalesforceSyncService } = require('../dist/salesforce-sync/salesforce-sync.service');
const { SalesforceSyncClient } = require('../dist/salesforce-sync/salesforce-sync.client');
const { planSync } = require('../dist/salesforce-sync/salesforce-sync.plan');
const { CLIENT_SALESFORCE_FIELDS, BILLING_ACCOUNT_SALESFORCE_FIELDS } = require('../dist/common/salesforce-metadata');

/** Makes a complete synthetic source record; overrides supply individual test values. */
function source(fields, id, extra = {}) {
  return { ...Object.fromEntries(Object.values(fields).map(field => [field, null])), Id: id, ...extra };
}
const account = source(CLIENT_SALESFORCE_FIELDS, '001000000000001AAA', {
  Topcoder_Client_id__c: 'client-one', Account_Status__c: 'Managed', BillingCity: 'Hobart',
  BillingStreet: 'Example street', BillingState: 'Tasmania', BillingPostalCode: '7000',
  BillingCountry: 'Australia', Phone: '+61 1234', Website: 'https://example.com',
  Industry: 'Technology', ParentId: '001000000000002AAA', Payment_Terms__c: 'Net 30',
});
const billing = source(BILLING_ACCOUNT_SALESFORCE_FIELDS, 'a01000000000001AAA', {
  TopCoder_Billing_Account_Id__c: '10', Billing_Account_Type__c: 'Customer',
  Billing_Notes__c: 'Invoice notes\nSecond line', Billing_Frequency__c: 'Monthly',
  Opportunity__c: '006000000000001AAA', Subscription__c: 'a02000000000001AAA',
  SPOC__c: '005000000000001AAA', Secondary_SPOC__c: '005000000000002AAA',
  Cost_Center__c: 'Engineering', Workday_Contract_Number__c: 'WD-123',
});

test('plans every metadata field, including opportunity, and never copies financial fields', () => {
  const plan = planSync([{ id: 10, budget: 100, status: 'INACTIVE' }], [billing],
    BILLING_ACCOUNT_SALESFORCE_FIELDS, 'salesforceBillingAccountId', 'TopCoder_Billing_Account_Id__c');
  assert.deepEqual(plan.counts, { scanned: 1, updated: 1, unchanged: 0, unmatched: 0, conflicted: 0 });
  assert.equal(plan.updates[0].data.opportunity, billing.Opportunity__c);
  assert.deepEqual(Object.keys(plan.updates[0].data), Object.keys(BILLING_ACCOUNT_SALESFORCE_FIELDS));
  const clientPlan = planSync([{ id: 'client-one' }], [account], CLIENT_SALESFORCE_FIELDS,
    'salesforceAccountId', 'Topcoder_Client_id__c');
  for (const [local, field] of Object.entries(CLIENT_SALESFORCE_FIELDS)) {
    assert.equal(clientPlan.updates[0].data[local], account[field]);
  }
});

test('matches numeric and UUID client IDs, existing 15-character Salesforce IDs and null clears', () => {
  for (const id of ['123', randomUUID()]) {
    const plan = planSync([{ id }], [{ ...account, Topcoder_Client_id__c: ` ${id} ` }],
      CLIENT_SALESFORCE_FIELDS, 'salesforceAccountId', 'Topcoder_Client_id__c');
    assert.equal(plan.counts.updated, 1);
  }
  const plan = planSync([{ id: 'unlinked', salesforceAccountId: account.Id.slice(0, 15), phone: 'old' }],
    [{ ...account, Topcoder_Client_id__c: null, Phone: null }], CLIENT_SALESFORCE_FIELDS,
    'salesforceAccountId', 'Topcoder_Client_id__c');
  assert.equal(plan.updates[0].data.phone, null);
  assert.equal(plan.updates[0].data.salesforceAccountId, account.Id);
});

test('counts unmatched, conflicting and duplicate identities without guessing by name', () => {
  const fields = CLIENT_SALESFORCE_FIELDS;
  const records = [account, { ...account, Id: '001000000000002AAA', Topcoder_Client_id__c: 'other' }];
  const cases = [
    [[{ id: 'missing', name: 'same name' }], records, 'unmatched'],
    [[{ id: 'client-one' }], [...records, { ...account, Id: '001000000000003AAA' }], 'conflicted'],
    [[{ id: 'client-one', salesforceAccountId: records[1].Id }], records, 'conflicted'],
    [[{ id: 'other', salesforceAccountId: account.Id }], records, 'conflicted'],
    [[{ id: 'client-one', salesforceAccountId: '001000000009999AAA' }], records, 'conflicted'],
  ];
  for (const [rows, sourceRecords, status] of cases) {
    const plan = planSync(rows, sourceRecords, fields, 'salesforceAccountId', 'Topcoder_Client_id__c');
    assert.equal(plan.counts[status], 1);
    assert.equal(plan.updates.length, 0);
  }
  const shared = planSync([{ id: 'client-one' }, { id: 'owner', salesforceAccountId: account.Id }],
    records, fields, 'salesforceAccountId', 'Topcoder_Client_id__c');
  assert.equal(shared.counts.conflicted, 2);
  assert.equal(shared.updates.length, 0);
});

test('SOQL client follows pagination, renews an expired session and preserves all fields', async t => {
  const requests = [];
  const responses = [
    new Response('', { status: 401 }),
    Response.json({ access_token: 'renewed', instance_url: 'https://example.my.salesforce.com' }),
    Response.json({ records: [account], done: false, nextRecordsUrl: '/services/data/v65.0/query/page-2000' }),
    Response.json({ records: [{ ...account, Id: '001000000000002AAA' }], done: true }),
  ];
  t.mock.method(global, 'fetch', async (url, init) => { requests.push({ url, init }); return responses.shift(); });
  const client = new SalesforceSyncClient(new ConfigService({
    SALESFORCE_API_CONSUMER_KEY: 'test-key', SALESFORCE_API_CONSUMER_SECRET: 'test-secret',
  }));
  const records = await client.queryAll('Account', Object.values(CLIENT_SALESFORCE_FIELDS),
    { access_token: 'expired', instance_url: 'https://example.my.salesforce.com' });
  assert.equal(records.length, 2);
  assert.equal(records[0].BillingCity, 'Hobart');
  assert.equal(requests[2].init.headers.Authorization, 'Bearer renewed');
  assert.equal(requests[3].url, 'https://example.my.salesforce.com/services/data/v65.0/query/page-2000');
  assert.match(new URL(requests[0].url).searchParams.get('q'), /SELECT Id,Account_Status__c/);
});

test('rejects incomplete snapshots, unsafe cursors, missing config and sanitized upstream failures', async t => {
  const client = new SalesforceSyncClient(new ConfigService({}));
  await assert.rejects(client.authenticate(), error => error.getStatus() === 503);
  for (const page of [
    { records: [{ Id: account.Id }], done: true },
    { records: [account], done: false, nextRecordsUrl: 'https://attacker.example/steal' },
    { records: [account], done: false },
  ]) {
    const mock = t.mock.method(global, 'fetch', async () => Response.json(page));
    await assert.rejects(client.queryAll('Account', Object.values(CLIENT_SALESFORCE_FIELDS),
      { access_token: 'secret', instance_url: 'https://example.my.salesforce.com' }), error => error.getStatus() === 502);
    mock.mock.restore();
  }
  t.mock.method(global, 'fetch', async () => new Response('sensitive upstream body', { status: 403 }));
  await assert.rejects(client.queryAll('Account', ['Id'],
    { access_token: 'secret', instance_url: 'https://example.my.salesforce.com' }),
  error => error.getStatus() === 502 && !error.message.includes('sensitive'));
});

const testUrl = process.env.TEST_DATABASE_URL;
test('real JWT endpoint and database: metadata, idempotency, null clears, rollback and cross-instance lock',
  { skip: !testUrl }, async t => {
    const url = new URL(testUrl);
    assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname));
    assert.match(url.pathname, /_test$/);
    const db = new PrismaClient({ datasources: { db: { url: testUrl } } });
    t.after(() => db.$disconnect());
    const id = randomUUID();
    await db.client.create({ data: { id, name: 'Synthetic sync client', codeName: 'KEEP', status: 'INACTIVE' } });
    const ba = await db.billingAccount.create({ data: {
      name: 'Synthetic sync billing', clientId: id, budget: 100, markup: 0.2,
      status: 'INACTIVE', paymentTerms: 'KEEP', subscriptionNumber: 'KEEP', description: 'KEEP',
    } });
    // Cross both local keyset page boundaries with unrelated legacy records.
    const legacyIds = Array.from({ length: 501 }, () => randomUUID());
    await db.client.createMany({ data: legacyIds.map(legacyId => ({ id: legacyId, name: 'Unmatched legacy client' })) });
    await db.billingAccount.createMany({ data: legacyIds.map(() => ({
      name: 'Unmatched legacy billing', clientId: id, budget: 50, markup: 0.1,
    })) });
    t.after(async () => {
      await db.billingAccount.deleteMany({ where: { clientId: id } });
      await db.client.delete({ where: { id } });
      await db.client.deleteMany({ where: { id: { in: legacyIds } } });
    });
    let snapshots = [
      [{ ...account, Topcoder_Client_id__c: id }],
      [{ ...billing, TopCoder_Billing_Account_Id__c: String(ba.id) }],
    ];
    let queried = 0;
    const sf = {
      authenticate: async () => ({ access_token: 'fixture', instance_url: 'https://example.my.salesforce.com' }),
      queryAll: async object => { queried++; return snapshots[object === 'Account' ? 0 : 1]; },
    };
    const service = new SalesforceSyncService(db, sf);
    class TestModule {}
    Module({ controllers: [SalesforceSyncController], providers: [{ provide: SalesforceSyncService, useValue: service }] })(TestModule);
    const app = await NestFactory.create(TestModule, { logger: false });
    const previousSecret = process.env.AUTH_SECRET;
    const previousIssuers = process.env.VALID_ISSUERS;
    process.env.AUTH_SECRET = 'test-only-sf-sync-secret';
    process.env.VALID_ISSUERS = '["https://sync-test.example"]';
    const auth = new AuthMiddleware();
    app.use(auth.use.bind(auth));
    app.setGlobalPrefix('v6');
    await app.listen(0, '127.0.0.1');
    t.after(async () => {
      await app.close();
      if (previousSecret === undefined) delete process.env.AUTH_SECRET; else process.env.AUTH_SECRET = previousSecret;
      if (previousIssuers === undefined) delete process.env.VALID_ISSUERS; else process.env.VALID_ISSUERS = previousIssuers;
    });
    const endpoint = `${await app.getUrl()}/v6/billing-accounts/salesforce-sync`;
    /** Signs a synthetic user token for the real authentication middleware. */
    const token = payload => jwt.sign(payload, process.env.AUTH_SECRET, { issuer: 'https://sync-test.example', expiresIn: '1h' });
    /** Executes the real HTTP endpoint with an optional bearer token. */
    const post = bearer => fetch(endpoint, { method: 'POST', headers: bearer ? { Authorization: `Bearer ${bearer}` } : {} });
    for (const bearer of [undefined, 'invalid', token({ roles: ['Talent Manager'], userId: '123' }),
      jwt.sign({ roles: ['administrator'], userId: '123' }, 'wrong-signature', { issuer: 'https://sync-test.example' }),
      jwt.sign({ roles: ['administrator'], userId: '123' }, process.env.AUTH_SECRET,
        { issuer: 'https://sync-test.example', expiresIn: -1 }),
      token({ gty: 'client-credentials', azp: 'test', scope: 'all:billing-account all:client' })]) {
      assert.equal((await post(bearer)).status, 403);
    }
    assert.equal(queried, 0);
    const admin = token({ roles: ['Administrator'], userId: '123' });
    let response = await post(admin);
    assert.equal(response.status, 200, await response.clone().text());
    let result = await response.json();
    assert.equal(result.clients.updated, 1);
    assert.equal(result.billingAccounts.updated, 1);
    assert.equal(result.clients.scanned, 502);
    assert.equal(result.billingAccounts.scanned, 502);
    assert.equal(result.clients.unmatched, 501);
    assert.equal(result.billingAccounts.unmatched, 501);
    let saved = await db.billingAccount.findUnique({ where: { id: ba.id } });
    for (const [local, field] of Object.entries(BILLING_ACCOUNT_SALESFORCE_FIELDS)) assert.equal(saved[local], billing[field]);
    assert.equal(saved.budget.toString(), '100');
    assert.equal(saved.markup.toString(), '0.2');
    assert.equal(saved.status, 'INACTIVE');
    for (const key of ['paymentTerms', 'subscriptionNumber', 'description']) assert.equal(saved[key], 'KEEP');
    const client = await db.client.findUnique({ where: { id } });
    for (const [local, field] of Object.entries(CLIENT_SALESFORCE_FIELDS)) assert.equal(client[local], account[field]);
    assert.equal(client.codeName, 'KEEP');
    assert.equal(client.status, 'INACTIVE');
    result = await (await post(admin)).json();
    assert.equal(result.clients.unchanged, 1);
    assert.equal(result.billingAccounts.unchanged, 1);
    snapshots[1][0].Opportunity__c = null;
    await post(admin);
    assert.equal((await db.billingAccount.findUnique({ where: { id: ba.id } })).opportunity, null);
    snapshots[0][0].BillingCity = 'Will be rolled back';
    const originalQuery = sf.queryAll;
    sf.queryAll = async object => {
      if (object !== 'Account') throw new (require('@nestjs/common').BadGatewayException)('Salesforce unavailable');
      return snapshots[0];
    };
    assert.equal((await post(admin)).status, 502);
    assert.equal((await db.client.findUnique({ where: { id } })).billingCity, 'Hobart');
    sf.queryAll = originalQuery;
    snapshots[1][0].Opportunity__c = 'too-long-for-a-salesforce-id';
    assert.equal((await post(admin)).status, 500);
    assert.equal((await db.client.findUnique({ where: { id } })).billingCity, 'Hobart');
    snapshots[1][0].Opportunity__c = billing.Opportunity__c;
    let release;
    let locked;
    const gate = new Promise(resolve => { release = resolve; });
    const acquired = new Promise(resolve => { locked = resolve; });
    const holding = db.$transaction(async tx => {
      await tx.$queryRaw`SELECT pg_try_advisory_xact_lock(736291, 1) AS locked`;
      locked();
      await gate;
    });
    await acquired;
    try { assert.equal((await post(admin)).status, 409); } finally { release(); await holding; }
    assert.equal((await post(admin)).status, 200);
  });

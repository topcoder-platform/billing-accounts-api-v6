require("reflect-metadata");
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { randomUUID } = require("node:crypto");
const { Module, ValidationPipe } = require("@nestjs/common");
const { NestFactory } = require("@nestjs/core");
const { SwaggerModule, DocumentBuilder } = require("@nestjs/swagger");
const { PrismaClient } = require("@prisma/client");
const { ClientsController } = require("../dist/clients/clients.controller");
const { ClientsService } = require("../dist/clients/clients.service");
const {
  BillingAccountsController,
} = require("../dist/billing-accounts/billing-accounts.controller");
const {
  BillingAccountsService,
} = require("../dist/billing-accounts/billing-accounts.service");
const {
  PrismaExceptionFilter,
} = require("../dist/common/filters/prisma-exception.filter");
const {
  CreateClientRequestDto,
} = require("../dist/clients/dto/create-client.dto");
const { UpdateClientDto } = require("../dist/clients/dto/update-client.dto");
const {
  CreateBillingAccountDto,
} = require("../dist/billing-accounts/dto/create-billing-account.dto");
const {
  UpdateBillingAccountDto,
} = require("../dist/billing-accounts/dto/update-billing-account.dto");

const clientMetadata = {
  salesforceAccountId: "001000000000001AAA",
  accountStatus: "Managed",
  billingStreet: "Street\nSuite 2",
  billingCity: "Hobart",
  billingState: "Tasmania",
  billingPostalCode: "7000",
  billingCountry: "Australia",
  phone: "+61 1234",
  website: "https://example.com",
  industry: "Technology",
  parentId: "001000000000002AAA",
  paymentTerms: "Net 30",
};
const billingMetadata = {
  salesforceBillingAccountId: "a01000000000001AAA",
  billingAccountType: "Customer",
  billingNotes: "Invoice notes\nSecond line",
  billingFrequency: "Monthly",
  opportunity: "006000000000001AAA",
  subscription: "a02000000000001AAA",
  spoc: "005000000000001AAA",
  secondarySpoc: "005000000000002AAA",
  costCenter: "Engineering",
  workdayContractNumber: "WD-123",
};
const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
});

/** Validates an HTTP body with the production pipe; rejects invalid or unknown properties. */
function validateBody(metatype, body) {
  return pipe.transform(body, { type: "body", metatype });
}

/** Checks every expected metadata field in a response; throws on lost or altered values. */
function assertMetadata(actual, expected) {
  for (const [field, value] of Object.entries(expected))
    assert.equal(actual[field], value, field);
}

/** Boots the real controllers/services with supplied persistence and a Salesforce fixture. */
async function createApp(db, summaries = []) {
  const clients = new ClientsService(db);
  const billing = new BillingAccountsService(
    db,
    {
      getExternalNames: async () => new Map(),
      getChallengeBillingMarkupsByIds: async () => new Map(),
    },
    {},
    {
      authenticate: async () => ({
        accessToken: "fixture",
        instanceUrl: "https://example.com",
      }),
      queryUserBillingAccounts: async () => summaries,
    },
  );
  // Test-only module: no production auth middleware or external lookup connections.
  class MetadataTestModule {}
  Module({
    controllers: [ClientsController, BillingAccountsController],
    providers: [
      { provide: ClientsService, useValue: clients },
      { provide: BillingAccountsService, useValue: billing },
    ],
  })(MetadataTestModule);
  const app = await NestFactory.create(MetadataTestModule, { logger: false });
  app.use((req, _res, next) => {
    req.authUser = {
      roles: [req.headers["x-test-role"] || "administrator"],
      userId: "123",
    };
    next();
  });
  app.useGlobalPipes(pipe);
  app.useGlobalFilters(new PrismaExceptionFilter());
  return app;
}

test("all metadata survives strict create/update validation; null clears and length/type checks", async () => {
  const client = await validateBody(CreateClientRequestDto, {
    param: { name: "Fixture", ...clientMetadata },
  });
  assertMetadata(client.param, clientMetadata);
  const billing = await validateBody(CreateBillingAccountDto, {
    name: "Fixture",
    clientId: "client",
    budget: 100,
    markup: 0.1,
    ...billingMetadata,
  });
  assertMetadata(billing, billingMetadata);
  for (const [dto, fields] of [
    [UpdateClientDto, clientMetadata],
    [UpdateBillingAccountDto, billingMetadata],
  ]) {
    assertMetadata(await validateBody(dto, fields), fields);
    for (const field of Object.keys(fields)) {
      assert.equal((await validateBody(dto, { [field]: null }))[field], null);
      await assert.rejects(validateBody(dto, { [field]: 123 }));
    }
    await assert.rejects(validateBody(dto, { unknownMetadata: "bad" }));
  }
  for (const [field, max] of Object.entries({
    salesforceAccountId: 18,
    accountStatus: 255,
    billingStreet: 255,
    billingCity: 40,
    billingState: 80,
    billingPostalCode: 20,
    billingCountry: 80,
    phone: 40,
    website: 255,
    industry: 255,
    parentId: 18,
    paymentTerms: 255,
  })) {
    await validateBody(UpdateClientDto, { [field]: "a".repeat(max) });
    await assert.rejects(
      validateBody(UpdateClientDto, { [field]: "a".repeat(max + 1) }),
    );
  }
  for (const [field, max] of Object.entries({
    salesforceBillingAccountId: 18,
    billingAccountType: 255,
    billingNotes: 32768,
    billingFrequency: 255,
    opportunity: 18,
    subscription: 18,
    spoc: 18,
    secondarySpoc: 18,
    costCenter: 255,
    workdayContractNumber: 255,
  })) {
    await validateBody(UpdateBillingAccountDto, { [field]: "a".repeat(max) });
    await assert.rejects(
      validateBody(UpdateBillingAccountDto, { [field]: "a".repeat(max + 1) }),
    );
  }
  await assert.rejects(
    validateBody(UpdateClientDto, { salesforceAccountId: "invalid" }),
  );
  await assert.rejects(
    validateBody(UpdateBillingAccountDto, { spoc: "!".repeat(18) }),
  );
});

test("Swagger exposes nullable metadata for wrapped client POST and both PATCH DTOs", async () => {
  const app = await createApp({});
  try {
    const doc = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().build(),
    );
    const schemas = doc.components.schemas;
    const paramSchema = schemas.CreateClientRequestDto.properties.param;
    assert.equal(
      paramSchema.$ref || paramSchema.allOf?.[0]?.$ref,
      "#/components/schemas/CreateClientDto",
    );
    for (const [name, fields] of [
      ["CreateClientDto", clientMetadata],
      ["UpdateClientDto", clientMetadata],
      ["CreateBillingAccountDto", billingMetadata],
      ["UpdateBillingAccountDto", billingMetadata],
    ]) {
      for (const field of Object.keys(fields)) {
        assert.equal(
          schemas[name].properties[field].type,
          "string",
          `${name}.${field}`,
        );
        assert.equal(schemas[name].properties[field].nullable, true);
        assert.ok(!schemas[name].required?.includes(field));
      }
    }
  } finally {
    await app.close();
  }
});

test(
  "HTTP metadata round trip, unique constraints, null clearing, and Salesforce summary enrichment",
  {
    skip: !process.env.TEST_DATABASE_URL,
  },
  async () => {
    const url = new URL(process.env.TEST_DATABASE_URL);
    assert.ok(
      ["localhost", "127.0.0.1"].includes(url.hostname),
      "Requires local PostgreSQL",
    );
    assert.ok(
      url.pathname.endsWith("_test"),
      "Requires disposable database ending in _test",
    );
    const db = new PrismaClient({ datasourceUrl: url.toString() });
    const summaries = [];
    const app = await createApp(db, summaries);
    const clientIds = [];
    const billingIds = [];
    const tag = randomUUID();
    // Each run gets independent Salesforce IDs while preserving the required format.
    const cm = {
      ...clientMetadata,
      salesforceAccountId: `001${tag.replaceAll("-", "").slice(0, 15)}`,
    };
    const bm = {
      ...billingMetadata,
      salesforceBillingAccountId: `a01${tag.replaceAll("-", "").slice(0, 15)}`,
    };
    try {
      await app.listen(0, "127.0.0.1");
      const base = await app.getUrl();
      /** Sends fixture requests; asserts HTTP status and returns parsed JSON or throws. */
      async function request(
        path,
        method = "GET",
        body,
        status = 200,
        role = "administrator",
      ) {
        const response = await fetch(`${base}${path}`, {
          method,
          headers: { "content-type": "application/json", "x-test-role": role },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        const result = await response.json();
        assert.equal(response.status, status, JSON.stringify(result));
        return result;
      }
      const client = await request(
        "/clients",
        "POST",
        { param: { name: tag, ...cm } },
        201,
      );
      clientIds.push(client.id);
      assertMetadata(client, cm);
      assertMetadata(await request(`/clients/${client.id}`), cm);
      assertMetadata((await request(`/clients?name=${tag}`)).data[0], cm);
      const data = {
        name: tag,
        clientId: client.id,
        budget: 1000,
        markup: 0.15,
        ...bm,
      };
      const billing = await request("/billing-accounts", "POST", data, 201);
      billingIds.push(billing.id);
      assertMetadata(billing, bm);
      assertMetadata(await request(`/billing-accounts/${billing.id}`), bm);
      const listed = (await request(`/billing-accounts?clientId=${client.id}`))
        .data[0];
      assertMetadata(listed, bm);
      assertMetadata(listed.client, cm);
      const patchedClient = await request(`/clients/${client.id}`, "PATCH", {
        ...cm,
        phone: "updated",
      });
      assertMetadata(patchedClient, { ...cm, phone: "updated" });
      assertMetadata(
        await request(`/billing-accounts/${billing.id}`, "PATCH", {
          ...bm,
          costCenter: "updated",
        }),
        { ...bm, costCenter: "updated" },
      );
      await request(
        "/clients",
        "POST",
        { param: { name: tag, salesforceAccountId: cm.salesforceAccountId } },
        409,
      );
      await request("/billing-accounts", "POST", data, 409);
      await request(
        `/clients/${client.id}`,
        "PATCH",
        { billingCity: "x".repeat(41) },
        400,
      );
      await request(
        `/billing-accounts/${billing.id}`,
        "PATCH",
        { opportunity: 42 },
        400,
      );
      assertMetadata(
        await request(`/clients/${client.id}`, "PATCH", { name: tag }),
        { ...cm, phone: "updated" },
      );
      assertMetadata(
        await request(`/billing-accounts/${billing.id}`, "PATCH", {
          description: "legacy",
        }),
        { ...bm, costCenter: "updated" },
      );
      summaries.push(
        {
          tcBillingAccountId: billing.id,
          sfBillingAccountId: bm.salesforceBillingAccountId,
          name: "Salesforce summary name",
          startDate: "2026-01-01",
          endDate: null,
        },
        { tcBillingAccountId: null, name: "Unmatched Salesforce account" },
      );
      const enriched = await request(
        "/billing-accounts/users/123",
        "GET",
        undefined,
        200,
        "copilot",
      );
      assertMetadata(enriched[0], { ...bm, costCenter: "updated" });
      assertMetadata(enriched[0].client, { ...cm, phone: "updated" });
      assert.equal(enriched[0].name, "Salesforce summary name");
      assert.ok(!("markup" in enriched[0]));
      assert.ok(!("budget" in enriched[0]));
      assert.deepEqual(enriched[1], summaries[1]);
      summaries.length = 0;
      assert.deepEqual(await request("/billing-accounts/users/123"), []);
      const clearClient = Object.fromEntries(
        Object.keys(cm).map((key) => [key, null]),
      );
      const clearBilling = Object.fromEntries(
        Object.keys(bm).map((key) => [key, null]),
      );
      assertMetadata(
        await request(`/clients/${client.id}`, "PATCH", clearClient),
        clearClient,
      );
      assertMetadata(
        await request(`/billing-accounts/${billing.id}`, "PATCH", clearBilling),
        clearBilling,
      );
      assertMetadata(
        await db.client.findUniqueOrThrow({ where: { id: client.id } }),
        clearClient,
      );
      const saved = await db.billingAccount.findUniqueOrThrow({
        where: { id: billing.id },
      });
      assertMetadata(saved, clearBilling);
      assert.equal(saved.budget.toString(), "1000");
      assert.equal(saved.markup.toString(), "0.15");
      assert.equal(saved.description, "legacy");
    } finally {
      await app.close();
      await db.billingAccount.deleteMany({ where: { id: { in: billingIds } } });
      await db.client.deleteMany({ where: { id: { in: clientIds } } });
      await db.$disconnect();
    }
  },
);

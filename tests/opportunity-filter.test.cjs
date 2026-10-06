require("reflect-metadata");
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { ValidationPipe } = require("@nestjs/common");
const { QueryBillingAccountsDto } = require("../dist/billing-accounts/dto/query-billing-accounts.dto");
const { BillingAccountsService } = require("../dist/billing-accounts/billing-accounts.service");

test("opportunity filters accept both Salesforce ID forms and reject malformed IDs", async () => {
  const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
  for (const opportunity of ["006UN00000XamntYAB", "006UN00000XamntYAB".slice(0, 15)]) {
    const query = await pipe.transform({ opportunity }, { type: "query", metatype: QueryBillingAccountsDto });
    assert.equal(query.opportunity, opportunity);
  }
  for (const opportunity of ["", "006", "001UN00000XamntYAB", "006UN00000Xamn%YAB"]) {
    await assert.rejects(pipe.transform({ opportunity }, { type: "query", metatype: QueryBillingAccountsDto }));
  }
});

test("opportunity filters preserve access grants and pagination without excluding inactive accounts", async () => {
  const requests = [];
  const db = {
    $transaction: async (queries) => Promise.all(queries),
    billingAccount: {
      count: async (query) => { requests.push(query); return 0; },
      findMany: async (query) => { requests.push(query); return []; },
    },
    lockedAmount: { groupBy: async () => [] },
    consumedAmount: { groupBy: async () => [] },
  };
  const service = new BillingAccountsService(db, {}, {}, {});
  for (const opportunity of ["006UN00000XamntYAB", "006UN00000XamntYAB".slice(0, 15)]) {
    requests.length = 0;
    await service.list({ opportunity, userId: "another-user", page: 2, perPage: 5, sortBy: "id", sortOrder: "desc" }, {
      roles: ["Topcoder Project Manager"], userId: "123",
    });
    const expectedWhere = {
      opportunity: { startsWith: "006UN00000XamntYAB".slice(0, 15) },
      accessGrants: { some: { userId: "123" } },
    };
    assert.deepEqual(requests[0].where, expectedWhere);
    assert.deepEqual(requests[1].where, expectedWhere);
    assert.equal(requests[1].skip, 5);
    assert.equal(requests[1].take, 5);
    assert.deepEqual(requests[1].orderBy, { id: "desc" });
  }
});

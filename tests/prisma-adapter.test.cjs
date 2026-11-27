const assert = require("node:assert/strict");
const { test } = require("node:test");
const { PrismaClient } = require("@prisma/client");
const { createPostgresAdapter } = require("../dist/prisma-adapter");

test(
  "budget transactions resolve raw SQL in the configured schema",
  {
    skip: !process.env.TEST_DATABASE_URL,
  },
  async (t) => {
    const url = new URL(process.env.TEST_DATABASE_URL);
    url.searchParams.set("schema", "information_schema");
    const prisma = new PrismaClient({
      adapter: createPostgresAdapter(url.href),
    });
    t.after(() => prisma.$disconnect());

    const rows = await prisma.$transaction(
      (tx) => tx.$queryRaw`
        SELECT current_schema()::text AS schema FROM "tables" LIMIT 1
      `,
    );
    assert.deepEqual(rows, [{ schema: "information_schema" }]);
  },
);

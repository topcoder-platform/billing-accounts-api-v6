// scripts/import-legacy.ts
/* eslint-disable no-console */
import { Prisma, PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

type LegacyClient = {
  client_id: string;
  name: string;
  status?: string;          // "1" active else inactive
  salestax?: string | null; // "0.000"
  start_date?: string | null;
  end_date?: string | null;
  code_name?: string | null;
  customer_number?: string | null;
  creation_user?: string | null;
  modification_user?: string | null;
};

type LegacyProject = {
  project_id: string;
  name: string;
  active?: string | number | boolean | null; // "1", 1, true
  sales_tax?: string | null;                 // "0.000"
  po_box_number?: string | null;
  payment_terms_id?: string | null;
  description?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  creation_date?: string | null;
  creation_user?: string | null;
  modification_date?: string | null;
  modification_user?: string | null;
  client_id?: string | null;                 // links to LegacyClient.client_id
  is_manual_prize_setting?: string | number | boolean | null; // "1"
  subscription_number?: string | null;
  budget?: string | number | null;
  billable?: boolean | string | number | null;
};

type LegacyChallengeBudget = {
  challenge_id: string;
  project_id: string;        // BA id
  locked_amount?: string | null;   // "0.00"
  consumed_amount?: string | null; // "5000.00"
};

type LegacyBundle = {
  ['time_oltp:client']?: LegacyClient[];
  ['time_oltp:project']?: LegacyProject[];
  ['time_oltp:project_challenge_budget']?: LegacyChallengeBudget[];
};

const prisma = new PrismaClient();

function toBool(v: any): boolean | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  const s = String(v).trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'yes';
}
function toActiveInactive(v: any): 'ACTIVE'|'INACTIVE' {
  const b = toBool(v);
  return b ? 'ACTIVE' : 'INACTIVE';
}
function toDateOrNull(s?: string | null) {
  if (!s) return null;
  // Accept "YYYY-MM-DD HH:mm:ss"
  const d = new Date(s.replace(' ', 'T') + (s.includes('T') ? '' : 'Z'));
  return isNaN(d.getTime()) ? null : d;
}
function toDecimalOrZero(s?: string | number | null): Prisma.Decimal {
  if (s === undefined || s === null || s === '') return new Prisma.Decimal(0);
  return new Prisma.Decimal(String(s));
}
function nonEmpty(s?: string | null): string | null {
  if (!s) return null;
  const t = String(s).trim();
  return t === '' ? null : t;
}

async function ensureDefaultClient(defaultClientId: string) {
  // Creates a placeholder client if needed
  await prisma.client.upsert({
    where: { id: defaultClientId },
    create: {
      id: defaultClientId,
      name: 'Unknown Client (legacy)',
      codeName: 'legacy-unknown',
      status: 'ACTIVE',
    },
    update: {},
  });
}

async function importClients(items: LegacyClient[]) {
  console.log(`Importing ${items.length} client(s)…`);
  let created = 0, updated = 0, skipped = 0;

  for (const c of items) {
    try {
      const id = String(c.client_id);
      await prisma.client.upsert({
        where: { id },
        create: {
          id,
          name: c.name,
          codeName: nonEmpty(c.code_name) ?? nonEmpty(c.customer_number),
          status: c.status === '1' ? 'ACTIVE' : 'INACTIVE',
          startDate: toDateOrNull(c.start_date) ?? undefined,
          endDate: toDateOrNull(c.end_date) ?? undefined,
        },
        update: {
          name: c.name,
          codeName: nonEmpty(c.code_name) ?? nonEmpty(c.customer_number) ?? undefined,
          status: c.status === '1' ? 'ACTIVE' : 'INACTIVE',
          startDate: toDateOrNull(c.start_date) ?? undefined,
          endDate: toDateOrNull(c.end_date) ?? undefined,
        },
      });
      created++; // upsert may update—count simple
    } catch (e: any) {
      skipped++;
      console.error(`Client ${c.client_id} failed:`, e.message);
    }
  }
  console.log(`Clients imported. created/updated≈${created}, skipped=${skipped}`);
}

async function importProjects(items: LegacyProject[], defaultClientId: string) {
  console.log(`Importing ${items.length} billing account(s)…`);
  let ok = 0, skipped = 0;

  for (const p of items) {
    try {
      const id = Number(p.project_id);
      let clientId = p.client_id != null ? String(p.client_id) : defaultClientId;

      // Guarantee client exists (fallback created earlier)
      const client = await prisma.client.findUnique({ where: { id: clientId } });
      if (!client) {
        // If the referenced client doesn’t exist and not using default, fallback
        clientId = defaultClientId;
      }

      await prisma.billingAccount.upsert({
        where: { id },
        create: {
          id,
          name: p.name,
          description: nonEmpty(p.description),
          status: toActiveInactive(p.active),
          startDate: toDateOrNull(p.start_date) ?? undefined,
          endDate: toDateOrNull(p.end_date) ?? undefined,
          budget: toDecimalOrZero(p.budget),
          markup: new Prisma.Decimal(0), // legacy doesn’t provide; set 0
          clientId,
          poNumber: nonEmpty(p.po_box_number) ?? undefined,
          subscriptionNumber: nonEmpty(p.subscription_number) ?? undefined,
          isManualPrize: !!toBool(p.is_manual_prize_setting),
          paymentTerms: nonEmpty(p.payment_terms_id) ?? undefined,
          salesTax: p.sales_tax != null ? toDecimalOrZero(p.sales_tax) : undefined,
          billable: toBool(p.billable) ?? true,
          createdBy: nonEmpty(p.creation_user) ?? undefined,
        },
        update: {
          name: p.name,
          description: nonEmpty(p.description) ?? undefined,
          status: toActiveInactive(p.active),
          startDate: toDateOrNull(p.start_date) ?? undefined,
          endDate: toDateOrNull(p.end_date) ?? undefined,
          budget: toDecimalOrZero(p.budget),
          clientId,
          poNumber: nonEmpty(p.po_box_number) ?? undefined,
          subscriptionNumber: nonEmpty(p.subscription_number) ?? undefined,
          isManualPrize: !!toBool(p.is_manual_prize_setting),
          paymentTerms: nonEmpty(p.payment_terms_id) ?? undefined,
          salesTax: p.sales_tax != null ? toDecimalOrZero(p.sales_tax) : undefined,
          billable: toBool(p.billable) ?? true,
        },
      });
      ok++;
    } catch (e: any) {
      skipped++;
      console.error(`Project ${p.project_id} failed:`, e.message);
    }
  }
  console.log(`Billing accounts imported. ok=${ok}, skipped=${skipped}`);
}

async function importChallengeBudgets(items: LegacyChallengeBudget[]) {
  console.log(`Importing ${items.length} project_challenge_budget row(s)…`);
  let locks = 0, consumes = 0, skipped = 0;

  for (const r of items) {
    const billingAccountId = Number(r.project_id);
    const challengeId = String(r.challenge_id);
    const locked = toDecimalOrZero(r.locked_amount);
    const consumed = toDecimalOrZero(r.consumed_amount);

    try {
      // Ensure BA exists
      const ba = await prisma.billingAccount.findUnique({ where: { id: billingAccountId } });
      if (!ba) {
        skipped++;
        console.warn(`Skipping challenge ${challengeId}: BA ${billingAccountId} not found`);
        continue;
      }

      // Rule: if consumed > 0, create/update ConsumedAmount and remove lock
      if (consumed.greaterThan(0)) {
        await prisma.$transaction([
          prisma.lockedAmount.deleteMany({ where: { billingAccountId, challengeId } }),
          prisma.consumedAmount.upsert({
            where: { consumed_unique_challenge: { billingAccountId, challengeId } },
            create: { billingAccountId, challengeId, amount: consumed },
            update: { amount: consumed },
          }),
        ]);
        consumes++;
        continue;
      }

      // Else if locked > 0, upsert lock
      if (locked.greaterThan(0)) {
        await prisma.lockedAmount.upsert({
          where: { locked_unique_challenge: { billingAccountId, challengeId } },
          create: { billingAccountId, challengeId, amount: locked },
          update: { amount: locked },
        });
        locks++;
        continue;
      }

      // Neither > 0 => delete any existing records (cleanup)
      await prisma.$transaction([
        prisma.lockedAmount.deleteMany({ where: { billingAccountId, challengeId } }),
        prisma.consumedAmount.deleteMany({ where: { billingAccountId, challengeId } }),
      ]);
    } catch (e: any) {
      skipped++;
      console.error(`ChallengeBudget ${billingAccountId}/${challengeId} failed:`, e.message);
    }
  }
  console.log(`Challenge budgets imported. locks=${locks}, consumed=${consumes}, skipped=${skipped}`);
}

function readJsonFromArgs(): LegacyBundle {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error('Usage: npm run import:legacy -- <file1.json> [file2.json ...] [--defaultClientId=<id>]');
    process.exit(1);
  }
  let defaultClientId = 'legacy-unknown-client';
  const files: string[] = [];
  for (const a of args) {
    if (a.startsWith('--defaultClientId=')) defaultClientId = a.split('=')[1];
    else files.push(a);
  }
  const combined: LegacyBundle = {};
  for (const f of files) {
    const abs = path.resolve(process.cwd(), f);
    const raw = fs.readFileSync(abs, 'utf8');
    const data = JSON.parse(raw) as LegacyBundle;
    for (const k of Object.keys(data) as (keyof LegacyBundle)[]) {
      if (!combined[k]) (combined as any)[k] = [];
      (combined as any)[k] = (combined as any)[k].concat((data as any)[k] || []);
    }
  }
  (combined as any).__defaultClientId = defaultClientId;
  return combined;
}

async function main() {
  const bundle: any = readJsonFromArgs();
  const defaultClientId: string = bundle.__defaultClientId || 'legacy-unknown-client';
  delete bundle.__defaultClientId;

  const clients = (bundle['time_oltp:client'] ?? []) as LegacyClient[];
  const projects = (bundle['time_oltp:project'] ?? []) as LegacyProject[];
  const budgets  = (bundle['time_oltp:project_challenge_budget'] ?? []) as LegacyChallengeBudget[];

  console.log(`Importing ${clients.length} clients and ${projects.length} billing accounts`);
  // Ensure fallback client exists (for projects with null client_id)
  await ensureDefaultClient(defaultClientId);

  if (clients.length) await importClients(clients);
  if (projects.length) await importProjects(projects, defaultClientId);
  if (budgets.length)  await importChallengeBudgets(budgets);

  // Ensure the BillingAccount sequence is aligned to the max(id)
  try {
    await prisma.$executeRaw`SELECT setval(pg_get_serial_sequence('"BillingAccount"', 'id'), COALESCE((SELECT MAX(id) FROM "BillingAccount"), 0))`;
  } catch (e: any) {
    console.warn('Warning: could not align BillingAccount id sequence:', e?.message || e);
  }

  console.log('Import complete.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

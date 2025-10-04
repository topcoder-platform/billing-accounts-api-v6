// scripts/import-ba-access.ts
/* eslint-disable no-console */
import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

type LegacyProjectManager = {
  project_id: string; // BA id
  user_account_id: string; // foreign key to LegacyUserAccount.user_account_id
  active?: string | number | boolean | null;
};

type LegacyUserAccount = {
  user_account_id: string;
  user_name: string; // handle
};

type LegacyBundle = {
  ['time_oltp:project_manager']?: LegacyProjectManager[];
  ['time_oltp:user_account']?: LegacyUserAccount[];
};

function readJsonFromArgs(): LegacyBundle {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error('Usage: npm run import:access -- <project_manager.json> <user_account.json> [more.json ...]');
    process.exit(1);
  }
  const files: string[] = [];
  for (const a of args) files.push(a);
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
  return combined;
}

function toBool(v: any): boolean | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  const s = String(v).trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'yes';
}

async function main() {
  const MEMBER_DB_URL = process.env.MEMBER_DB_URL;
  if (!MEMBER_DB_URL) {
    console.error('MEMBER_DB_URL is required (connection string to the members database)');
    process.exit(1);
  }

  const bundle = readJsonFromArgs();
  const projectManagers = (bundle['time_oltp:project_manager'] ?? []) as LegacyProjectManager[];
  const userAccounts = (bundle['time_oltp:user_account'] ?? []) as LegacyUserAccount[];

  if (!projectManagers.length) {
    console.error('No project_manager records found in provided files.');
    process.exit(1);
  }
  if (!userAccounts.length) {
    console.error('No user_account records found in provided files.');
    process.exit(1);
  }

  console.log(`Loaded ${projectManagers.length} project_manager and ${userAccounts.length} user_account records.`);

  const prisma = new PrismaClient();
  const memberPrisma = new PrismaClient({ datasources: { db: { url: MEMBER_DB_URL } } });

  // Build lookup for user_account by id
  const userById = new Map<string, LegacyUserAccount>();
  for (const u of userAccounts) {
    if (u && u.user_account_id != null) userById.set(String(u.user_account_id), u);
  }

  let created = 0, skipped = 0;

  for (const pm of projectManagers) {
    const billingAccountId = Number(pm.project_id);
    if (!Number.isFinite(billingAccountId)) {
      skipped++;
      console.warn(`Skipping row: invalid project_id=${pm.project_id}`);
      continue;
    }

    const ua = userById.get(String(pm.user_account_id));
    if (!ua) {
      skipped++;
      console.warn(`Skipping BA ${billingAccountId}: user_account_id=${pm.user_account_id} not found in user_account file(s)`);
      continue;
    }

    const handle = (ua.user_name || '').trim();
    if (!handle) {
      skipped++;
      console.warn(`Skipping BA ${billingAccountId}: empty handle for user_account_id=${pm.user_account_id}`);
      continue;
    }

    try {
      // Ensure BA exists
      const ba = await prisma.billingAccount.findUnique({ where: { id: billingAccountId } });
      if (!ba) {
        skipped++;
        console.warn(`Skipping: BillingAccount ${billingAccountId} not found`);
        continue;
      }

      // Lookup member by handle/handleLower in members DB
      const rows = await memberPrisma.$queryRaw<Array<{ userId: bigint }>>`
        SELECT "userId" FROM "member"
        WHERE "handleLower" = lower(${handle}) OR "handle" = ${handle}
        LIMIT 1`;

      if (!rows || rows.length === 0) {
        skipped++;
        console.warn(`Skipping BA ${billingAccountId}: member not found for handle '${handle}'`);
        continue;
      }

      const memberUserId = rows[0]?.userId;
      const userIdStr = typeof memberUserId === 'bigint' ? memberUserId.toString() : String(memberUserId);

      // Optional: only import active managers if needed; by default import all
      // const isActive = toBool(pm.active) ?? true;

      await prisma.billingAccountAccess.upsert({
        where: { ba_access_unique: { billingAccountId, userId: userIdStr } },
        create: { billingAccountId, userId: userIdStr, createdAt: new Date() },
        update: {},
      });
      created++;
    } catch (e: any) {
      skipped++;
      console.warn(`Failed to import access for BA ${billingAccountId} / user_account_id=${pm.user_account_id}:`, e?.message || e);
    }
  }

  console.log(`BillingAccountAccess import complete. upserts=${created}, skipped=${skipped}`);

  await prisma.$disconnect();
  await memberPrisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

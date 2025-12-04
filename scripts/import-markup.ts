// scripts/import-markup.ts
/* eslint-disable no-console */
import { Prisma, PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

type ContestFeeRow = {
  project_contest_fee_percentage_id?: string;
  project_id?: string | number;
  contest_fee_percentage?: string | number | null;
  active?: string | number | boolean | null;
  creation_user?: string | null;
  creation_date?: string | null;
  modification_user?: string | null;
  modification_date?: string | null;
};

type ContestFeeBundle = {
  ['time_oltp:project_contest_fee_percentage']?: ContestFeeRow[];
};

const DEFAULT_JSON_PATH = '/mnt/export/time_oltp:project_contest_fee_percentage_1.json';

function toDecimalOrNull(v: ContestFeeRow['contest_fee_percentage']): Prisma.Decimal | null {
  if (v === undefined || v === null) return null;
  const str = typeof v === 'number' ? v.toString() : String(v).trim();
  if (!str) return null;
  try {
    return new Prisma.Decimal(str);
  } catch {
    return null;
  }
}

function readContestFees(filePath: string): ContestFeeRow[] {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Input file not found: ${filePath}`);
  }
  const raw = fs.readFileSync(filePath, 'utf8');
  const parsed: ContestFeeBundle | ContestFeeRow[] = JSON.parse(raw);

  if (Array.isArray(parsed)) return parsed;
  const arr = parsed?.['time_oltp:project_contest_fee_percentage'];
  if (Array.isArray(arr)) return arr;

  throw new Error('Unsupported JSON structure. Expected an array or { "time_oltp:project_contest_fee_percentage": [...] }');
}

async function main() {
  const input = process.argv[2] ?? DEFAULT_JSON_PATH;
  const inputPath = path.resolve(process.cwd(), input);
  console.log(`Loading contest fee percentages from ${inputPath}`);

  const rows = readContestFees(inputPath);
  console.log(`Parsed ${rows.length} record(s).`);

  const prisma = new PrismaClient();
  let updated = 0;
  let skipped = 0;

  for (const row of rows) {
    const billingAccountId = Number(row.project_id);
    if (!Number.isFinite(billingAccountId)) {
      skipped++;
      console.warn(`Skipping record: invalid project_id='${row.project_id}'`);
      continue;
    }

    const markup = toDecimalOrNull(row.contest_fee_percentage);
    if (markup === null) {
      skipped++;
      console.warn(`Skipping BA ${billingAccountId}: invalid contest_fee_percentage='${row.contest_fee_percentage}'`);
      continue;
    }

    try {
      await prisma.billingAccount.update({
        where: { id: billingAccountId },
        data: { markup },
      });
      updated++;
    } catch (err: any) {
      skipped++;
      if (err?.code === 'P2025') {
        console.warn(`BillingAccount ${billingAccountId} not found; markup not updated.`);
      } else {
        console.warn(`Failed to update BA ${billingAccountId}:`, err?.message || err);
      }
    }
  }

  console.log(`Contest fee import complete. updated=${updated}, skipped=${skipped}`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

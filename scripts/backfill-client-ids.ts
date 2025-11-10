/* eslint-disable no-console */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const PLACEHOLDER_CLIENT_ID = 'legacy-unknown-client';
const CHUNK_SIZE = 500;

type LegacyProjectRecord = {
  project_id?: string | number | null;
  client_id?: string | number | null;
};

type LegacyProjectBundle = {
  ['time_oltp:project']?: LegacyProjectRecord[];
};

type Stats = {
  candidates: number;
  updated: number;
  skippedAlreadyAssigned: number;
  skippedMissingClientValue: number;
  skippedMissingClientRow: number;
  missingBillingAccount: number;
};

const prisma = new PrismaClient();

function usage(): never {
  console.error('Usage: npm run backfill:clientIds -- <time_oltp:project_*.json> [moreFiles...]');
  process.exit(1);
}

function normalizeClientId(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  if (!trimmed || trimmed.toLowerCase() === 'null') return null;
  return trimmed;
}

function normalizeProjectId(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  const asNumber = Number(value);
  if (!Number.isFinite(asNumber)) return null;
  return asNumber;
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function readMappingsFromFiles(files: string[]): Map<number, string> {
  if (!files.length) usage();

  const projectToClient = new Map<number, string>();

  for (const file of files) {
    const abs = path.resolve(process.cwd(), file);
    if (!fs.existsSync(abs)) {
      throw new Error(`File not found: ${file}`);
    }
    const raw = fs.readFileSync(abs, 'utf8');
    let parsed: LegacyProjectBundle;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      throw new Error(`Invalid JSON in ${file}: ${(err as Error).message}`);
    }
    const projects = parsed['time_oltp:project'] ?? [];
    console.log(`Loaded ${projects.length} project record(s) from ${file}.`);
    for (const project of projects) {
      const projectId = normalizeProjectId(project.project_id);
      const clientId = normalizeClientId(project.client_id);
      if (projectId == null) continue;
      if (!clientId || clientId === PLACEHOLDER_CLIENT_ID) continue;
      projectToClient.set(projectId, clientId);
    }
  }
  return projectToClient;
}

async function filterExistingClients(clientIds: Set<string>): Promise<Set<string>> {
  const known = new Set<string>();
  const allIds = Array.from(clientIds);
  for (const chunk of chunkArray(allIds, CHUNK_SIZE)) {
    const rows = await prisma.client.findMany({
      where: { id: { in: chunk } },
      select: { id: true },
    });
    for (const row of rows) known.add(row.id);
  }
  return known;
}

async function main() {
  const args = process.argv.slice(2);
  if (!args.length) usage();

  const projectToClient = readMappingsFromFiles(args);

  if (projectToClient.size === 0) {
    console.log('No project rows contained a usable client_id value. Nothing to update.');
    await prisma.$disconnect();
    return;
  }

  console.log(`Prepared ${projectToClient.size} project → client mapping(s).`);

  const uniqueClientIds = new Set(projectToClient.values());
  const validClientIds = await filterExistingClients(uniqueClientIds);
  const missingClientIds = [...uniqueClientIds].filter((id) => !validClientIds.has(id));
  if (missingClientIds.length) {
    console.warn(
      `Warning: ${missingClientIds.length} client_id value(s) in the JSON do not exist in the Client table and will be skipped.`
    );
  }

  const stats: Stats = {
    candidates: 0,
    updated: 0,
    skippedAlreadyAssigned: 0,
    skippedMissingClientValue: 0,
    skippedMissingClientRow: 0,
    missingBillingAccount: 0,
  };

  const projectIds = Array.from(projectToClient.keys());

  for (const chunk of chunkArray(projectIds, CHUNK_SIZE)) {
    const foundAccounts = await prisma.billingAccount.findMany({
      where: {
        id: { in: chunk },
      },
      select: { id: true, clientId: true },
    });
    const accountById = new Map(foundAccounts.map((ba) => [ba.id, ba]));

    for (const projectId of chunk) {
      const account = accountById.get(projectId);
      const nextClientId = projectToClient.get(projectId);

      if (!nextClientId) {
        stats.skippedMissingClientValue++;
        continue;
      }
      if (!validClientIds.has(nextClientId)) {
        stats.skippedMissingClientRow++;
        continue;
      }

      if (!account) {
        stats.missingBillingAccount++;
        continue;
      }

      stats.candidates++;
      const currentClientId = (account.clientId || '').trim();
      const needsUpdate =
        !currentClientId ||
        currentClientId === PLACEHOLDER_CLIENT_ID ||
        currentClientId.toLowerCase() === 'null';

      if (!needsUpdate) {
        stats.skippedAlreadyAssigned++;
        continue;
      }

      if (currentClientId === nextClientId) {
        stats.skippedAlreadyAssigned++;
        continue;
      }

      await prisma.billingAccount.update({
        where: { id: account.id },
        data: { clientId: nextClientId },
      });
      stats.updated++;
    }
  }

  console.log('Done.');
  console.log(`Candidate BillingAccounts needing evaluation: ${stats.candidates}`);
  console.log(`Updated BillingAccounts: ${stats.updated}`);
  console.log(`Skipped (already assigned): ${stats.skippedAlreadyAssigned}`);
  console.log(`Skipped (no client_id in file): ${stats.skippedMissingClientValue}`);
  console.log(`Skipped (client missing in DB): ${stats.skippedMissingClientRow}`);
  console.log(`Missing BillingAccount rows: ${stats.missingBillingAccount}`);

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});

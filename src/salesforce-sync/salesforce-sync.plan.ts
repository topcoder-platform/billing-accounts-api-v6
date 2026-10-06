import { SalesforceRecord } from "./salesforce-sync.client";

export type LocalRecord = Record<string, unknown> & { id: string | number };
export interface SyncCounts {
  scanned: number;
  updated: number;
  unchanged: number;
  unmatched: number;
  conflicted: number;
}
export interface SyncPlan {
  counts: SyncCounts;
  updates: Array<{ id: string | number; data: Record<string, string | null> }>;
}

/**
 * Plans metadata-only updates using both platform IDs and stored Salesforce IDs.
 * Conflicting identities, duplicate platform IDs and shared Salesforce ownership are skipped.
 * @param rows Every existing local row, with its identity and metadata fields.
 * @param records Complete Salesforce snapshot (including records without platform IDs).
 * @param fields Local-to-Salesforce metadata mapping.
 * @param identity Local Salesforce identity column.
 * @param platformId Salesforce platform ID field; compared exactly after trimming.
 * @returns Updates and counts covering every local row, without changing either system.
 * @throws No exceptions for validated Salesforce records and database rows.
 */
export function planSync(
  rows: LocalRecord[],
  records: SalesforceRecord[],
  fields: Record<string, string>,
  identity: string,
  platformId: string,
): SyncPlan {
  const byPlatform = new Map<string, SalesforceRecord[]>();
  const bySalesforce = new Map<string, SalesforceRecord>();
  const owners = new Map<string, Set<string | number>>();
  for (const record of records) {
    bySalesforce.set(record.Id.slice(0, 15), record);
    const key = record[platformId]?.trim();
    if (key) byPlatform.set(key, [...(byPlatform.get(key) || []), record]);
  }
  for (const row of rows) {
    const key =
      typeof row[identity] === "string"
        ? row[identity].slice(0, 15)
        : undefined;
    if (key) {
      const existing = owners.get(key) || new Set();
      existing.add(row.id);
      owners.set(key, existing);
    }
  }
  const counts: SyncCounts = {
    scanned: rows.length,
    updated: 0,
    unchanged: 0,
    unmatched: 0,
    conflicted: 0,
  };
  const updates: SyncPlan["updates"] = [];
  for (const row of rows) {
    const candidates = byPlatform.get(String(row.id)) || [];
    const storedId = row[identity];
    const stored =
      typeof storedId === "string"
        ? bySalesforce.get(storedId.slice(0, 15))
        : undefined;
    const record = stored || candidates[0];
    if (
      candidates.length > 1 ||
      (storedId &&
        (!stored || (candidates[0] && candidates[0].Id !== stored.Id))) ||
      (stored &&
        stored[platformId]?.trim() &&
        stored[platformId]?.trim() !== String(row.id)) ||
      (record &&
        [...(owners.get(record.Id.slice(0, 15)) || [])].some(
          (id) => id !== row.id,
        ))
    ) {
      counts.conflicted++;
      continue;
    }
    if (!record) {
      counts.unmatched++;
      continue;
    }
    const data = Object.fromEntries(
      Object.entries(fields).map(([local, source]) => [local, record[source]]),
    );
    if (Object.entries(data).every(([key, value]) => row[key] === value)) {
      counts.unchanged++;
    } else {
      updates.push({ id: row.id, data });
      counts.updated++;
    }
  }
  return { counts, updates };
}

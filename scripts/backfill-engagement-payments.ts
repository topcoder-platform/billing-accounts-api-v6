/* eslint-disable no-console */
import 'dotenv/config';
import { Prisma, PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const CHUNK_SIZE = 500;
const LEDGER_DECIMAL_PLACES = 4;
const ENGAGEMENT_EXTERNAL_TYPE = 'ENGAGEMENT';
const DEFAULT_EXEMPT_BILLING_ACCOUNT_IDS = [80000062, 80002800] as const;
const APPLY_TRANSACTION_TIMEOUT_MS = 10 * 60 * 1000;

type ParsedArgs = {
  apply: boolean;
  assignmentIds: Set<string>;
  limit?: number;
  reportPath: string;
  since?: Date;
  until?: Date;
  winningIds: Set<string>;
};

type FinancePaymentRow = {
  winningId: string;
  winnerId: string;
  externalId: string | null;
  attributes: unknown;
  winningCreatedAt: Date | null;
  paymentId: string;
  totalAmount: Prisma.Decimal | string | number | null;
  billingAccount: string | null;
  challengeMarkup: Prisma.Decimal | string | number | null;
  challengeFee: Prisma.Decimal | string | number | null;
  paymentStatus: string | null;
  currency: string | null;
  installmentNumber: number | null;
  paymentCreatedAt: Date | null;
};

type AssignmentLookupRow = {
  assignmentId: string;
  engagementId: string;
  projectId: string;
  memberId: string;
  memberHandle: string;
  engagementTitle: string;
  externalEngagementId?: string;
};

type ResolvedAssignment = AssignmentLookupRow & {
  resolutionSource:
    | 'attributes.assignmentId'
    | 'external_id.assignment'
    | 'external_id.engagement_member'
    | 'external_id.engagement_single';
};

type BillingAccountMetadata = {
  id: number;
  markup: Prisma.Decimal;
};

type ConsumeAmountSource =
  | 'finance.challenge_markup_rate'
  | 'finance.challenge_fee_absolute'
  | 'billing_account_markup_fallback';

type ConsumeAmountResolution =
  | {
      adjustmentType: 'markup_rate';
      challengeFee: null;
      markupRate: Prisma.Decimal;
      source:
        | 'finance.challenge_markup_rate'
        | 'billing_account_markup_fallback';
    }
  | {
      adjustmentType: 'absolute_fee';
      challengeFee: Prisma.Decimal;
      markupRate: null;
      source: 'finance.challenge_fee_absolute';
    };

type ConsumeAmountSourceCounts = Partial<Record<ConsumeAmountSource, number>>;

type BillingLedgerClient = PrismaClient | Prisma.TransactionClient;

type PaymentConsumeContext = {
  assignment: ResolvedAssignment;
  billingAccountId: number;
  challengeFee: Prisma.Decimal | null;
  consumedAmount: Prisma.Decimal;
  consumeAmountSource: ConsumeAmountSource;
  consumeAmountType: ConsumeAmountResolution['adjustmentType'];
  markupRate: Prisma.Decimal | null;
  payment: FinancePaymentRow;
  totalAmount: Prisma.Decimal;
};

type AssignmentAggregate = {
  assignmentId: string;
  billingAccountId: number;
  consumedAmount: Prisma.Decimal;
  consumeAmountSourceCounts: ConsumeAmountSourceCounts;
  engagementId: string;
  fallbackMarkupCount: number;
  paymentCount: number;
  paymentIds: string[];
  paymentTotal: Prisma.Decimal;
  projectId: string;
  resolutionSources: string[];
  winningIds: string[];
};

type ExistingConsumedRow = {
  id: string;
  billingAccountId: number;
  externalId: string;
  amount: Prisma.Decimal;
  createdAt: Date;
  updatedAt: Date;
};

type BackfillException = {
  code: string;
  message: string;
  assignmentId?: string;
  billingAccountId?: number;
  engagementId?: string;
  externalId?: string | null;
  paymentId?: string;
  projectId?: string;
  winningId?: string;
  details?: Record<string, unknown>;
};

type AbsoluteFeeAudit = {
  assignmentId: string;
  billingAccountId: number;
  challengeFee: Prisma.Decimal;
  consumedAmount: Prisma.Decimal;
  paymentId: string;
  totalAmount: Prisma.Decimal;
  winningId: string;
};

type ExemptBillingAccountAudit = {
  assignmentId: string;
  billingAccountId: number;
  engagementId: string;
  paymentId: string;
  projectId: string;
  reason: 'topgear_billing_account_exempt';
  winningId: string;
};

type FallbackMarkupAudit = {
  assignmentId: string;
  billingAccountId: number;
  consumedAmount: Prisma.Decimal;
  markup: Prisma.Decimal;
  paymentId: string;
  totalAmount: Prisma.Decimal;
  winningId: string;
};

type PlannedAction =
  | {
      action: 'already_correct';
      aggregate: AssignmentAggregate;
      existingRows: ExistingConsumedRow[];
    }
  | {
      action: 'insert';
      aggregate: AssignmentAggregate;
      createdId?: string;
      existingRows: ExistingConsumedRow[];
    }
  | {
      action: 'update_single';
      aggregate: AssignmentAggregate;
      existingRows: ExistingConsumedRow[];
      previous: ExistingConsumedRow;
      updatedId?: string;
    }
  | {
      action: 'move_existing_rows';
      aggregate: AssignmentAggregate;
      existingRows: ExistingConsumedRow[];
      updatedIds?: string[];
    }
  | {
      action: 'manual_review';
      aggregate: AssignmentAggregate;
      existingRows: ExistingConsumedRow[];
      reason: string;
    };

type ApplyResult = {
  actions: PlannedAction[];
  actualAfter: Prisma.Decimal;
};

type ReportInput = {
  absoluteFee: AbsoluteFeeAudit[];
  actions: PlannedAction[];
  actualAfter?: Prisma.Decimal;
  actualBefore: Prisma.Decimal;
  aggregates: Map<string, AssignmentAggregate>;
  args: ParsedArgs;
  contexts: PaymentConsumeContext[];
  exceptions: BackfillException[];
  exemptBillingAccounts: ExemptBillingAccountAudit[];
  exemptBillingAccountIds: Set<number>;
  expectedTotal: Prisma.Decimal;
  fallbackMarkup: FallbackMarkupAudit[];
  payments: FinancePaymentRow[];
  projectedTotal: Prisma.Decimal;
  resolvedAssignments: Map<string, ResolvedAssignment>;
};

type Report = {
  absoluteFee: AbsoluteFeeAudit[];
  actions: PlannedAction[];
  exceptions: BackfillException[];
  exemptBillingAccounts: ExemptBillingAccountAudit[];
  fallbackMarkup: FallbackMarkupAudit[];
  generatedAt: string;
  mode: 'apply' | 'dry-run';
  summary: Record<string, number | string>;
  totals: {
    actualAfterApplyForResolvedAssignments?: string;
    actualBeforeForResolvedAssignments: string;
    expectedResolvedAssignments: string;
    projectedForResolvedAssignments: string;
  };
};

/**
 * Prints CLI usage and terminates the script.
 *
 * @returns Never returns because the process exits with a non-zero status.
 * @throws This function does not throw; it exits the Node process.
 */
function usage(): never {
  console.error(
    [
      'Usage: pnpm run backfill:engagementPayments -- [--dry-run|--apply] [options]',
      '',
      'Options:',
      '  --assignmentId=<id>[,<id>...]  Limit to one or more engagement assignments.',
      '  --winningId=<id>[,<id>...]     Limit to one or more finance winnings.',
      '  --since=<iso-date>            Include winnings created at or after this date.',
      '  --until=<iso-date>            Include winnings created before this date.',
      '  --limit=<n>                   Limit finance payment rows for rehearsal runs.',
      '  --report=<path>               Write the JSON audit report to this path.',
      '',
      'Environment:',
      '  DATABASE_URL                  billing-accounts-api-v6 database.',
      '  FINANCE_DB_URL                tc-finance-api database.',
      '  ENGAGEMENTS_DB_URL            engagements-api-v6 database.',
      '  PROJECTS_DB_URL               projects-api-v6 database.',
      '  TGBillingAccounts             Optional comma/JSON list of TopGear-exempt billing account ids.',
    ].join('\n'),
  );
  process.exit(1);
}

/**
 * Parses command-line arguments for the backfill.
 *
 * @param argv Raw arguments after the script name.
 * @returns Normalized flags, filters, and report destination.
 * @throws Error when a date, limit, or unknown option is invalid.
 */
function parseArgs(argv: string[]): ParsedArgs {
  let apply = false;
  let reportPath: string | undefined;
  let since: Date | undefined;
  let until: Date | undefined;
  let limit: number | undefined;
  const assignmentIds = new Set<string>();
  const winningIds = new Set<string>();

  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') usage();
    if (arg === '--apply') {
      apply = true;
      continue;
    }
    if (arg === '--dry-run') {
      apply = false;
      continue;
    }
    if (arg.startsWith('--report=')) {
      reportPath = arg.slice('--report='.length).trim();
      continue;
    }
    if (arg.startsWith('--assignmentId=')) {
      addCsvValues(assignmentIds, arg.slice('--assignmentId='.length));
      continue;
    }
    if (arg.startsWith('--winningId=')) {
      addCsvValues(winningIds, arg.slice('--winningId='.length));
      continue;
    }
    if (arg.startsWith('--since=')) {
      since = parseDateArg(arg.slice('--since='.length), '--since');
      continue;
    }
    if (arg.startsWith('--until=')) {
      until = parseDateArg(arg.slice('--until='.length), '--until');
      continue;
    }
    if (arg.startsWith('--limit=')) {
      limit = parseLimit(arg.slice('--limit='.length));
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return {
    apply,
    assignmentIds,
    limit,
    reportPath: reportPath || defaultReportPath(apply),
    since,
    until,
    winningIds,
  };
}

/**
 * Adds comma-separated CLI values into a set.
 *
 * @param target Set receiving normalized non-empty values.
 * @param raw Comma-separated raw value.
 * @returns Nothing.
 * @throws This function does not throw.
 */
function addCsvValues(target: Set<string>, raw: string): void {
  raw
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .forEach((value) => target.add(value));
}

/**
 * Parses a CLI date option.
 *
 * @param value Date string supplied by the caller.
 * @param flag Flag name used in validation errors.
 * @returns Parsed Date.
 * @throws Error when the date is empty or invalid.
 */
function parseDateArg(value: string, flag: string): Date {
  const parsed = new Date(value);
  if (!value.trim() || Number.isNaN(parsed.getTime())) {
    throw new Error(`${flag} must be a valid date string.`);
  }
  return parsed;
}

/**
 * Parses the optional row limit.
 *
 * @param value Numeric string supplied to --limit.
 * @returns Positive integer limit.
 * @throws Error when the limit is not a positive safe integer.
 */
function parseLimit(value: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error('--limit must be a positive integer.');
  }
  return parsed;
}

/**
 * Builds the default audit report path.
 *
 * @param apply Whether the run will mutate billing-account rows.
 * @returns Absolute path for the report JSON file.
 * @throws This function does not throw.
 */
function defaultReportPath(apply: boolean): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const mode = apply ? 'apply' : 'dry-run';
  return path.resolve(
    process.cwd(),
    'scripts',
    'output',
    `engagement-payment-backfill-${mode}-${timestamp}.json`,
  );
}

/**
 * Resolves one of several supported database URL environment variables.
 *
 * @param names Environment variable names in preference order.
 * @returns The first configured URL.
 * @throws Error when none of the names are configured.
 */
function requireDatabaseUrl(names: string[]): string {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }

  throw new Error(`Missing database URL. Set one of: ${names.join(', ')}`);
}

/**
 * Creates a Prisma client pointed at an external database.
 *
 * @param databaseUrl Postgres connection string.
 * @returns Prisma client that is only used for raw SQL reads.
 * @throws This function does not throw directly, but Prisma can throw on use.
 */
function createExternalClient(databaseUrl: string): PrismaClient {
  return new PrismaClient({
    datasources: { db: { url: databaseUrl } },
  });
}

/**
 * Splits a list into fixed-size chunks for bounded database queries.
 *
 * @param items Items to split.
 * @param size Maximum chunk size.
 * @returns Array of item chunks.
 * @throws This function does not throw.
 */
function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

/**
 * Normalizes an unknown value into a non-empty string.
 *
 * @param value Raw value.
 * @returns Trimmed string or null.
 * @throws This function does not throw.
 */
function normalizeString(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

/**
 * Converts an unknown value into a Prisma Decimal.
 *
 * @param value Raw number, string, or Decimal value.
 * @returns Decimal value, or null when the source is absent.
 * @throws Error when a present value cannot be parsed as a decimal.
 */
function toDecimalOrNull(value: unknown): Prisma.Decimal | null {
  if (value === undefined || value === null) return null;
  return new Prisma.Decimal(String(value));
}

/**
 * Compares two Decimal values at billing-ledger precision.
 *
 * @param left First decimal value.
 * @param right Second decimal value.
 * @returns True when both values match at the ledger scale.
 * @throws This function does not throw.
 */
function decimalEquals(left: Prisma.Decimal, right: Prisma.Decimal): boolean {
  return quantizeLedgerAmount(left).equals(quantizeLedgerAmount(right));
}

/**
 * Rounds an amount to the billing ledger scale.
 *
 * @param amount Decimal amount to normalize.
 * @returns Amount rounded to four decimal places with half-up rounding.
 * @throws This function does not throw for valid Decimal inputs.
 */
function quantizeLedgerAmount(amount: Prisma.Decimal): Prisma.Decimal {
  return amount.toDecimalPlaces(
    LEDGER_DECIMAL_PLACES,
    Prisma.Decimal.ROUND_HALF_UP,
  );
}

/**
 * Extracts a legacy assignment id from winnings attributes.
 *
 * @param attributes Finance winnings attributes JSON.
 * @returns Normalized assignment id, or null when it is absent.
 * @throws This function does not throw.
 */
function getAttributeAssignmentId(attributes: unknown): string | null {
  if (
    !attributes ||
    typeof attributes !== 'object' ||
    Array.isArray(attributes)
  ) {
    return null;
  }

  return normalizeString((attributes as Record<string, unknown>).assignmentId);
}

/**
 * Normalizes a trusted project billing account id.
 *
 * @param value Raw billing account id from projects-api-v6.
 * @returns Positive safe integer id, or null when the project has no billing account.
 * @throws Error when a configured value is malformed.
 */
function normalizeBillingAccountId(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim();
  if (!normalized) return null;
  if (!/^\d+$/.test(normalized)) {
    throw new Error(`Invalid billing account id: ${normalized}`);
  }

  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid billing account id: ${normalized}`);
  }

  return parsed;
}

/**
 * Parses the finance-compatible TopGear billing-account exemption list.
 *
 * @returns Billing account ids that should not receive engagement consume rows.
 * @throws Error when the configured list is not a JSON array or integer list.
 */
function loadExemptBillingAccountIds(): Set<number> {
  const raw = process.env.TGBillingAccounts?.trim();
  const values = raw
    ? parseBillingAccountIdList(raw, 'TGBillingAccounts')
    : [...DEFAULT_EXEMPT_BILLING_ACCOUNT_IDS];

  return new Set(
    values.map((value) => {
      const parsed = normalizeBillingAccountId(value);
      if (parsed === null) {
        throw new Error('TGBillingAccounts contains an empty billing account id.');
      }
      return parsed;
    }),
  );
}

/**
 * Parses a billing-account id list from JSON array or comma/space-separated text.
 *
 * @param raw Raw environment variable value.
 * @param label Environment variable name used in validation errors.
 * @returns Raw id values ready for integer normalization.
 * @throws Error when JSON syntax is invalid or the value is not a list.
 */
function parseBillingAccountIdList(raw: string, label: string): unknown[] {
  if (raw.startsWith('[')) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw new Error(
        `${label} must be a JSON array or comma-separated integer list: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    if (!Array.isArray(parsed)) {
      throw new Error(`${label} must be a JSON array or integer list.`);
    }
    return parsed;
  }

  return raw.split(/[,\s]+/).filter(Boolean);
}

/**
 * Normalizes a projects-api-v6 project id for BigInt lookups.
 *
 * @param value Engagement project id value.
 * @returns BigInt-compatible project id string, or null when malformed.
 * @throws This function does not throw.
 */
function normalizeProjectId(value: unknown): string | null {
  const normalized = normalizeString(value);
  if (!normalized || !/^\d+$/.test(normalized)) return null;
  return normalized;
}

/**
 * Reads legacy engagement payment rows from tc-finance-api.
 *
 * @param financeClient Raw-query Prisma client for the finance database.
 * @param args Parsed CLI filters.
 * @returns Finance payment rows with category ENGAGEMENT_PAYMENT.
 * @throws Error when the finance query fails.
 */
async function loadFinancePayments(
  financeClient: PrismaClient,
  args: ParsedArgs,
): Promise<FinancePaymentRow[]> {
  const whereParts: Prisma.Sql[] = [
    Prisma.sql`w.category::text = 'ENGAGEMENT_PAYMENT'`,
  ];

  if (args.since) {
    whereParts.push(Prisma.sql`w.created_at >= ${args.since}`);
  }
  if (args.until) {
    whereParts.push(Prisma.sql`w.created_at < ${args.until}`);
  }
  if (args.winningIds.size) {
    whereParts.push(
      Prisma.sql`w.winning_id::text IN (${Prisma.join([
        ...args.winningIds,
      ])})`,
    );
  }
  if (args.assignmentIds.size) {
    const assignmentIds = [...args.assignmentIds];
    whereParts.push(
      Prisma.sql`(
        w.external_id IN (${Prisma.join(assignmentIds)})
        OR w.attributes->>'assignmentId' IN (${Prisma.join(assignmentIds)})
      )`,
    );
  }

  const limitClause = args.limit
    ? Prisma.sql`LIMIT ${args.limit}`
    : Prisma.empty;

  return financeClient.$queryRaw<FinancePaymentRow[]>`
    SELECT
      w.winning_id::text AS "winningId",
      w.winner_id AS "winnerId",
      w.external_id AS "externalId",
      w.attributes AS "attributes",
      w.created_at AS "winningCreatedAt",
      p.payment_id::text AS "paymentId",
      p.total_amount AS "totalAmount",
      p.billing_account AS "billingAccount",
      p.challenge_markup AS "challengeMarkup",
      p.challenge_fee AS "challengeFee",
      p.payment_status::text AS "paymentStatus",
      p.currency AS "currency",
      p.installment_number AS "installmentNumber",
      p.created_at AS "paymentCreatedAt"
    FROM winnings w
    INNER JOIN payment p ON p.winnings_id = w.winning_id
    WHERE ${Prisma.join(whereParts, ' AND ')}
    ORDER BY w.created_at ASC, p.installment_number ASC, p.created_at ASC
    ${limitClause}
  `;
}

/**
 * Loads engagement assignment rows by assignment id.
 *
 * @param engagementsClient Raw-query Prisma client for engagements-api-v6.
 * @param assignmentIds Assignment ids to resolve.
 * @returns Map keyed by assignment id.
 * @throws Error when the engagements query fails.
 */
async function loadAssignmentsById(
  engagementsClient: PrismaClient,
  assignmentIds: string[],
): Promise<Map<string, AssignmentLookupRow>> {
  const rowsById = new Map<string, AssignmentLookupRow>();

  for (const chunk of chunkArray([...new Set(assignmentIds)], CHUNK_SIZE)) {
    if (!chunk.length) continue;

    const rows = await engagementsClient.$queryRaw<AssignmentLookupRow[]>`
      SELECT
        ea.id AS "assignmentId",
        ea."engagementId" AS "engagementId",
        ea."memberId" AS "memberId",
        ea."memberHandle" AS "memberHandle",
        e."projectId" AS "projectId",
        e.title AS "engagementTitle"
      FROM "EngagementAssignment" ea
      INNER JOIN "Engagement" e ON e.id = ea."engagementId"
      WHERE ea.id IN (${Prisma.join(chunk)})
    `;

    rows.forEach((row) => rowsById.set(row.assignmentId, row));
  }

  return rowsById;
}

/**
 * Loads assignments for finance rows whose external id stores an engagement id.
 *
 * @param engagementsClient Raw-query Prisma client for engagements-api-v6.
 * @param engagementIds Engagement ids from finance external_id values.
 * @returns Map from engagement id to its assignment rows.
 * @throws Error when the engagements query fails.
 */
async function loadAssignmentsByEngagementId(
  engagementsClient: PrismaClient,
  engagementIds: string[],
): Promise<Map<string, AssignmentLookupRow[]>> {
  const rowsByEngagementId = new Map<string, AssignmentLookupRow[]>();

  for (const chunk of chunkArray([...new Set(engagementIds)], CHUNK_SIZE)) {
    if (!chunk.length) continue;

    const rows = await engagementsClient.$queryRaw<AssignmentLookupRow[]>`
      SELECT
        ea.id AS "assignmentId",
        ea."engagementId" AS "engagementId",
        ea."memberId" AS "memberId",
        ea."memberHandle" AS "memberHandle",
        e.id AS "externalEngagementId",
        e."projectId" AS "projectId",
        e.title AS "engagementTitle"
      FROM "Engagement" e
      INNER JOIN "EngagementAssignment" ea ON ea."engagementId" = e.id
      WHERE e.id IN (${Prisma.join(chunk)})
    `;

    for (const row of rows) {
      const externalEngagementId = row.externalEngagementId || row.engagementId;
      const existing = rowsByEngagementId.get(externalEngagementId) || [];
      existing.push(row);
      rowsByEngagementId.set(externalEngagementId, existing);
    }
  }

  return rowsByEngagementId;
}

/**
 * Resolves one finance payment to an engagement assignment.
 *
 * @param payment Finance payment row.
 * @param assignmentsById Assignment lookup keyed by assignment id.
 * @param assignmentsByEngagementId Engagement fallback lookup.
 * @param exceptions Mutable exception list receiving unresolved cases.
 * @returns Resolved assignment context, or null when the row is ambiguous.
 * @throws This function does not throw.
 */
function resolvePaymentAssignment(
  payment: FinancePaymentRow,
  assignmentsById: Map<string, AssignmentLookupRow>,
  assignmentsByEngagementId: Map<string, AssignmentLookupRow[]>,
  exceptions: BackfillException[],
): ResolvedAssignment | null {
  const attributeAssignmentId = getAttributeAssignmentId(payment.attributes);
  const externalId = normalizeString(payment.externalId);

  if (attributeAssignmentId) {
    const assignment = assignmentsById.get(attributeAssignmentId);
    if (assignment) {
      return { ...assignment, resolutionSource: 'attributes.assignmentId' };
    }

    exceptions.push({
      code: 'missing_assignment',
      message:
        'Finance attributes.assignmentId does not match an engagement assignment.',
      assignmentId: attributeAssignmentId,
      externalId,
      paymentId: payment.paymentId,
      winningId: payment.winningId,
    });
    return null;
  }

  if (!externalId) {
    exceptions.push({
      code: 'missing_assignment_reference',
      message: 'Finance winning has neither external_id nor assignmentId.',
      paymentId: payment.paymentId,
      winningId: payment.winningId,
    });
    return null;
  }

  const directAssignment = assignmentsById.get(externalId);
  if (directAssignment) {
    return { ...directAssignment, resolutionSource: 'external_id.assignment' };
  }

  const engagementAssignments = assignmentsByEngagementId.get(externalId) || [];
  const memberMatches = engagementAssignments.filter(
    (assignment) => String(assignment.memberId) === String(payment.winnerId),
  );

  if (memberMatches.length === 1) {
    return {
      ...memberMatches[0],
      resolutionSource: 'external_id.engagement_member',
    };
  }

  if (memberMatches.length > 1) {
    exceptions.push({
      code: 'ambiguous_assignment',
      message:
        'Finance external_id matches an engagement with multiple assignments for the winning member.',
      externalId,
      paymentId: payment.paymentId,
      winningId: payment.winningId,
      details: {
        matchedAssignmentIds: memberMatches.map((row) => row.assignmentId),
      },
    });
    return null;
  }

  if (engagementAssignments.length === 1) {
    return {
      ...engagementAssignments[0],
      resolutionSource: 'external_id.engagement_single',
    };
  }

  exceptions.push({
    code: engagementAssignments.length
      ? 'missing_assignment_for_winner'
      : 'missing_assignment',
    message: engagementAssignments.length
      ? 'Finance external_id matches an engagement, but no assignment matches the winning member.'
      : 'Finance external_id does not match an assignment or engagement.',
    externalId,
    paymentId: payment.paymentId,
    winningId: payment.winningId,
    details: engagementAssignments.length
      ? {
          engagementAssignmentIds: engagementAssignments.map(
            (row) => row.assignmentId,
          ),
        }
      : undefined,
  });

  return null;
}

/**
 * Loads trusted billing account ids from projects-api-v6.
 *
 * @param projectsClient Raw-query Prisma client for projects-api-v6.
 * @param projectIds Project ids from engagements-api-v6.
 * @returns Map from project id string to billing account id or null.
 * @throws Error when the projects query fails.
 */
async function loadProjectBillingAccounts(
  projectsClient: PrismaClient,
  projectIds: string[],
): Promise<Map<string, number | null>> {
  const billingAccountByProjectId = new Map<string, number | null>();
  const normalizedProjectIds = [...new Set(projectIds)]
    .map((projectId) => normalizeProjectId(projectId))
    .filter((projectId): projectId is string => Boolean(projectId));

  for (const chunk of chunkArray(normalizedProjectIds, CHUNK_SIZE)) {
    if (!chunk.length) continue;

    const rows = await projectsClient.$queryRaw<
      { projectId: string; billingAccountId: string | null }[]
    >`
      SELECT
        id::text AS "projectId",
        "billingAccountId"::text AS "billingAccountId"
      FROM projects
      WHERE id IN (${Prisma.join(chunk.map((projectId) => BigInt(projectId)))})
        AND "deletedAt" IS NULL
    `;

    for (const row of rows) {
      try {
        billingAccountByProjectId.set(
          row.projectId,
          normalizeBillingAccountId(row.billingAccountId),
        );
      } catch {
        billingAccountByProjectId.set(row.projectId, null);
      }
    }
  }

  return billingAccountByProjectId;
}

/**
 * Loads billing-account metadata from billing-accounts-api-v6.
 *
 * @param billingClient Prisma client for the billing database.
 * @param billingAccountIds Billing account ids to load.
 * @returns Map keyed by billing account id.
 * @throws Error when the billing query fails.
 */
async function loadBillingAccounts(
  billingClient: PrismaClient,
  billingAccountIds: number[],
): Promise<Map<number, BillingAccountMetadata>> {
  const metadata = new Map<number, BillingAccountMetadata>();

  for (const chunk of chunkArray([...new Set(billingAccountIds)], CHUNK_SIZE)) {
    if (!chunk.length) continue;

    const rows = await billingClient.billingAccount.findMany({
      where: { id: { in: chunk } },
      select: { id: true, markup: true },
    });

    rows.forEach((row) => metadata.set(row.id, row));
  }

  return metadata;
}

/**
 * Resolves the persisted adjustment used to compute a consumed amount.
 *
 * @param payment Finance payment row.
 * @param billingAccount Billing account metadata used as markup fallback.
 * @returns Adjustment type, value, and source label.
 * @throws Error when a persisted fee or markup is invalid.
 */
function resolveConsumeAmountAdjustment(
  payment: FinancePaymentRow,
  billingAccount: BillingAccountMetadata,
): ConsumeAmountResolution {
  const challengeMarkup = toDecimalOrNull(payment.challengeMarkup);
  if (challengeMarkup !== null) {
    assertNonNegativeDecimal(challengeMarkup, 'finance challenge_markup');
    return {
      adjustmentType: 'markup_rate',
      challengeFee: null,
      markupRate: challengeMarkup,
      source: 'finance.challenge_markup_rate',
    };
  }

  const challengeFee = toDecimalOrNull(payment.challengeFee);
  if (challengeFee !== null) {
    assertNonNegativeDecimal(challengeFee, 'finance challenge_fee');
    return {
      adjustmentType: 'absolute_fee',
      challengeFee,
      markupRate: null,
      source: 'finance.challenge_fee_absolute',
    };
  }

  assertNonNegativeDecimal(billingAccount.markup, 'billing account markup');
  return {
    adjustmentType: 'markup_rate',
    challengeFee: null,
    markupRate: billingAccount.markup,
    source: 'billing_account_markup_fallback',
  };
}

/**
 * Validates that a Decimal is non-negative.
 *
 * @param value Decimal value being checked.
 * @param label Human-readable field label for errors.
 * @returns Nothing.
 * @throws Error when the value is negative.
 */
function assertNonNegativeDecimal(value: Prisma.Decimal, label: string): void {
  if (value.lessThan(0)) {
    throw new Error(`${label} must be non-negative.`);
  }
}

/**
 * Computes the consumed billing amount for one finance payment.
 *
 * @param totalAmount Legacy payment total amount.
 * @param adjustment Fee or markup-rate adjustment resolved for the payment.
 * @returns Ledger-scale consumed amount.
 * @throws This function does not throw for valid Decimal inputs.
 */
function calculateConsumedAmount(
  totalAmount: Prisma.Decimal,
  adjustment: ConsumeAmountResolution,
): Prisma.Decimal {
  if (adjustment.adjustmentType === 'absolute_fee') {
    return quantizeLedgerAmount(totalAmount.plus(adjustment.challengeFee));
  }

  return quantizeLedgerAmount(
    totalAmount.plus(totalAmount.mul(adjustment.markupRate)),
  );
}

/**
 * Builds payment consume contexts after assignment and billing account resolution.
 *
 * @param payments Finance payment rows.
 * @param resolvedAssignments Resolved assignment context by payment id.
 * @param projectBillingAccounts Trusted project billing account map.
 * @param billingAccounts Billing-account metadata map.
 * @param exemptBillingAccountIds Billing account ids skipped by finance.
 * @param exceptions Mutable exception list receiving unreconstructable rows.
 * @param fallbackMarkup Mutable audit list receiving fallback-markup usage.
 * @param absoluteFee Mutable audit list receiving absolute-fee usage.
 * @param exemptBillingAccounts Mutable audit list receiving skipped exemptions.
 * @returns Payment consume contexts safe to aggregate.
 * @throws This function does not throw; row-level issues are reported.
 */
function buildPaymentContexts(
  payments: FinancePaymentRow[],
  resolvedAssignments: Map<string, ResolvedAssignment>,
  projectBillingAccounts: Map<string, number | null>,
  billingAccounts: Map<number, BillingAccountMetadata>,
  exemptBillingAccountIds: Set<number>,
  exceptions: BackfillException[],
  fallbackMarkup: FallbackMarkupAudit[],
  absoluteFee: AbsoluteFeeAudit[],
  exemptBillingAccounts: ExemptBillingAccountAudit[],
): PaymentConsumeContext[] {
  const contexts: PaymentConsumeContext[] = [];

  for (const payment of payments) {
    const assignment = resolvedAssignments.get(payment.paymentId);
    if (!assignment) continue;

    const normalizedProjectId = normalizeProjectId(assignment.projectId);
    if (!normalizedProjectId) {
      exceptions.push({
        code: 'invalid_project_id',
        message: 'Engagement assignment projectId is not a projects-api-v6 id.',
        assignmentId: assignment.assignmentId,
        engagementId: assignment.engagementId,
        paymentId: payment.paymentId,
        projectId: assignment.projectId,
        winningId: payment.winningId,
      });
      continue;
    }

    if (!projectBillingAccounts.has(normalizedProjectId)) {
      exceptions.push({
        code: 'missing_project',
        message: 'Engagement project was not found in projects-api-v6.',
        assignmentId: assignment.assignmentId,
        engagementId: assignment.engagementId,
        paymentId: payment.paymentId,
        projectId: normalizedProjectId,
        winningId: payment.winningId,
      });
      continue;
    }

    const billingAccountId = projectBillingAccounts.get(normalizedProjectId);
    if (billingAccountId === null || billingAccountId === undefined) {
      exceptions.push({
        code: 'missing_project_billing_account',
        message: 'Trusted project billingAccountId is not configured.',
        assignmentId: assignment.assignmentId,
        engagementId: assignment.engagementId,
        paymentId: payment.paymentId,
        projectId: normalizedProjectId,
        winningId: payment.winningId,
      });
      continue;
    }

    if (exemptBillingAccountIds.has(billingAccountId)) {
      exemptBillingAccounts.push({
        assignmentId: assignment.assignmentId,
        billingAccountId,
        engagementId: assignment.engagementId,
        paymentId: payment.paymentId,
        projectId: normalizedProjectId,
        reason: 'topgear_billing_account_exempt',
        winningId: payment.winningId,
      });
      continue;
    }

    const billingAccount = billingAccounts.get(billingAccountId);
    if (!billingAccount) {
      exceptions.push({
        code: 'missing_billing_account',
        message: 'Trusted project billingAccountId does not exist in billing accounts.',
        assignmentId: assignment.assignmentId,
        billingAccountId,
        engagementId: assignment.engagementId,
        paymentId: payment.paymentId,
        projectId: normalizedProjectId,
        winningId: payment.winningId,
      });
      continue;
    }

    let totalAmount: Prisma.Decimal;
    let adjustment: ConsumeAmountResolution;
    try {
      const parsedTotal = toDecimalOrNull(payment.totalAmount);
      if (parsedTotal === null) {
        throw new Error('payment total_amount is missing.');
      }
      assertNonNegativeDecimal(parsedTotal, 'payment total_amount');
      totalAmount = parsedTotal;
      adjustment = resolveConsumeAmountAdjustment(payment, billingAccount);
    } catch (error) {
      exceptions.push({
        code: 'unreconstructable_markup_or_total',
        message: error instanceof Error ? error.message : String(error),
        assignmentId: assignment.assignmentId,
        billingAccountId,
        engagementId: assignment.engagementId,
        paymentId: payment.paymentId,
        projectId: normalizedProjectId,
        winningId: payment.winningId,
      });
      continue;
    }

    const consumedAmount = calculateConsumedAmount(totalAmount, adjustment);
    if (!consumedAmount.greaterThan(0)) {
      exceptions.push({
        code: 'non_positive_consumed_amount',
        message: 'Computed consumed amount is not positive.',
        assignmentId: assignment.assignmentId,
        billingAccountId,
        engagementId: assignment.engagementId,
        paymentId: payment.paymentId,
        projectId: normalizedProjectId,
        winningId: payment.winningId,
        details: {
          adjustmentSource: adjustment.source,
          adjustmentType: adjustment.adjustmentType,
          challengeFee: adjustment.challengeFee?.toFixed(),
          markupRate: adjustment.markupRate?.toFixed(),
          totalAmount: totalAmount.toFixed(),
        },
      });
      continue;
    }

    if (adjustment.source === 'billing_account_markup_fallback') {
      fallbackMarkup.push({
        assignmentId: assignment.assignmentId,
        billingAccountId,
        consumedAmount,
        markup: adjustment.markupRate,
        paymentId: payment.paymentId,
        totalAmount,
        winningId: payment.winningId,
      });
    }

    if (adjustment.source === 'finance.challenge_fee_absolute') {
      absoluteFee.push({
        assignmentId: assignment.assignmentId,
        billingAccountId,
        challengeFee: adjustment.challengeFee,
        consumedAmount,
        paymentId: payment.paymentId,
        totalAmount,
        winningId: payment.winningId,
      });
    }

    contexts.push({
      assignment,
      billingAccountId,
      challengeFee: adjustment.challengeFee,
      consumedAmount,
      consumeAmountSource: adjustment.source,
      consumeAmountType: adjustment.adjustmentType,
      markupRate: adjustment.markupRate,
      payment,
      totalAmount,
    });
  }

  return contexts;
}

/**
 * Aggregates payment contexts into one expected consumed value per assignment.
 *
 * @param contexts Per-payment consume contexts.
 * @returns Assignment aggregate map.
 * @throws This function does not throw.
 */
function aggregateByAssignment(
  contexts: PaymentConsumeContext[],
): Map<string, AssignmentAggregate> {
  const aggregates = new Map<string, AssignmentAggregate>();

  for (const context of contexts) {
    const existing = aggregates.get(context.assignment.assignmentId);
    if (existing) {
      existing.consumedAmount = existing.consumedAmount.plus(
        context.consumedAmount,
      );
      incrementConsumeAmountSourceCount(
        existing.consumeAmountSourceCounts,
        context.consumeAmountSource,
      );
      existing.paymentTotal = existing.paymentTotal.plus(context.totalAmount);
      existing.paymentCount++;
      existing.paymentIds.push(context.payment.paymentId);
      existing.winningIds.push(context.payment.winningId);
      if (context.consumeAmountSource === 'billing_account_markup_fallback') {
        existing.fallbackMarkupCount++;
      }
      if (
        !existing.resolutionSources.includes(
          context.assignment.resolutionSource,
        )
      ) {
        existing.resolutionSources.push(context.assignment.resolutionSource);
      }
      continue;
    }

    const consumeAmountSourceCounts: ConsumeAmountSourceCounts = {};
    incrementConsumeAmountSourceCount(
      consumeAmountSourceCounts,
      context.consumeAmountSource,
    );

    aggregates.set(context.assignment.assignmentId, {
      assignmentId: context.assignment.assignmentId,
      billingAccountId: context.billingAccountId,
      consumedAmount: context.consumedAmount,
      consumeAmountSourceCounts,
      engagementId: context.assignment.engagementId,
      fallbackMarkupCount:
        context.consumeAmountSource === 'billing_account_markup_fallback'
          ? 1
          : 0,
      paymentCount: 1,
      paymentIds: [context.payment.paymentId],
      paymentTotal: context.totalAmount,
      projectId: context.assignment.projectId,
      resolutionSources: [context.assignment.resolutionSource],
      winningIds: [context.payment.winningId],
    });
  }

  for (const aggregate of aggregates.values()) {
    aggregate.consumedAmount = quantizeLedgerAmount(aggregate.consumedAmount);
    aggregate.paymentTotal = quantizeLedgerAmount(aggregate.paymentTotal);
    aggregate.paymentIds = [...new Set(aggregate.paymentIds)];
    aggregate.winningIds = [...new Set(aggregate.winningIds)];
  }

  return aggregates;
}

/**
 * Increments an assignment-level count for one consume amount source.
 *
 * @param counts Mutable source-count object stored on an assignment aggregate.
 * @param source Adjustment source to count.
 * @returns Nothing.
 * @throws This function does not throw.
 */
function incrementConsumeAmountSourceCount(
  counts: ConsumeAmountSourceCounts,
  source: ConsumeAmountSource,
): void {
  counts[source] = (counts[source] || 0) + 1;
}

/**
 * Loads existing engagement consumed rows for assignment ids.
 *
 * @param billingClient Prisma client for the billing database.
 * @param assignmentIds Assignment ids to inspect.
 * @returns Map keyed by assignment id.
 * @throws Error when the billing query fails.
 */
async function loadExistingConsumedRows(
  billingClient: BillingLedgerClient,
  assignmentIds: string[],
): Promise<Map<string, ExistingConsumedRow[]>> {
  const rowsByAssignmentId = new Map<string, ExistingConsumedRow[]>();

  for (const chunk of chunkArray([...new Set(assignmentIds)], CHUNK_SIZE)) {
    if (!chunk.length) continue;

    const rows = await billingClient.consumedAmount.findMany({
      where: {
        externalType: ENGAGEMENT_EXTERNAL_TYPE,
        externalId: { in: chunk },
      },
      select: {
        id: true,
        billingAccountId: true,
        externalId: true,
        amount: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: [{ externalId: 'asc' }, { createdAt: 'asc' }],
    });

    for (const row of rows) {
      const existing = rowsByAssignmentId.get(row.externalId) || [];
      existing.push(row);
      rowsByAssignmentId.set(row.externalId, existing);
    }
  }

  return rowsByAssignmentId;
}

/**
 * Sums consumed row amounts.
 *
 * @param rows Existing consumed rows.
 * @returns Decimal sum.
 * @throws This function does not throw.
 */
function sumExistingRows(rows: ExistingConsumedRow[]): Prisma.Decimal {
  return rows.reduce(
    (sum, row) => sum.plus(row.amount),
    new Prisma.Decimal(0),
  );
}

/**
 * Builds a reconciliation plan for each assignment aggregate.
 *
 * @param aggregates Expected assignment aggregates.
 * @param existingRows Existing billing consumed rows by assignment id.
 * @param exceptions Mutable exception list receiving ambiguous duplicate cases.
 * @returns Planned actions to apply or report.
 * @throws This function does not throw.
 */
function planActions(
  aggregates: Map<string, AssignmentAggregate>,
  existingRows: Map<string, ExistingConsumedRow[]>,
  exceptions: BackfillException[],
): PlannedAction[] {
  const actions: PlannedAction[] = [];

  for (const aggregate of aggregates.values()) {
    const rows = existingRows.get(aggregate.assignmentId) || [];

    if (!rows.length) {
      actions.push({ action: 'insert', aggregate, existingRows: [] });
      continue;
    }

    if (rows.length === 1) {
      const row = rows[0];
      const isCorrect =
        row.billingAccountId === aggregate.billingAccountId &&
        decimalEquals(row.amount, aggregate.consumedAmount);

      actions.push(
        isCorrect
          ? { action: 'already_correct', aggregate, existingRows: rows }
          : {
              action: 'update_single',
              aggregate,
              existingRows: rows,
              previous: row,
            },
      );
      continue;
    }

    const total = sumExistingRows(rows);
    const allRowsUseTrustedBillingAccount = rows.every(
      (row) => row.billingAccountId === aggregate.billingAccountId,
    );

    if (decimalEquals(total, aggregate.consumedAmount)) {
      actions.push(
        allRowsUseTrustedBillingAccount
          ? { action: 'already_correct', aggregate, existingRows: rows }
          : { action: 'move_existing_rows', aggregate, existingRows: rows },
      );
      continue;
    }

    exceptions.push({
      code: 'ambiguous_existing_consumed_rows',
      message:
        'Multiple existing consumed rows have the assignment externalId, ' +
        'but their total does not match the expected legacy amount.',
      assignmentId: aggregate.assignmentId,
      billingAccountId: aggregate.billingAccountId,
      engagementId: aggregate.engagementId,
      projectId: aggregate.projectId,
      details: {
        expectedAmount: aggregate.consumedAmount.toFixed(),
        existingAmount: total.toFixed(),
        existingRows: rows.map((row) => ({
          amount: row.amount.toFixed(),
          billingAccountId: row.billingAccountId,
          id: row.id,
        })),
      },
    });
    actions.push({
      action: 'manual_review',
      aggregate,
      existingRows: rows,
      reason: 'duplicate rows with mismatched total',
    });
  }

  return actions;
}

/**
 * Applies planned insert and update actions to billing consumed rows.
 *
 * @param billingClient Prisma client for the billing database.
 * @param actions Planned reconciliation actions.
 * @returns The same action objects annotated with created or updated ids.
 * @throws Error when a billing write fails.
 */
async function applyActions(
  billingClient: BillingLedgerClient,
  actions: PlannedAction[],
): Promise<PlannedAction[]> {
  for (const action of actions) {
    if (action.action === 'insert') {
      const created = await billingClient.consumedAmount.create({
        data: {
          amount: action.aggregate.consumedAmount,
          billingAccountId: action.aggregate.billingAccountId,
          externalId: action.aggregate.assignmentId,
          externalType: ENGAGEMENT_EXTERNAL_TYPE,
        },
        select: { id: true },
      });
      action.createdId = created.id;
      continue;
    }

    if (action.action === 'update_single') {
      const updated = await billingClient.consumedAmount.update({
        where: { id: action.previous.id },
        data: {
          amount: action.aggregate.consumedAmount,
          billingAccountId: action.aggregate.billingAccountId,
        },
        select: { id: true },
      });
      action.updatedId = updated.id;
      continue;
    }

    if (action.action === 'move_existing_rows') {
      action.updatedIds = [];
      for (const row of action.existingRows) {
        const updated = await billingClient.consumedAmount.update({
          where: { id: row.id },
          data: { billingAccountId: action.aggregate.billingAccountId },
          select: { id: true },
        });
        action.updatedIds.push(updated.id);
      }
    }
  }

  return actions;
}

/**
 * Applies planned actions, verifies post-apply totals, and writes the report in
 * one billing database transaction.
 *
 * @param billingClient Prisma client for the billing database.
 * @param actions Planned reconciliation actions.
 * @param assignmentIds Resolved assignment ids represented by the plan.
 * @param reportPath Destination path for the apply audit report.
 * @param buildReport Builds the final report once action ids and totals exist.
 * @returns Applied actions with their post-apply billing total.
 * @throws Error when any billing write, post-apply read, or report write fails.
 */
async function applyActionsAtomically(
  billingClient: PrismaClient,
  actions: PlannedAction[],
  assignmentIds: string[],
  reportPath: string,
  buildReport: (actions: PlannedAction[], actualAfter: Prisma.Decimal) => Report,
): Promise<ApplyResult> {
  return billingClient.$transaction(
    async (transactionClient) => {
      const appliedActions = await applyActions(transactionClient, actions);
      const actualAfter = await sumExistingConsumedAmount(
        transactionClient,
        assignmentIds,
      );

      writeReport(reportPath, buildReport(appliedActions, actualAfter));

      return { actions: appliedActions, actualAfter };
    },
    { timeout: APPLY_TRANSACTION_TIMEOUT_MS },
  );
}

/**
 * Calculates the total amount represented by assignment aggregates.
 *
 * @param aggregates Assignment aggregates.
 * @returns Decimal sum of expected consumed amounts.
 * @throws This function does not throw.
 */
function sumAggregates(
  aggregates: Iterable<AssignmentAggregate>,
): Prisma.Decimal {
  return [...aggregates].reduce(
    (sum, aggregate) => sum.plus(aggregate.consumedAmount),
    new Prisma.Decimal(0),
  );
}

/**
 * Calculates the current billing total for resolved assignment ids.
 *
 * @param billingClient Prisma client for the billing database.
 * @param assignmentIds Assignment ids to total.
 * @returns Decimal sum of matching consumed rows.
 * @throws Error when the billing query fails.
 */
async function sumExistingConsumedAmount(
  billingClient: BillingLedgerClient,
  assignmentIds: string[],
): Promise<Prisma.Decimal> {
  let total = new Prisma.Decimal(0);

  for (const chunk of chunkArray([...new Set(assignmentIds)], CHUNK_SIZE)) {
    if (!chunk.length) continue;

    const aggregate = await billingClient.consumedAmount.aggregate({
      where: {
        externalType: ENGAGEMENT_EXTERNAL_TYPE,
        externalId: { in: chunk },
      },
      _sum: { amount: true },
    });

    total = total.plus(aggregate._sum.amount || 0);
  }

  return quantizeLedgerAmount(total);
}

/**
 * Calculates the projected post-run total for the resolved assignment set.
 *
 * @param actions Planned actions to evaluate.
 * @returns Projected total after applying automated actions. Manual-review
 * assignments keep their current existing total.
 * @throws This function does not throw.
 */
function calculateProjectedTotal(actions: PlannedAction[]): Prisma.Decimal {
  return quantizeLedgerAmount(
    actions.reduce((sum, action) => {
      if (action.action === 'manual_review') {
        return sum.plus(sumExistingRows(action.existingRows));
      }

      return sum.plus(action.aggregate.consumedAmount);
    }, new Prisma.Decimal(0)),
  );
}

/**
 * Builds the JSON audit report and summary counters for a dry-run or apply run.
 *
 * @param input Source rows, planned actions, totals, and audit lists.
 * @returns Complete report payload ready to serialize.
 * @throws This function does not throw.
 */
function buildReport(input: ReportInput): Report {
  const summary = {
    absoluteFeeRows: input.absoluteFee.length,
    alreadyCorrect: input.actions.filter(
      (action) => action.action === 'already_correct',
    ).length,
    assignmentAggregates: input.aggregates.size,
    consumablePaymentRows: input.contexts.length,
    exceptions: input.exceptions.length,
    exemptBillingAccountRows: input.exemptBillingAccounts.length,
    exemptBillingAccountsConfigured: [...input.exemptBillingAccountIds]
      .sort((left, right) => left - right)
      .join(','),
    fallbackMarkupRows: input.fallbackMarkup.length,
    financePaymentRows: input.payments.length,
    manualReview: input.actions.filter(
      (action) => action.action === 'manual_review',
    ).length,
    plannedInserts: input.actions.filter((action) => action.action === 'insert')
      .length,
    plannedRowMoves: input.actions.filter(
      (action) => action.action === 'move_existing_rows',
    ).length,
    plannedSingleUpdates: input.actions.filter(
      (action) => action.action === 'update_single',
    ).length,
    reportPath: path.resolve(input.args.reportPath),
    resolvedPaymentRows: input.resolvedAssignments.size,
  };

  return {
    absoluteFee: input.absoluteFee,
    actions: input.actions,
    exceptions: input.exceptions,
    exemptBillingAccounts: input.exemptBillingAccounts,
    fallbackMarkup: input.fallbackMarkup,
    generatedAt: new Date().toISOString(),
    mode: input.args.apply ? 'apply' : 'dry-run',
    summary,
    totals: {
      actualAfterApplyForResolvedAssignments: input.actualAfter?.toFixed(),
      actualBeforeForResolvedAssignments: input.actualBefore.toFixed(),
      expectedResolvedAssignments: input.expectedTotal.toFixed(),
      projectedForResolvedAssignments: input.projectedTotal.toFixed(),
    },
  };
}

/**
 * Writes the JSON audit report to disk.
 *
 * @param reportPath Destination path.
 * @param report Report payload.
 * @returns Nothing.
 * @throws Error when the directory cannot be created or the file cannot be written.
 */
function writeReport(reportPath: string, report: Report): void {
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(
    reportPath,
    JSON.stringify(report, jsonReplacer, 2) + '\n',
    'utf8',
  );
}

/**
 * Converts Decimal and BigInt values into JSON-safe representations.
 *
 * @param _key JSON object key.
 * @param value JSON value.
 * @returns JSON-safe value.
 * @throws This function does not throw.
 */
function jsonReplacer(_key: string, value: unknown): unknown {
  if (value instanceof Prisma.Decimal) return value.toFixed();
  if (typeof value === 'bigint') return value.toString();
  return value;
}

/**
 * Resolves all finance payment rows to assignment contexts.
 *
 * @param payments Finance payment rows.
 * @param engagementsClient Raw-query Prisma client for engagements-api-v6.
 * @param exceptions Mutable exception list receiving unresolved rows.
 * @returns Map from payment id to resolved assignment context.
 * @throws Error when engagement lookup queries fail.
 */
async function resolveAssignments(
  payments: FinancePaymentRow[],
  engagementsClient: PrismaClient,
  exceptions: BackfillException[],
): Promise<Map<string, ResolvedAssignment>> {
  const candidateAssignmentIds = new Set<string>();
  const candidateEngagementIds = new Set<string>();

  for (const payment of payments) {
    const attributeAssignmentId = getAttributeAssignmentId(payment.attributes);
    const externalId = normalizeString(payment.externalId);
    if (attributeAssignmentId) candidateAssignmentIds.add(attributeAssignmentId);
    if (externalId) {
      candidateAssignmentIds.add(externalId);
      candidateEngagementIds.add(externalId);
    }
  }

  const [assignmentsById, assignmentsByEngagementId] = await Promise.all([
    loadAssignmentsById(engagementsClient, [...candidateAssignmentIds]),
    loadAssignmentsByEngagementId(engagementsClient, [
      ...candidateEngagementIds,
    ]),
  ]);

  const resolvedAssignments = new Map<string, ResolvedAssignment>();
  for (const payment of payments) {
    const resolved = resolvePaymentAssignment(
      payment,
      assignmentsById,
      assignmentsByEngagementId,
      exceptions,
    );
    if (resolved) {
      resolvedAssignments.set(payment.paymentId, resolved);
    }
  }

  return resolvedAssignments;
}

/**
 * Orchestrates the engagement payment historical backfill.
 *
 * @returns Promise resolved when the report is written and all requested writes complete.
 * @throws Error when required configuration is missing or a database operation fails.
 */
async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const financeDbUrl = requireDatabaseUrl([
    'FINANCE_DB_URL',
    'TC_FINANCE_DB_URL',
  ]);
  const engagementsDbUrl = requireDatabaseUrl([
    'ENGAGEMENTS_DB_URL',
    'ENGAGEMENT_DB_URL',
  ]);
  const projectsDbUrl = requireDatabaseUrl([
    'PROJECTS_DB_URL',
    'PROJECT_DB_URL',
  ]);

  const billingClient = new PrismaClient();
  const financeClient = createExternalClient(financeDbUrl);
  const engagementsClient = createExternalClient(engagementsDbUrl);
  const projectsClient = createExternalClient(projectsDbUrl);
  const exceptions: BackfillException[] = [];
  const fallbackMarkup: FallbackMarkupAudit[] = [];
  const absoluteFee: AbsoluteFeeAudit[] = [];
  const exemptBillingAccounts: ExemptBillingAccountAudit[] = [];

  try {
    console.log(
      `Running engagement payment backfill in ${args.apply ? 'apply' : 'dry-run'} mode.`,
    );
    const exemptBillingAccountIds = loadExemptBillingAccountIds();
    console.log(
      `Loaded ${exemptBillingAccountIds.size} TopGear-exempt billing account id(s).`,
    );

    const payments = await loadFinancePayments(financeClient, args);
    console.log(`Loaded ${payments.length} finance engagement payment row(s).`);

    const resolvedAssignments = await resolveAssignments(
      payments,
      engagementsClient,
      exceptions,
    );
    console.log(
      `Resolved ${resolvedAssignments.size} payment row(s) to engagement assignments.`,
    );

    const projectIds = [...resolvedAssignments.values()].map(
      (assignment) => assignment.projectId,
    );
    const projectBillingAccounts = await loadProjectBillingAccounts(
      projectsClient,
      projectIds,
    );
    const billingAccountIds = [...new Set([...projectBillingAccounts.values()])]
      .filter((value): value is number => typeof value === 'number')
      .filter((value) => !exemptBillingAccountIds.has(value))
      .sort((left, right) => left - right);
    const billingAccounts = await loadBillingAccounts(
      billingClient,
      billingAccountIds,
    );

    const contexts = buildPaymentContexts(
      payments,
      resolvedAssignments,
      projectBillingAccounts,
      billingAccounts,
      exemptBillingAccountIds,
      exceptions,
      fallbackMarkup,
      absoluteFee,
      exemptBillingAccounts,
    );
    const aggregates = aggregateByAssignment(contexts);
    const assignmentIds = [...aggregates.keys()];
    const existingRows = await loadExistingConsumedRows(
      billingClient,
      assignmentIds,
    );
    let actions = planActions(aggregates, existingRows, exceptions);

    const expectedTotal = sumAggregates(aggregates.values());
    const actualBefore = await sumExistingConsumedAmount(
      billingClient,
      assignmentIds,
    );
    const projectedTotal = calculateProjectedTotal(actions);

    const createReport = (
      reportActions: PlannedAction[],
      actualAfter?: Prisma.Decimal,
    ): Report =>
      buildReport({
        absoluteFee,
        actions: reportActions,
        actualAfter,
        actualBefore,
        aggregates,
        args,
        contexts,
        exceptions,
        exemptBillingAccounts,
        exemptBillingAccountIds,
        expectedTotal,
        fallbackMarkup,
        payments,
        projectedTotal,
        resolvedAssignments,
      });

    let actualAfter: Prisma.Decimal | undefined;
    if (args.apply) {
      const applyResult = await applyActionsAtomically(
        billingClient,
        actions,
        assignmentIds,
        args.reportPath,
        createReport,
      );
      actions = applyResult.actions;
      actualAfter = applyResult.actualAfter;
    } else {
      writeReport(args.reportPath, createReport(actions));
    }

    const report = createReport(actions, actualAfter);

    console.log('Backfill analysis complete.');
    console.log(JSON.stringify(report.summary, null, 2));
    const afterApplyMessage = actualAfter !== undefined
      ? ` | after apply: ${actualAfter.toFixed()}`
      : '';
    console.log(
      `Expected resolved consumed total: ${expectedTotal.toFixed()} | ` +
        `current billing total: ${actualBefore.toFixed()}${afterApplyMessage}`,
    );
    console.log(`Audit report written to ${path.resolve(args.reportPath)}`);

    if (!args.apply) {
      console.log('Dry run only. Re-run with --apply to write billing rows.');
    }
  } finally {
    await Promise.all([
      billingClient.$disconnect(),
      financeClient.$disconnect(),
      engagementsClient.$disconnect(),
      projectsClient.$disconnect(),
    ]);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

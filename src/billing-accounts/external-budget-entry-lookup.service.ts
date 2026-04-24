import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { Prisma, PrismaClient } from "@prisma/client";
import type { BudgetEntryReference } from "./budget-entry.util";
import {
  getBudgetEntryReferenceKey,
  type BudgetEntryExternalTypeValue,
} from "./budget-entry.util";

interface ChallengeNameRow {
  id: string;
  legacyId: number | null;
  name: string | null;
}

interface ChallengeProjectRow {
  id: string;
  legacyId: number | null;
  projectId: number | bigint | string | null;
}

interface EngagementNameRow {
  id: string;
  title: string | null;
}

interface EngagementProjectRow {
  id: string;
  projectId: string | null;
}

interface ProjectAccessRow {
  projectId: string;
}

/**
 * Resolves budget-entry external metadata from service-owned persistence stores.
 *
 * The service uses raw batched lookups so billing-account detail responses do
 * not make one network/database call per line item. It resolves display names
 * for response rows and project access for role-filtered line-item visibility.
 * Missing DB URLs or missing referenced rows produce empty lookup mappings
 * rather than failing the billing account response.
 */
@Injectable()
export class ExternalBudgetEntryLookupService implements OnModuleDestroy {
  private readonly logger = new Logger(ExternalBudgetEntryLookupService.name);
  private challengeClient?: PrismaClient;
  private engagementsClient?: PrismaClient;
  private projectsClient?: PrismaClient;
  private challengeClientInitialized = false;
  private engagementsClientInitialized = false;
  private projectsClientInitialized = false;

  /**
   * Resolve external display names for mixed budget-entry references.
   *
   * @param references Typed budget-entry references from locked/consumed rows.
   * @returns Map keyed by `externalType:externalId` with resolved display names.
   */
  async getExternalNames(
    references: BudgetEntryReference[],
  ): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    const referencesByType = new Map<
      BudgetEntryExternalTypeValue,
      Set<string>
    >();

    for (const reference of references) {
      const externalIds =
        referencesByType.get(reference.externalType) ?? new Set<string>();
      externalIds.add(reference.externalId);
      referencesByType.set(reference.externalType, externalIds);
    }

    const [challengeNames, engagementNames] = await Promise.all([
      this.getChallengeNamesByIds([
        ...(referencesByType.get("CHALLENGE") ?? []),
      ]),
      this.getEngagementNamesByAssignmentIds([
        ...(referencesByType.get("ENGAGEMENT") ?? []),
      ]),
    ]);

    for (const [externalId, name] of challengeNames.entries()) {
      result.set(
        getBudgetEntryReferenceKey({
          externalType: "CHALLENGE",
          externalId,
        }),
        name,
      );
    }

    for (const [externalId, name] of engagementNames.entries()) {
      result.set(
        getBudgetEntryReferenceKey({
          externalType: "ENGAGEMENT",
          externalId,
        }),
        name,
      );
    }

    return result;
  }

  /**
   * Resolve which budget-entry references belong to projects accessible by a user.
   *
   * Challenge rows are mapped through challenge-api persistence and engagement
   * rows are mapped through engagement assignments. The resulting project ids
   * are checked against active `project_members` rows from projects-api-v6.
   * References whose project or membership cannot be resolved are excluded so
   * callers only see line items with proven project access.
   *
   * @param references Typed budget-entry references from locked/consumed rows.
   * @param userId Topcoder user id from the authenticated caller.
   * @returns Set of reference keys visible to the user.
   */
  async getProjectAccessibleReferenceKeys(
    references: BudgetEntryReference[],
    userId: string,
  ): Promise<Set<string>> {
    const accessibleReferenceKeys = new Set<string>();
    const normalizedUserId = this.normalizeNumericTextId(userId);

    if (!normalizedUserId || references.length === 0) {
      return accessibleReferenceKeys;
    }

    const referencesByType = new Map<
      BudgetEntryExternalTypeValue,
      Set<string>
    >();

    for (const reference of references) {
      const externalIds =
        referencesByType.get(reference.externalType) ?? new Set<string>();
      externalIds.add(reference.externalId);
      referencesByType.set(reference.externalType, externalIds);
    }

    const [challengeProjectIds, engagementProjectIds] = await Promise.all([
      this.getChallengeProjectIdsByIds([
        ...(referencesByType.get("CHALLENGE") ?? []),
      ]),
      this.getEngagementProjectIdsByAssignmentIds([
        ...(referencesByType.get("ENGAGEMENT") ?? []),
      ]),
    ]);

    const projectIdByReferenceKey = new Map<string, string>();

    for (const [externalId, projectId] of challengeProjectIds.entries()) {
      projectIdByReferenceKey.set(
        getBudgetEntryReferenceKey({
          externalType: "CHALLENGE",
          externalId,
        }),
        projectId,
      );
    }

    for (const [externalId, projectId] of engagementProjectIds.entries()) {
      projectIdByReferenceKey.set(
        getBudgetEntryReferenceKey({
          externalType: "ENGAGEMENT",
          externalId,
        }),
        projectId,
      );
    }

    const accessibleProjectIds = await this.getAccessibleProjectIdsForUser(
      normalizedUserId,
      [...projectIdByReferenceKey.values()],
    );

    for (const [referenceKey, projectId] of projectIdByReferenceKey.entries()) {
      if (accessibleProjectIds.has(projectId)) {
        accessibleReferenceKeys.add(referenceKey);
      }
    }

    return accessibleReferenceKeys;
  }

  /**
   * Disconnects optional lookup clients created for external stores.
   *
   * @returns Promise that resolves after all initialized clients disconnect.
   */
  async onModuleDestroy(): Promise<void> {
    await Promise.all([
      this.challengeClient?.$disconnect(),
      this.engagementsClient?.$disconnect(),
      this.projectsClient?.$disconnect(),
    ]);
  }

  /**
   * Resolve challenge names by current challenge ids and numeric legacy ids.
   *
   * @param externalIds Challenge ids stored on budget entries.
   * @returns Map of each matched challenge id or legacy id to challenge name.
   */
  private async getChallengeNamesByIds(
    externalIds: string[],
  ): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    const uniqueExternalIds = [...new Set(externalIds.filter(Boolean))];

    if (uniqueExternalIds.length === 0) {
      return result;
    }

    const client = this.getChallengeClient();

    if (!client) {
      return result;
    }

    try {
      const idRows = await client.$queryRaw<ChallengeNameRow[]>(
        Prisma.sql`SELECT "id", "legacyId", "name" FROM "Challenge" WHERE "id" IN (${Prisma.join(uniqueExternalIds)})`,
      );

      for (const row of idRows) {
        if (row.name) {
          result.set(row.id, row.name);
        }
      }

      const legacyIds = this.getNumericLegacyIds(uniqueExternalIds);
      if (legacyIds.length > 0) {
        const legacyRows = await client.$queryRaw<ChallengeNameRow[]>(
          Prisma.sql`SELECT "id", "legacyId", "name" FROM "Challenge" WHERE "legacyId" IN (${Prisma.join(legacyIds)})`,
        );

        for (const row of legacyRows) {
          if (row.name && row.legacyId !== null) {
            result.set(String(row.legacyId), row.name);
          }
        }
      }
    } catch (error) {
      this.logger.warn(
        `Failed to resolve challenge names for billing-account entries: ${this.getErrorMessage(error)}`,
      );
    }

    return result;
  }

  /**
   * Resolve project ids for challenge budget-entry ids.
   *
   * @param externalIds Challenge ids or numeric legacy ids stored on budget entries.
   * @returns Map of matched challenge external id to project id.
   */
  private async getChallengeProjectIdsByIds(
    externalIds: string[],
  ): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    const uniqueExternalIds = [...new Set(externalIds.filter(Boolean))];

    if (uniqueExternalIds.length === 0) {
      return result;
    }

    const client = this.getChallengeClient();

    if (!client) {
      return result;
    }

    try {
      const idRows = await client.$queryRaw<ChallengeProjectRow[]>(
        Prisma.sql`
          SELECT "id", "legacyId", "projectId"
          FROM "Challenge"
          WHERE "id" IN (${Prisma.join(uniqueExternalIds)})
        `,
      );

      for (const row of idRows) {
        this.addChallengeProjectId(result, row);
      }

      const legacyIds = this.getNumericLegacyIds(uniqueExternalIds);
      if (legacyIds.length > 0) {
        const legacyRows = await client.$queryRaw<ChallengeProjectRow[]>(
          Prisma.sql`
            SELECT "id", "legacyId", "projectId"
            FROM "Challenge"
            WHERE "legacyId" IN (${Prisma.join(legacyIds)})
          `,
        );

        for (const row of legacyRows) {
          this.addChallengeProjectId(result, row);
        }
      }
    } catch (error) {
      this.logger.warn(
        `Failed to resolve challenge projects for billing-account entries: ${this.getErrorMessage(error)}`,
      );
    }

    return result;
  }

  /**
   * Resolve engagement titles by assignment ids.
   *
   * @param assignmentIds Engagement assignment ids stored on budget entries.
   * @returns Map of assignment id to engagement title.
   */
  private async getEngagementNamesByAssignmentIds(
    assignmentIds: string[],
  ): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    const uniqueAssignmentIds = [...new Set(assignmentIds.filter(Boolean))];

    if (uniqueAssignmentIds.length === 0) {
      return result;
    }

    const client = this.getEngagementsClient();

    if (!client) {
      return result;
    }

    try {
      const rows = await client.$queryRaw<EngagementNameRow[]>(
        Prisma.sql`
          SELECT assignment."id", engagement."title"
          FROM "EngagementAssignment" assignment
          INNER JOIN "Engagement" engagement
            ON engagement."id" = assignment."engagementId"
          WHERE assignment."id" IN (${Prisma.join(uniqueAssignmentIds)})
        `,
      );

      for (const row of rows) {
        if (row.title) {
          result.set(row.id, row.title);
        }
      }
    } catch (error) {
      this.logger.warn(
        `Failed to resolve engagement names for billing-account entries: ${this.getErrorMessage(error)}`,
      );
    }

    return result;
  }

  /**
   * Resolve project ids for engagement assignment budget-entry ids.
   *
   * @param assignmentIds Engagement assignment ids stored on budget entries.
   * @returns Map of assignment id to project id.
   */
  private async getEngagementProjectIdsByAssignmentIds(
    assignmentIds: string[],
  ): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    const uniqueAssignmentIds = [...new Set(assignmentIds.filter(Boolean))];

    if (uniqueAssignmentIds.length === 0) {
      return result;
    }

    const client = this.getEngagementsClient();

    if (!client) {
      return result;
    }

    try {
      const rows = await client.$queryRaw<EngagementProjectRow[]>(
        Prisma.sql`
          SELECT assignment."id", engagement."projectId"
          FROM "EngagementAssignment" assignment
          INNER JOIN "Engagement" engagement
            ON engagement."id" = assignment."engagementId"
          WHERE assignment."id" IN (${Prisma.join(uniqueAssignmentIds)})
        `,
      );

      for (const row of rows) {
        const projectId = this.normalizeNumericTextId(row.projectId);

        if (projectId) {
          result.set(row.id, projectId);
        }
      }
    } catch (error) {
      this.logger.warn(
        `Failed to resolve engagement projects for billing-account entries: ${this.getErrorMessage(error)}`,
      );
    }

    return result;
  }

  /**
   * Loads active project ids that a user belongs to.
   *
   * @param userId Normalized numeric Topcoder user id.
   * @param projectIds Candidate project ids from line-item references.
   * @returns Set of candidate project ids with an active project member row.
   */
  private async getAccessibleProjectIdsForUser(
    userId: string,
    projectIds: string[],
  ): Promise<Set<string>> {
    const result = new Set<string>();
    const uniqueProjectIds = [
      ...new Set(
        projectIds
          .map((projectId) => this.normalizeNumericTextId(projectId))
          .filter((projectId): projectId is string => Boolean(projectId)),
      ),
    ];

    if (uniqueProjectIds.length === 0) {
      return result;
    }

    const client = this.getProjectsClient();

    if (!client) {
      return result;
    }

    try {
      const rows = await client.$queryRaw<ProjectAccessRow[]>(
        Prisma.sql`
          SELECT DISTINCT "projectId"::text AS "projectId"
          FROM project_members
          WHERE "userId" = ${BigInt(userId)}
            AND "projectId" IN (${Prisma.join(
              uniqueProjectIds.map((projectId) => BigInt(projectId)),
            )})
            AND "deletedAt" IS NULL
        `,
      );

      for (const row of rows) {
        const projectId = this.normalizeNumericTextId(row.projectId);

        if (projectId) {
          result.add(projectId);
        }
      }
    } catch (error) {
      this.logger.warn(
        `Failed to resolve project access for billing-account entries: ${this.getErrorMessage(error)}`,
      );
    }

    return result;
  }

  /**
   * Adds current and legacy challenge ids to a challenge-project lookup map.
   *
   * @param result Mutable lookup map being populated.
   * @param row Challenge row with current id, legacy id, and project id.
   */
  private addChallengeProjectId(
    result: Map<string, string>,
    row: ChallengeProjectRow,
  ): void {
    const projectId = this.normalizeNumericTextId(row.projectId);

    if (!projectId) {
      return;
    }

    result.set(row.id, projectId);

    if (row.legacyId !== null) {
      result.set(String(row.legacyId), projectId);
    }
  }

  /**
   * Converts string ids that can represent challenge legacy ids into numbers.
   *
   * @param externalIds Budget-entry external ids.
   * @returns Safe integer legacy ids.
   */
  private getNumericLegacyIds(externalIds: string[]): number[] {
    return externalIds
      .map((externalId) => Number(externalId))
      .filter(
        (externalId) => Number.isSafeInteger(externalId) && externalId >= 0,
      );
  }

  /**
   * Lazily initializes the challenge lookup client.
   *
   * @returns Prisma client for the challenge DB, or undefined when not configured.
   */
  private getChallengeClient(): PrismaClient | undefined {
    if (this.challengeClientInitialized) {
      return this.challengeClient;
    }

    this.challengeClientInitialized = true;
    this.challengeClient = this.createOptionalClient(
      process.env.CHALLENGE_DB_URL || process.env.CHALLENGES_DB_URL,
      "CHALLENGE_DB_URL or CHALLENGES_DB_URL",
    );

    return this.challengeClient;
  }

  /**
   * Lazily initializes the engagements lookup client.
   *
   * @returns Prisma client for the engagements DB, or undefined when not configured.
   */
  private getEngagementsClient(): PrismaClient | undefined {
    if (this.engagementsClientInitialized) {
      return this.engagementsClient;
    }

    this.engagementsClientInitialized = true;
    this.engagementsClient = this.createOptionalClient(
      process.env.ENGAGEMENTS_DB_URL || process.env.ENGAGEMENT_DB_URL,
      "ENGAGEMENTS_DB_URL or ENGAGEMENT_DB_URL",
    );

    return this.engagementsClient;
  }

  /**
   * Lazily initializes the projects lookup client.
   *
   * @returns Prisma client for the projects DB, or undefined when not configured.
   */
  private getProjectsClient(): PrismaClient | undefined {
    if (this.projectsClientInitialized) {
      return this.projectsClient;
    }

    this.projectsClientInitialized = true;
    this.projectsClient = this.createOptionalClient(
      process.env.PROJECTS_DB_URL || process.env.PROJECT_DB_URL,
      "PROJECTS_DB_URL or PROJECT_DB_URL",
      "project-access filtering will hide line items whose access cannot be resolved.",
    );

    return this.projectsClient;
  }

  /**
   * Creates a Prisma client for an optional external lookup database.
   *
   * @param databaseUrl External database connection string.
   * @param envDescription Human-readable environment variable description.
   * @param disabledMessage Message describing behavior when the URL is missing.
   * @returns Prisma client when configured, otherwise undefined.
   */
  private createOptionalClient(
    databaseUrl: string | undefined,
    envDescription: string,
    disabledMessage = "billing-account external names will be omitted for that type.",
  ): PrismaClient | undefined {
    if (!databaseUrl) {
      this.logger.warn(`${envDescription} not set; ${disabledMessage}`);
      return undefined;
    }

    return new PrismaClient({
      transactionOptions: {
        timeout: process.env.BA_SERVICE_PRISMA_TIMEOUT
          ? parseInt(process.env.BA_SERVICE_PRISMA_TIMEOUT, 10)
          : 10000,
      },
      datasources: { db: { url: databaseUrl } },
    });
  }

  /**
   * Normalizes a numeric id that may arrive as string, number, bigint, or null.
   *
   * @param value Id value to normalize.
   * @returns Canonical decimal string, or undefined for non-numeric values.
   */
  private normalizeNumericTextId(
    value: bigint | number | string | null | undefined,
  ): string | undefined {
    if (typeof value === "bigint") {
      return value >= 0n ? value.toString() : undefined;
    }

    if (typeof value === "number") {
      return Number.isSafeInteger(value) && value >= 0
        ? String(value)
        : undefined;
    }

    if (typeof value !== "string") {
      return undefined;
    }

    const normalizedValue = value.trim();

    if (!/^\d+$/.test(normalizedValue)) {
      return undefined;
    }

    return BigInt(normalizedValue).toString();
  }

  /**
   * Normalizes unknown errors for structured log messages.
   *
   * @param error Unknown caught error.
   * @returns Error message string.
   */
  private getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}

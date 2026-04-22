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

interface EngagementNameRow {
  id: string;
  title: string | null;
}

/**
 * Resolves budget-entry external names from service-owned persistence stores.
 *
 * The service uses raw batched lookups so billing-account detail responses do
 * not make one network/database call per line item. Missing DB URLs or missing
 * referenced rows produce empty name mappings rather than failing the billing
 * account response.
 */
@Injectable()
export class ExternalBudgetEntryLookupService implements OnModuleDestroy {
  private readonly logger = new Logger(ExternalBudgetEntryLookupService.name);
  private challengeClient?: PrismaClient;
  private engagementsClient?: PrismaClient;
  private challengeClientInitialized = false;
  private engagementsClientInitialized = false;

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
   * Disconnects optional lookup clients created for external stores.
   *
   * @returns Promise that resolves after all initialized clients disconnect.
   */
  async onModuleDestroy(): Promise<void> {
    await Promise.all([
      this.challengeClient?.$disconnect(),
      this.engagementsClient?.$disconnect(),
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
   * Creates a Prisma client for an optional external lookup database.
   *
   * @param databaseUrl External database connection string.
   * @param envDescription Human-readable environment variable description.
   * @returns Prisma client when configured, otherwise undefined.
   */
  private createOptionalClient(
    databaseUrl: string | undefined,
    envDescription: string,
  ): PrismaClient | undefined {
    if (!databaseUrl) {
      this.logger.warn(
        `${envDescription} not set; billing-account external names will be omitted for that type.`,
      );
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
   * Normalizes unknown errors for structured log messages.
   *
   * @param error Unknown caught error.
   * @returns Error message string.
   */
  private getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}

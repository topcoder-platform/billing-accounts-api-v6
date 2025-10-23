import { Injectable, Logger } from "@nestjs/common";
import { Prisma, PrismaClient } from "@prisma/client";

/**
 * Lightweight lookup service into the Members DB to resolve handles by userId.
 * Uses MEMBER_DB_URL connection string. Falls back gracefully if not set.
 */
@Injectable()
export class MembersLookupService {
  private readonly logger = new Logger(MembersLookupService.name);
  private client?: PrismaClient;
  private initialized = false;

  private ensureClient() {
    if (this.initialized) return;
    const url = process.env.MEMBER_DB_URL;
    if (!url) {
      this.logger.warn("MEMBER_DB_URL not set; member handle lookups will be skipped.");
      this.initialized = true;
      return;
    }
    // Create a dedicated Prisma client targeting the members DB
    this.client = new PrismaClient({ datasources: { db: { url } } });
    this.initialized = true;
  }

  /**
   * Resolve handles by userId (string). Returns a map of userId->handle.
   */
  async getHandlesByUserIds(userIds: string[]): Promise<Map<string, string>> {
    this.ensureClient();
    const result = new Map<string, string>();
    if (!userIds.length) return result;
    if (!this.client) return result; // no MEMBER_DB_URL configured

    // Convert to numeric values where possible (members.userId is BigInt)
    const numericIds = userIds
      .map((id) => {
        try { return BigInt(id); } catch { return undefined; }
      })
      .filter((v): v is bigint => typeof v === "bigint");
    if (!numericIds.length) return result;

    // Build an IN (...) clause safely using Prisma.sql and Prisma.join
    const rows: Array<{ userId: bigint; handle: string }> = await (this.client as any).$queryRaw(
      Prisma.sql`SELECT "userId", "handle" FROM "member" WHERE "userId" IN (${Prisma.join(numericIds)})`
    );

    for (const r of rows) {
      const uid = r.userId?.toString?.() ?? String(r.userId);
      if (uid) result.set(uid, r.handle);
    }
    return result;
  }
}

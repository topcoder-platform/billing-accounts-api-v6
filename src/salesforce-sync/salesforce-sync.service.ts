import { ConflictException, Injectable } from "@nestjs/common";
import { PrismaService } from "../common/prisma.service";
import {
  CLIENT_SALESFORCE_FIELDS,
  BILLING_ACCOUNT_SALESFORCE_FIELDS,
} from "../common/salesforce-metadata";
import { SalesforceSyncClient } from "./salesforce-sync.client";
import { LocalRecord, planSync } from "./salesforce-sync.plan";

/** Synchronizes existing local metadata from Salesforce without creating or deleting records. */
@Injectable()
export class SalesforceSyncService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly salesforce: SalesforceSyncClient,
  ) {}

  /**
   * Scans both complete Salesforce snapshots and all local records, including inactive rows.
   * A database advisory lock serializes syncs across API replicas. All accepted updates
   * commit together; any upstream or persistence failure rolls back the entire run.
   * @returns Counts for every local client and billing account after commit.
   * @throws ConflictException if another sync owns the lock; propagates sanitized Salesforce
   * errors and database failures. Conflicting/unmatched identities are counted, never guessed.
   */
  async sync() {
    return this.prisma.$transaction(
      async (tx) => {
        const [lock] = await tx.$queryRaw<Array<{ locked: boolean }>>`
        SELECT pg_try_advisory_xact_lock(736291, 1) AS locked
      `;
        if (!lock.locked)
          throw new ConflictException("A Salesforce sync is already running.");
        const session = await this.salesforce.authenticate();
        const accounts = await this.salesforce.queryAll(
          "Account",
          [...Object.values(CLIENT_SALESFORCE_FIELDS), "Topcoder_Client_id__c"],
          session,
        );
        const billing = await this.salesforce.queryAll(
          "Topcoder_Billing_Account__c",
          [
            ...Object.values(BILLING_ACCOUNT_SALESFORCE_FIELDS),
            "TopCoder_Billing_Account_Id__c",
          ],
          session,
        );
        const clients: LocalRecord[] = [];
        const billingAccounts: LocalRecord[] = [];
        let clientCursor: string | undefined;
        let billingCursor: number | undefined;
        do {
          const page = await tx.client.findMany({
            select: {
              id: true,
              ...Object.fromEntries(
                Object.keys(CLIENT_SALESFORCE_FIELDS).map((key) => [key, true]),
              ),
            },
            orderBy: { id: "asc" },
            take: 500,
            ...(clientCursor ? { cursor: { id: clientCursor }, skip: 1 } : {}),
          });
          clients.push(...page);
          clientCursor =
            page.length === 500 ? page[page.length - 1].id : undefined;
        } while (clientCursor);
        do {
          const page = await tx.billingAccount.findMany({
            select: {
              id: true,
              ...Object.fromEntries(
                Object.keys(BILLING_ACCOUNT_SALESFORCE_FIELDS).map((key) => [
                  key,
                  true,
                ]),
              ),
            },
            orderBy: { id: "asc" },
            take: 500,
            ...(billingCursor !== undefined
              ? { cursor: { id: billingCursor }, skip: 1 }
              : {}),
          });
          billingAccounts.push(...page);
          billingCursor =
            page.length === 500 ? page[page.length - 1].id : undefined;
        } while (billingCursor !== undefined);
        const clientPlan = planSync(
          clients,
          accounts,
          CLIENT_SALESFORCE_FIELDS,
          "salesforceAccountId",
          "Topcoder_Client_id__c",
        );
        const billingPlan = planSync(
          billingAccounts,
          billing,
          BILLING_ACCOUNT_SALESFORCE_FIELDS,
          "salesforceBillingAccountId",
          "TopCoder_Billing_Account_Id__c",
        );
        for (const update of clientPlan.updates) {
          await tx.client.update({
            where: { id: String(update.id) },
            data: update.data,
          });
        }
        for (const update of billingPlan.updates) {
          await tx.billingAccount.update({
            where: { id: Number(update.id) },
            data: update.data,
          });
        }
        return {
          clients: clientPlan.counts,
          billingAccounts: billingPlan.counts,
        };
      },
      { maxWait: 5000, timeout: 300000 },
    );
  }
}

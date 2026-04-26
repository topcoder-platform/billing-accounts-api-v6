import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../common/prisma.service";
import { Prisma } from "@prisma/client";
import { QueryBillingAccountsDto } from "./dto/query-billing-accounts.dto";
import { CreateBillingAccountDto } from "./dto/create-billing-account.dto";
import { UpdateBillingAccountDto } from "./dto/update-billing-account.dto";
import { LockAmountDto } from "./dto/lock-amount.dto";
import { ConsumeAmountDto } from "./dto/consume-amount.dto";
import {
  ConsumeAmountsDto,
  ConsumeAmountsItemDto,
} from "./dto/consume-amounts.dto";
import { ExternalBudgetEntryLookupService } from "./external-budget-entry-lookup.service";
import {
  getBudgetEntryReferenceKey,
  resolveBudgetEntryReference,
  type BudgetEntryReference,
  type BudgetEntryExternalTypeValue,
} from "./budget-entry.util";
import { MembersLookupService } from "../common/members-lookup.service";
import SalesforceService from "../common/salesforce.service";
import {
  ADMIN_ROLE,
  COPILOT_ROLE,
  PROJECT_MANAGER_ROLE,
  TALENT_MANAGER_ROLE,
  TOPCODER_PROJECT_MANAGER_ROLE,
  TOPCODER_TALENT_MANAGER_ROLE,
} from "../auth/constants";

export interface BillingAccountsAuthUser {
  id?: number | string;
  role?: string;
  roles?: string[] | string;
  sub?: number | string;
  tcUserId?: number | string;
  user_id?: number | string;
  userID?: number | string;
  userId?: number | string;
}

const UNRESTRICTED_BILLING_ACCOUNT_READ_ROLES = [
  ADMIN_ROLE,
  COPILOT_ROLE,
  TALENT_MANAGER_ROLE,
  TOPCODER_TALENT_MANAGER_ROLE,
];

const RESTRICTED_PROJECT_MANAGER_READ_ROLES = [
  PROJECT_MANAGER_ROLE,
  TOPCODER_PROJECT_MANAGER_ROLE,
];

const PROJECT_ACCESS_FILTERED_LINE_ITEM_ROLES = [
  COPILOT_ROLE,
  PROJECT_MANAGER_ROLE,
  TOPCODER_PROJECT_MANAGER_ROLE,
  TALENT_MANAGER_ROLE,
  TOPCODER_TALENT_MANAGER_ROLE,
];

const BILLING_ACCOUNT_MARKUP_VISIBLE_ROLES = [
  ADMIN_ROLE,
  PROJECT_MANAGER_ROLE,
  TOPCODER_PROJECT_MANAGER_ROLE,
  TALENT_MANAGER_ROLE,
  TOPCODER_TALENT_MANAGER_ROLE,
];

const BUDGET_AMOUNT_DECIMAL_PLACES = 4;

interface BudgetAmountLineItem {
  id: string;
  billingAccountId: number;
  externalId: string;
  externalType: BudgetEntryExternalTypeValue;
  amount: Prisma.Decimal;
  createdAt: Date;
  updatedAt: Date;
}

interface BillingAccountBudgetLockRow {
  budget: Prisma.Decimal;
}

interface BudgetMutationContext {
  budget: Prisma.Decimal;
  lockedTotal: Prisma.Decimal;
  consumedTotal: Prisma.Decimal;
  matchingLock: BudgetAmountLineItem | null;
  matchingConsumed: BudgetAmountLineItem | null;
}

interface BudgetAccountTotals {
  budget: Prisma.Decimal;
  lockedTotal: Prisma.Decimal;
  consumedTotal: Prisma.Decimal;
}

interface NormalizedEngagementConsume {
  amount: Prisma.Decimal;
  billingAccountId: number;
  externalId: string;
  externalType: "ENGAGEMENT";
}

interface ProjectAccessFilteredLineItems {
  lockedAmounts: BudgetAmountLineItem[];
  consumedAmounts: BudgetAmountLineItem[];
}

/**
 * Normalizes authenticated caller roles for case-insensitive comparisons.
 *
 * Accepts either array-backed `roles` or the legacy comma-delimited `role`
 * payload shapes emitted by different token issuers.
 *
 * @param authUser Authenticated caller context from `req.authUser`.
 * @returns Lower-cased role names.
 */
function getNormalizedAuthUserRoles(
  authUser?: BillingAccountsAuthUser,
): string[] {
  const roles = Array.isArray(authUser?.roles)
    ? authUser.roles
    : String(authUser?.roles || authUser?.role || "")
        .split(",")
        .map((role) => role.trim())
        .filter(Boolean);

  return roles.map((role) => role.toLowerCase());
}

/**
 * Resolves the caller user id as a trimmed string when present.
 *
 * Topcoder JWT middleware has used a few decoded claim names across services,
 * so this accepts the canonical `userId` first and then falls back to the other
 * common user-id claim spellings.
 *
 * @param authUser Authenticated caller context from `req.authUser`.
 * @returns Normalized user id or `undefined` when missing.
 */
function getNormalizedAuthUserId(
  authUser?: BillingAccountsAuthUser,
): string | undefined {
  const candidateUserId =
    authUser?.userId ??
    authUser?.user_id ??
    authUser?.userID ??
    authUser?.tcUserId ??
    authUser?.id ??
    authUser?.sub;

  if (typeof candidateUserId === "number" && Number.isFinite(candidateUserId)) {
    return String(candidateUserId);
  }

  if (typeof candidateUserId !== "string") {
    return undefined;
  }

  const normalizedUserId = candidateUserId.trim();

  return normalizedUserId || undefined;
}

/**
 * Returns the enforced access-grant user id for restricted Project Manager
 * billing-account reads.
 *
 * `undefined` means the caller keeps unrestricted read behavior. `null`
 * indicates a restricted Project Manager caller without a usable `userId`,
 * which should be treated as no accessible accounts.
 *
 * @param authUser Authenticated caller context from `req.authUser`.
 * @returns Enforced user id, `null`, or `undefined`.
 */
function resolveRestrictedProjectManagerUserId(
  authUser?: BillingAccountsAuthUser,
): string | null | undefined {
  const normalizedRoles = getNormalizedAuthUserRoles(authUser);
  const hasRestrictedProjectManagerRole =
    RESTRICTED_PROJECT_MANAGER_READ_ROLES.some((role) =>
      normalizedRoles.includes(role.toLowerCase()),
    );

  if (!hasRestrictedProjectManagerRole) {
    return undefined;
  }

  const hasUnrestrictedReadRole = UNRESTRICTED_BILLING_ACCOUNT_READ_ROLES.some(
    (role) => normalizedRoles.includes(role.toLowerCase()),
  );

  if (hasUnrestrictedReadRole) {
    return undefined;
  }

  return getNormalizedAuthUserId(authUser) ?? null;
}

/**
 * Returns the user id to use for project-level line-item filtering.
 *
 * Administrators keep full line-item visibility. Copilots, Project Managers,
 * and Talent Managers only receive line items whose underlying challenge or
 * engagement project can be resolved to an active project membership for their
 * user id.
 *
 * @param authUser Authenticated caller context from `req.authUser`.
 * @returns User id to filter by, `null` when missing, or `undefined` when no
 * filtering is required.
 */
function resolveProjectAccessFilteredLineItemUserId(
  authUser?: BillingAccountsAuthUser,
): string | null | undefined {
  const normalizedRoles = getNormalizedAuthUserRoles(authUser);
  const hasAdminRole = normalizedRoles.includes(ADMIN_ROLE.toLowerCase());

  if (hasAdminRole) {
    return undefined;
  }

  const requiresProjectAccessFiltering =
    PROJECT_ACCESS_FILTERED_LINE_ITEM_ROLES.some((role) =>
      normalizedRoles.includes(role.toLowerCase()),
    );

  if (!requiresProjectAccessFiltering) {
    return undefined;
  }

  return getNormalizedAuthUserId(authUser) ?? null;
}

/**
 * Returns whether the caller should receive copilot-safe billing-account data.
 *
 * Copilots must not receive the raw billing-account markup. Manager, Talent
 * Manager, and administrator roles retain the existing billing-account detail
 * response shape even when a token also carries the copilot role.
 *
 * @param authUser Authenticated caller context from `req.authUser`.
 * @returns `true` when markup should be removed from billing-account responses.
 */
function shouldHideMarkupForCopilot(
  authUser?: BillingAccountsAuthUser,
): boolean {
  const normalizedRoles = getNormalizedAuthUserRoles(authUser);
  const hasCopilotRole = normalizedRoles.includes(COPILOT_ROLE.toLowerCase());

  if (!hasCopilotRole) {
    return false;
  }

  return !BILLING_ACCOUNT_MARKUP_VISIBLE_ROLES.some((role) =>
    normalizedRoles.includes(role.toLowerCase()),
  );
}

@Injectable()
export class BillingAccountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly externalBudgetEntryLookup: ExternalBudgetEntryLookupService,
    private readonly membersLookup: MembersLookupService,
    private readonly salesforce: SalesforceService,
  ) {}

  /**
   * List billing accounts one or more user IDs have access to (via Salesforce resource object).
   * Accepts a single userId (number).
   */
  async listByUserId(userId: number) {
    const { accessToken, instanceUrl } = await this.salesforce.authenticate();

    // escape backslashes and single quotes and build IN clause
    const escaped = `'${String(userId).replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
    const nameField =
      process.env.SFDC_BILLING_ACCOUNT_NAME_FIELD || "Billing_Account_name__c";
    const sql = `SELECT Topcoder_Billing_Account__r.Id, Topcoder_Billing_Account__r.TopCoder_Billing_Account_Id__c, Topcoder_Billing_Account__r.${nameField}, Topcoder_Billing_Account__r.Start_Date__c, Topcoder_Billing_Account__r.End_Date__c FROM Topcoder_Billing_Account_Resource__c tbar WHERE Topcoder_Billing_Account__r.Active__c=true AND UserID__c = ${escaped}`;

    const res = await this.salesforce.queryUserBillingAccounts(
      sql,
      accessToken,
      instanceUrl,
    );
    return res;
  }

  /**
   * Lists billing accounts with optional filtering, sorting, and pagination.
   *
   * Project Manager callers are constrained to billing accounts granted to
   * their own `userId`, regardless of an explicit `userId` query override.
   *
   * @param q Query filters and pagination controls.
   * @param authUser Authenticated caller context from `req.authUser`.
   * @returns Paginated billing-account result set.
   */
  async list(q: QueryBillingAccountsDto, authUser?: BillingAccountsAuthUser) {
    const {
      clientId,
      userId,
      status,
      name,
      startDateFrom,
      startDateTo,
      endDateFrom,
      endDateTo,
      page = 1,
      perPage = 20,
      sortBy,
      sortOrder = "asc",
    } = q;
    const restrictedProjectManagerUserId =
      resolveRestrictedProjectManagerUserId(authUser);

    if (restrictedProjectManagerUserId === null) {
      return {
        page,
        perPage,
        total: 0,
        totalPages: 0,
        data: [],
      };
    }

    const where: Prisma.BillingAccountWhereInput = {
      ...(clientId ? { clientId } : {}),
      ...(status ? { status } : {}),
    };

    if (restrictedProjectManagerUserId) {
      where.accessGrants = { some: { userId: restrictedProjectManagerUserId } };
    } else if (userId) {
      where.accessGrants = { some: { userId } };
    }

    if (name) {
      where.name = { contains: name, mode: "insensitive" } as any;
    }

    if (startDateFrom || startDateTo) {
      where.startDate = {
        ...(startDateFrom ? { gte: new Date(startDateFrom) } : {}),
        ...(startDateTo ? { lte: new Date(startDateTo) } : {}),
      } as any;
    }

    if (endDateFrom || endDateTo) {
      where.endDate = {
        ...(endDateFrom ? { gte: new Date(endDateFrom) } : {}),
        ...(endDateTo ? { lte: new Date(endDateTo) } : {}),
      } as any;
    }

    // Fetch page
    const [total, items] = await this.prisma.$transaction([
      this.prisma.billingAccount.count({ where }),
      this.prisma.billingAccount.findMany({
        where,
        skip: (page - 1) * perPage,
        take: perPage,
        orderBy:
          sortBy === "remainingBudget"
            ? undefined // we'll sort after computing
            : sortBy
              ? { [sortBy]: sortOrder }
              : { createdAt: "desc" },
        include: { client: true },
      }),
    ]);

    const ids = items.map((i) => i.id);
    const [lockedAgg, consumedAgg] = await this.prisma.$transaction([
      this.prisma.lockedAmount.groupBy({
        by: ["billingAccountId"],
        where: { billingAccountId: { in: ids } },
        _sum: { amount: true },
        orderBy: [],
      }),
      this.prisma.consumedAmount.groupBy({
        by: ["billingAccountId"],
        where: { billingAccountId: { in: ids } },
        _sum: { amount: true },
        orderBy: [],
      }),
    ]);

    const lockedMap = new Map(
      lockedAgg.map((r) => [r.billingAccountId, r._sum?.amount || 0]),
    );
    const consumedMap = new Map(
      consumedAgg.map((r) => [r.billingAccountId, r._sum?.amount || 0]),
    );

    const data = items.map((i) => {
      const locked = Number(lockedMap.get(i.id) || 0);
      const consumed = Number(consumedMap.get(i.id) || 0);
      const remaining = Number(i.budget) - consumed - locked;
      return {
        ...i,
        lockedBudget: locked,
        consumedBudget: consumed,
        totalBudgetRemaining: remaining,
      };
    });

    if (sortBy === "remainingBudget") {
      data.sort((a, b) =>
        sortOrder === "asc"
          ? a.totalBudgetRemaining - b.totalBudgetRemaining
          : b.totalBudgetRemaining - a.totalBudgetRemaining,
      );
    }

    return {
      page,
      perPage,
      total,
      totalPages: Math.ceil(total / perPage),
      data: data.map((billingAccount) =>
        this.serializeBillingAccountForAuthUser(billingAccount, authUser),
      ),
    };
  }

  async create(dto: CreateBillingAccountDto, createdBy?: string) {
    return this.prisma.billingAccount.create({
      data: {
        name: dto.name,
        description: dto.description,
        status: (dto.status as any) || "ACTIVE",
        startDate: dto.startDate ? new Date(dto.startDate) : null,
        endDate: dto.endDate ? new Date(dto.endDate) : null,
        budget: new Prisma.Decimal(dto.budget),
        markup: new Prisma.Decimal(dto.markup),
        subcontractingEndCustomer: dto.subcontractingEndCustomer,
        clientId: dto.clientId,
        projectId: dto.projectId,
        poNumber: dto.poNumber,
        subscriptionNumber: dto.subscriptionNumber,
        isManualPrize: dto.isManualPrize ?? false,
        paymentTerms: dto.paymentTerms,
        salesTax:
          dto.salesTax !== undefined ? new Prisma.Decimal(dto.salesTax) : null,
        billable: dto.billable ?? true,
        createdBy,
      },
    });
  }

  /**
   * Fetches a single billing account, its normalized budget line items, and
   * budget aggregates.
   *
   * Project Manager callers can read only billing accounts granted to their own
   * `userId`. Missing access is surfaced as not found to avoid leaking account
   * existence. Locked and consumed line items expose `amount`, `date`,
   * `externalId`, `externalType`, and `externalName`; challenge rows also expose
   * the deprecated `challengeId` compatibility alias. Copilot, Project Manager,
   * and Talent Manager callers only receive line items for projects they belong
   * to; unresolved project access hides the line item.
   *
   * @param billingAccountId Billing-account identifier.
   * @param authUser Authenticated caller context from `req.authUser`.
   * @returns Billing-account details with locked, consumed, and remaining
   * budget totals.
   * @throws NotFoundException When the billing account does not exist or the
   * caller does not have access to it.
   */
  async get(billingAccountId: number, authUser?: BillingAccountsAuthUser) {
    const restrictedProjectManagerUserId =
      resolveRestrictedProjectManagerUserId(authUser);
    const include = {
      client: true,
      lockedAmounts: true,
      consumedAmounts: true,
    };
    const ba =
      restrictedProjectManagerUserId === undefined
        ? await this.prisma.billingAccount.findUnique({
            where: { id: billingAccountId },
            include,
          })
        : restrictedProjectManagerUserId === null
          ? null
          : await this.prisma.billingAccount.findFirst({
              where: {
                id: billingAccountId,
                accessGrants: {
                  some: { userId: restrictedProjectManagerUserId },
                },
              },
              include,
            });

    if (!ba)
      throw new NotFoundException(
        `Billing account with ID ${billingAccountId} not found`,
      );

    const locked = ba.lockedAmounts.reduce(
      (sum, r) => sum + Number(r.amount),
      0,
    );
    const consumed = ba.consumedAmounts.reduce(
      (sum, r) => sum + Number(r.amount),
      0,
    );
    const remaining = Number(ba.budget) - consumed - locked;
    const { lockedAmounts, consumedAmounts } =
      await this.filterBudgetLineItemsForProjectAccess(
        {
          lockedAmounts: ba.lockedAmounts,
          consumedAmounts: ba.consumedAmounts,
        },
        authUser,
      );
    const externalNames = await this.externalBudgetEntryLookup.getExternalNames(
      [
        ...lockedAmounts.map((lineItem) =>
          this.toBudgetEntryReference(lineItem),
        ),
        ...consumedAmounts.map((lineItem) =>
          this.toBudgetEntryReference(lineItem),
        ),
      ],
    );

    const response = {
      ...ba,
      lockedAmounts: lockedAmounts.map((lineItem) =>
        this.serializeBudgetLineItem(lineItem, externalNames),
      ),
      consumedAmounts: consumedAmounts.map((lineItem) =>
        this.serializeBudgetLineItem(lineItem, externalNames),
      ),
      lockedBudget: locked,
      consumedBudget: consumed,
      totalBudgetRemaining: remaining,
    };

    return this.serializeBillingAccountForAuthUser(response, authUser);
  }

  async update(billingAccountId: number, dto: UpdateBillingAccountDto) {
    return this.prisma.billingAccount.update({
      where: { id: billingAccountId },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.description !== undefined
          ? { description: dto.description }
          : {}),
        ...(dto.status !== undefined ? { status: dto.status as any } : {}),
        ...(dto.startDate !== undefined
          ? { startDate: dto.startDate ? new Date(dto.startDate) : null }
          : {}),
        ...(dto.endDate !== undefined
          ? { endDate: dto.endDate ? new Date(dto.endDate) : null }
          : {}),
        ...(dto.budget !== undefined
          ? { budget: new Prisma.Decimal(dto.budget) }
          : {}),
        ...(dto.markup !== undefined
          ? { markup: new Prisma.Decimal(dto.markup) }
          : {}),
        ...(dto.subcontractingEndCustomer !== undefined
          ? { subcontractingEndCustomer: dto.subcontractingEndCustomer }
          : {}),
        ...(dto.clientId !== undefined ? { clientId: dto.clientId } : {}),
        ...(dto.projectId !== undefined ? { projectId: dto.projectId } : {}),
        ...(dto.poNumber !== undefined ? { poNumber: dto.poNumber } : {}),
        ...(dto.subscriptionNumber !== undefined
          ? { subscriptionNumber: dto.subscriptionNumber }
          : {}),
        ...(dto.isManualPrize !== undefined
          ? { isManualPrize: dto.isManualPrize }
          : {}),
        ...(dto.paymentTerms !== undefined
          ? { paymentTerms: dto.paymentTerms }
          : {}),
        ...(dto.salesTax !== undefined
          ? {
              salesTax:
                dto.salesTax !== null ? new Prisma.Decimal(dto.salesTax) : null,
            }
          : {}),
        ...(dto.billable !== undefined ? { billable: dto.billable } : {}),
      },
    });
  }

  /**
   * Locks or unlocks budget for a challenge external reference.
   *
   * `externalId`/`externalType` are the canonical request fields. Legacy
   * `challengeId` remains accepted as an alias for challenge callers. Locking
   * is challenge-only, overwrites the matching challenge lock row, and rejects
   * requests when the post-operation locked plus consumed total would exceed
   * the billing-account budget.
   *
   * @param billingAccountId Billing account identifier.
   * @param dto Lock request containing amount and external reference.
   * @returns Updated lock row, or `{ unlocked: true }` when amount is zero.
   * @throws NotFoundException When the billing account does not exist.
   * @throws BadRequestException When the reference is invalid, already consumed,
   * amount is negative, or has insufficient remaining funds.
   */
  async lockAmount(billingAccountId: number, dto: LockAmountDto) {
    const requestedLock = this.toLedgerBudgetAmount(dto.amount, "lock");
    this.assertBudgetAmountIsNonNegative(requestedLock, "lock");

    const reference = resolveBudgetEntryReference(dto);
    this.assertChallengeAliasMatchesType(dto, reference);

    if (reference.externalType !== "CHALLENGE") {
      throw new BadRequestException(
        "Only CHALLENGE externalType can be locked",
      );
    }

    // If amount is 0, unlock (delete any lock)
    return this.prisma.$transaction(async (tx) => {
      const context = await this.loadBudgetMutationContext(
        tx,
        billingAccountId,
        reference,
      );
      if (context.matchingConsumed) {
        throw new BadRequestException(
          "Challenge already consumed against this billing account",
        );
      }

      this.assertBudgetCanReserve(
        context.budget,
        context.lockedTotal
          .minus(context.matchingLock?.amount ?? 0)
          .plus(context.consumedTotal)
          .plus(requestedLock),
      );

      if (requestedLock.isZero()) {
        await tx.lockedAmount.deleteMany({
          where: { billingAccountId, ...reference },
        });
        return { unlocked: true };
      }

      // upsert lock
      const rec = await tx.lockedAmount.upsert({
        where: {
          locked_unique_external: {
            billingAccountId,
            externalId: reference.externalId,
            externalType: reference.externalType,
          },
        },
        create: {
          billingAccountId,
          externalId: reference.externalId,
          externalType: reference.externalType,
          amount: requestedLock,
        },
        update: { amount: requestedLock },
      });
      return rec;
    });
  }

  /**
   * Consumes budget for a typed external reference.
   *
   * Challenge entries preserve existing overwrite semantics and clear any
   * matching lock. Engagement entries are append-only, one row per payment.
   * Requests are rejected when the post-operation locked plus consumed total
   * would exceed the billing-account budget. Zero consumes are rejected so
   * `lockAmount` remains the only zero-value unlock path.
   *
   * @param billingAccountId Billing account identifier.
   * @param dto Consume request containing amount and external reference.
   * @returns Consumed amount row.
   * @throws NotFoundException When the billing account does not exist.
   * @throws BadRequestException When the external reference is missing or has
   * a non-positive amount or insufficient remaining funds.
   */
  async consumeAmount(billingAccountId: number, dto: ConsumeAmountDto) {
    const requestedConsume = this.toLedgerBudgetAmount(dto.amount, "consume");
    this.assertBudgetAmountIsPositive(requestedConsume, "consume");

    const reference = resolveBudgetEntryReference(dto);
    this.assertChallengeAliasMatchesType(dto, reference);

    return this.prisma.$transaction(async (tx) => {
      const context = await this.loadBudgetMutationContext(
        tx,
        billingAccountId,
        reference,
      );

      if (reference.externalType === "ENGAGEMENT") {
        this.assertBudgetCanReserve(
          context.budget,
          context.lockedTotal
            .plus(context.consumedTotal)
            .plus(requestedConsume),
        );

        return tx.consumedAmount.create({
          data: {
            billingAccountId,
            externalId: reference.externalId,
            externalType: reference.externalType,
            amount: requestedConsume,
          },
        });
      }

      this.assertBudgetCanReserve(
        context.budget,
        context.lockedTotal
          .minus(context.matchingLock?.amount ?? 0)
          .plus(
            context.consumedTotal.minus(context.matchingConsumed?.amount ?? 0),
          )
          .plus(requestedConsume),
      );

      // delete any lock first for this challenge
      await tx.lockedAmount.deleteMany({
        where: { billingAccountId, ...reference },
      });

      if (context.matchingConsumed) {
        return tx.consumedAmount.update({
          where: { id: context.matchingConsumed.id },
          data: { amount: requestedConsume },
        });
      }

      return tx.consumedAmount.create({
        data: {
          billingAccountId,
          externalId: reference.externalId,
          externalType: reference.externalType,
          amount: requestedConsume,
        },
      });
    });
  }

  /**
   * Atomically consumes multiple engagement budget rows.
   *
   * All amounts are normalized to the `Decimal(20,4)` ledger scale before any
   * remaining-budget comparison. The method validates every requested consume
   * against locked billing-account rows first, then creates all consumed rows in
   * one database transaction so partial engagement-payment requests roll back
   * together.
   *
   * @param dto Batch consume request containing engagement consume items.
   * @returns Count of consumed rows created.
   * @throws NotFoundException When any billing account does not exist.
   * @throws BadRequestException When an item is not an engagement consume, has
   * invalid amount data, or would exceed remaining budget.
   */
  async consumeAmounts(dto: ConsumeAmountsDto) {
    if (!Array.isArray(dto.consumes) || dto.consumes.length === 0) {
      throw new BadRequestException("At least one consume is required");
    }

    const consumes = dto.consumes.map((consume, index) =>
      this.normalizeEngagementConsume(consume, index),
    );
    const consumesByBillingAccountId =
      this.groupConsumesByBillingAccountId(consumes);

    return this.prisma.$transaction(async (tx) => {
      for (const [billingAccountId, billingAccountConsumes] of Array.from(
        consumesByBillingAccountId.entries(),
      ).sort(
        ([leftBillingAccountId], [rightBillingAccountId]) =>
          leftBillingAccountId - rightBillingAccountId,
      )) {
        const totals = await this.loadBudgetAccountTotals(tx, billingAccountId);
        const requestedTotal = billingAccountConsumes.reduce(
          (sum, consume) => sum.plus(consume.amount),
          new Prisma.Decimal(0),
        );

        this.assertBudgetCanReserve(
          totals.budget,
          totals.lockedTotal.plus(totals.consumedTotal).plus(requestedTotal),
        );
      }

      return tx.consumedAmount.createMany({
        data: consumes.map((consume) => ({
          amount: consume.amount,
          billingAccountId: consume.billingAccountId,
          externalId: consume.externalId,
          externalType: consume.externalType,
        })),
      });
    });
  }

  /**
   * Normalizes one batch item into an engagement consume ready for validation.
   *
   * @param consume Incoming batch item.
   * @param index Zero-based item index used in validation messages.
   * @returns Canonical engagement consume with a Decimal(20,4)-scaled amount.
   * @throws BadRequestException When the billing account, reference, type, or
   * amount is invalid.
   */
  private normalizeEngagementConsume(
    consume: ConsumeAmountsItemDto,
    index: number,
  ): NormalizedEngagementConsume {
    if (
      !Number.isSafeInteger(consume.billingAccountId) ||
      consume.billingAccountId <= 0
    ) {
      throw new BadRequestException(
        `consumes[${index}].billingAccountId must be a positive integer`,
      );
    }

    const reference = resolveBudgetEntryReference({
      challengeId: consume.challengeId,
      externalId: consume.externalId,
      externalType: consume.externalType ?? "ENGAGEMENT",
    });
    this.assertChallengeAliasMatchesType(consume, reference);

    if (reference.externalType !== "ENGAGEMENT") {
      throw new BadRequestException(
        `consumes[${index}].externalType must be ENGAGEMENT`,
      );
    }

    const amount = this.toLedgerBudgetAmount(consume.amount, "consume");
    this.assertBudgetAmountIsPositive(amount, "consume");

    return {
      amount,
      billingAccountId: consume.billingAccountId,
      externalId: reference.externalId,
      externalType: "ENGAGEMENT",
    };
  }

  /**
   * Groups normalized engagement consumes by billing account id.
   *
   * @param consumes Normalized engagement consumes.
   * @returns Map from billing account id to consumes targeting that account.
   */
  private groupConsumesByBillingAccountId(
    consumes: NormalizedEngagementConsume[],
  ): Map<number, NormalizedEngagementConsume[]> {
    const grouped = new Map<number, NormalizedEngagementConsume[]>();

    for (const consume of consumes) {
      const billingAccountConsumes =
        grouped.get(consume.billingAccountId) ?? [];
      billingAccountConsumes.push(consume);
      grouped.set(consume.billingAccountId, billingAccountConsumes);
    }

    return grouped;
  }

  /**
   * Ensures the deprecated `challengeId` alias is only used for challenge
   * references and never as an engagement identifier.
   *
   * @param input Incoming lock or consume DTO.
   * @param reference Resolved typed external reference.
   * @throws BadRequestException When `challengeId` is paired with a
   * non-challenge external type.
   */
  private assertChallengeAliasMatchesType(
    input: { challengeId?: string },
    reference: BudgetEntryReference,
  ): void {
    if (input.challengeId?.trim() && reference.externalType !== "CHALLENGE") {
      throw new BadRequestException(
        "challengeId can only be used with CHALLENGE externalType",
      );
    }
  }

  /**
   * Quantizes a request amount to the billing ledger scale.
   *
   * The database stores budget ledger amounts as `Decimal(20,4)`, so budget
   * comparisons and persisted consume/lock rows must use the same four-decimal
   * representation.
   *
   * @param amount Request amount supplied by the caller.
   * @param operation Name of the budget mutation operation for error messages.
   * @returns Decimal value rounded to four fractional digits.
   * @throws BadRequestException When the amount is missing or non-finite.
   */
  private toLedgerBudgetAmount(
    amount: number,
    operation: "lock" | "consume",
  ): Prisma.Decimal {
    if (typeof amount !== "number" || !Number.isFinite(amount)) {
      throw new BadRequestException(
        `${operation} amount must be a finite number`,
      );
    }

    return new Prisma.Decimal(amount).toDecimalPlaces(
      BUDGET_AMOUNT_DECIMAL_PLACES,
      Prisma.Decimal.ROUND_HALF_UP,
    );
  }

  /**
   * Rejects negative budget mutation amounts after ledger-scale quantization.
   *
   * @param amount Requested lock or consume amount.
   * @param operation Name of the budget mutation operation for error messages.
   * @throws BadRequestException When the amount is negative.
   */
  private assertBudgetAmountIsNonNegative(
    amount: Prisma.Decimal,
    operation: "lock" | "consume",
  ): void {
    if (amount.lessThan(0)) {
      throw new BadRequestException(
        `${operation} amount must be a non-negative number`,
      );
    }
  }

  /**
   * Rejects non-positive consume amounts.
   *
   * Consume requests do not treat zero as an unlock or no-op; zero-value
   * unlocks are handled only by `lockAmount`.
   *
   * @param amount Requested consume amount after ledger-scale quantization.
   * @param operation Name of the budget mutation operation for error messages.
   * @throws BadRequestException When the amount is negative or zero.
   */
  private assertBudgetAmountIsPositive(
    amount: Prisma.Decimal,
    operation: "consume",
  ): void {
    this.assertBudgetAmountIsNonNegative(amount, operation);

    if (amount.isZero()) {
      throw new BadRequestException("consume amount must be greater than 0");
    }
  }

  /**
   * Locks the billing-account row and loads current budget totals.
   *
   * The row lock serializes budget writes for the same billing account inside
   * the caller's transaction.
   *
   * @param tx Active Prisma transaction client.
   * @param billingAccountId Billing account identifier.
   * @returns Budget and aggregate locked/consumed totals.
   * @throws NotFoundException When the billing account does not exist.
   */
  private async loadBudgetAccountTotals(
    tx: Prisma.TransactionClient,
    billingAccountId: number,
  ): Promise<BudgetAccountTotals> {
    const [billingAccount] = await tx.$queryRaw<BillingAccountBudgetLockRow[]>(
      Prisma.sql`
        SELECT "budget"
        FROM "BillingAccount"
        WHERE "id" = ${billingAccountId}
        FOR UPDATE
      `,
    );

    if (!billingAccount) {
      throw new NotFoundException(
        `Billing account with ID ${billingAccountId} not found`,
      );
    }

    const [lockedAggregate, consumedAggregate] = await Promise.all([
      tx.lockedAmount.aggregate({
        where: { billingAccountId },
        _sum: { amount: true },
      }),
      tx.consumedAmount.aggregate({
        where: { billingAccountId },
        _sum: { amount: true },
      }),
    ]);

    return {
      budget: billingAccount.budget,
      lockedTotal: new Prisma.Decimal(lockedAggregate._sum.amount ?? 0),
      consumedTotal: new Prisma.Decimal(consumedAggregate._sum.amount ?? 0),
    };
  }

  /**
   * Loads current budget totals plus matching lock/consume rows for a reference.
   *
   * @param tx Active Prisma transaction client.
   * @param billingAccountId Billing account identifier.
   * @param reference Canonical typed external reference being mutated.
   * @returns Budget totals and matching line items.
   * @throws NotFoundException When the billing account does not exist.
   */
  private async loadBudgetMutationContext(
    tx: Prisma.TransactionClient,
    billingAccountId: number,
    reference: BudgetEntryReference,
  ): Promise<BudgetMutationContext> {
    const totals = await this.loadBudgetAccountTotals(tx, billingAccountId);
    const [matchingLock, matchingConsumed] = await Promise.all([
      tx.lockedAmount.findFirst({
        where: { billingAccountId, ...reference },
      }),
      tx.consumedAmount.findFirst({
        where: { billingAccountId, ...reference },
      }),
    ]);

    return {
      ...totals,
      matchingLock,
      matchingConsumed,
    };
  }

  /**
   * Rejects a budget mutation when its post-operation reserved total exceeds
   * the billing-account budget.
   *
   * @param budget Billing-account budget.
   * @param reservedTotal Locked plus consumed total after the pending mutation.
   * @throws BadRequestException When there are insufficient remaining funds.
   */
  private assertBudgetCanReserve(
    budget: Prisma.Decimal,
    reservedTotal: Prisma.Decimal,
  ): void {
    if (reservedTotal.greaterThan(budget)) {
      throw new BadRequestException(
        "Insufficient remaining funds on billing account",
      );
    }
  }

  /**
   * Converts a persisted budget row into an external reference lookup input.
   *
   * @param lineItem Locked or consumed budget row.
   * @returns Typed external reference for name resolution.
   */
  private toBudgetEntryReference(lineItem: BudgetAmountLineItem) {
    return {
      externalId: lineItem.externalId,
      externalType: lineItem.externalType,
    };
  }

  /**
   * Filters locked and consumed detail rows by project access when required.
   *
   * Caller roles that can view billing accounts across multiple projects still
   * need project-level protection on individual payment rows. This helper keeps
   * unrestricted callers unchanged, hides all rows when a restricted caller has
   * no usable user id, and otherwise keeps only references whose project access
   * is proven by the external lookup service.
   *
   * @param lineItems Locked and consumed budget rows from one billing account.
   * @param authUser Authenticated caller context from `req.authUser`.
   * @returns Filtered locked and consumed rows for the response detail arrays.
   */
  private async filterBudgetLineItemsForProjectAccess(
    lineItems: ProjectAccessFilteredLineItems,
    authUser?: BillingAccountsAuthUser,
  ): Promise<ProjectAccessFilteredLineItems> {
    const userId = resolveProjectAccessFilteredLineItemUserId(authUser);

    if (userId === undefined) {
      return lineItems;
    }

    if (userId === null) {
      return { lockedAmounts: [], consumedAmounts: [] };
    }

    const accessibleReferenceKeys =
      await this.externalBudgetEntryLookup.getProjectAccessibleReferenceKeys(
        [
          ...lineItems.lockedAmounts.map((lineItem) =>
            this.toBudgetEntryReference(lineItem),
          ),
          ...lineItems.consumedAmounts.map((lineItem) =>
            this.toBudgetEntryReference(lineItem),
          ),
        ],
        userId,
      );

    const canViewLineItem = (lineItem: BudgetAmountLineItem) =>
      accessibleReferenceKeys.has(
        getBudgetEntryReferenceKey(this.toBudgetEntryReference(lineItem)),
      );

    return {
      lockedAmounts: lineItems.lockedAmounts.filter(canViewLineItem),
      consumedAmounts: lineItems.consumedAmounts.filter(canViewLineItem),
    };
  }

  /**
   * Shapes a budget row for API details responses.
   *
   * The legacy `challengeId` alias is retained only for challenge rows while
   * `amount`, `date`, `externalId`, `externalType`, and `externalName` are the
   * canonical line-item response fields.
   *
   * @param lineItem Locked or consumed budget row.
   * @param externalNames Resolved names keyed by typed external reference.
   * @returns API-ready line item with normalized date and resolved name.
   */
  private serializeBudgetLineItem(
    lineItem: BudgetAmountLineItem,
    externalNames: Map<string, string>,
  ) {
    const reference = this.toBudgetEntryReference(lineItem);
    const serializedLineItem = {
      amount: lineItem.amount,
      date: lineItem.updatedAt,
      externalId: lineItem.externalId,
      externalType: lineItem.externalType,
      externalName:
        externalNames.get(getBudgetEntryReferenceKey(reference)) ?? null,
    };

    return lineItem.externalType === "CHALLENGE"
      ? { ...serializedLineItem, challengeId: lineItem.externalId }
      : serializedLineItem;
  }

  /**
   * Calculates the copilot-safe member-payment capacity for a billing account.
   *
   * This mirrors the Work app's existing calculation while keeping the raw
   * billing markup on the server. A zero markup means the full remaining budget
   * is available for member payments.
   *
   * @param totalBudgetRemaining Remaining billing-account budget.
   * @param markup Billing-account markup from persistence.
   * @returns Rounded member-payment capacity, or `undefined` when inputs are invalid.
   */
  private calculateMemberPaymentsRemaining(
    totalBudgetRemaining: unknown,
    markup: unknown,
  ): number | undefined {
    const remaining = Number(totalBudgetRemaining);
    const rawMarkup = Number(markup);

    if (!Number.isFinite(remaining) || !Number.isFinite(rawMarkup)) {
      return undefined;
    }

    const normalizedMarkup = rawMarkup > 1 ? rawMarkup / 100 : rawMarkup;

    if (normalizedMarkup < 0) {
      return undefined;
    }

    if (normalizedMarkup === 0) {
      return Number(remaining.toFixed(2));
    }

    return Number((remaining / (1 / normalizedMarkup)).toFixed(2));
  }

  /**
   * Removes raw markup from copilot responses and adds a derived safe budget field.
   *
   * @param billingAccount Billing-account response object after budget totals are available.
   * @param authUser Authenticated caller context from `req.authUser`.
   * @returns The original response for privileged callers, or a copilot-safe copy.
   */
  private serializeBillingAccountForAuthUser<
    T extends { markup?: unknown; totalBudgetRemaining?: unknown },
  >(billingAccount: T, authUser?: BillingAccountsAuthUser) {
    if (!shouldHideMarkupForCopilot(authUser)) {
      return billingAccount;
    }

    const { markup, ...sanitizedBillingAccount } = billingAccount;
    const memberPaymentsRemaining = this.calculateMemberPaymentsRemaining(
      billingAccount.totalBudgetRemaining,
      markup,
    );

    return memberPaymentsRemaining === undefined
      ? sanitizedBillingAccount
      : {
          ...sanitizedBillingAccount,
          memberPaymentsRemaining,
        };
  }

  /**
   * List users (resources) assigned to a billing account.
   * Returns minimal objects including handle (as name) for UI consumption.
   */
  async listUsers(billingAccountId: number) {
    const access = await this.prisma.billingAccountAccess.findMany({
      where: { billingAccountId },
      orderBy: { createdAt: "asc" },
    });
    const userIds = access.map((a) => a.userId);
    const handleMap = await this.membersLookup.getHandlesByUserIds(userIds);

    // Map to UI shape: id (seq), name (handle), status (static 'active')
    return access.map((a, idx) => ({
      id: idx + 1,
      name: handleMap.get(a.userId) || a.userId,
      status: "active",
    }));
  }

  /**
   * Grant access to a user (add as resource) on a billing account.
   */
  async addUser(billingAccountId: number, userId: string) {
    await this.prisma.billingAccountAccess.upsert({
      where: { ba_access_unique: { billingAccountId, userId } },
      create: { billingAccountId, userId, createdAt: new Date() },
      update: {},
    });
    // Return a single-item shape consistent with list response
    const handles = await this.membersLookup.getHandlesByUserIds([userId]);
    return {
      id: 1,
      name: handles.get(userId) || userId,
      status: "active",
    };
  }

  /**
   * Revoke access for a user on a billing account.
   */
  async removeUser(billingAccountId: number, userId: string) {
    await this.prisma.billingAccountAccess.deleteMany({
      where: { billingAccountId, userId },
    });
    return { removed: true };
  }

  /**
   * Check whether a user has access to a billing account.
   */
  async hasAccess(billingAccountId: number, userId: string) {
    const count = await this.prisma.billingAccountAccess.count({
      where: { billingAccountId, userId },
    });
    return { hasAccess: count > 0 };
  }
}

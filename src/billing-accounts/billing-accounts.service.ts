import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../common/prisma.service";
import { Prisma } from "@prisma/client";
import { QueryBillingAccountsDto } from "./dto/query-billing-accounts.dto";
import { CreateBillingAccountDto } from "./dto/create-billing-account.dto";
import { UpdateBillingAccountDto } from "./dto/update-billing-account.dto";
import { LockAmountDto } from "./dto/lock-amount.dto";
import { ConsumeAmountDto } from "./dto/consume-amount.dto";

@Injectable()
export class BillingAccountsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(q: QueryBillingAccountsDto) {
    const {
      clientId,
      userId,
      status,
      page = 1,
      perPage = 20,
      sortBy,
      sortOrder = "asc",
    } = q;

    const where: Prisma.BillingAccountWhereInput = {
      ...(clientId ? { clientId } : {}),
      ...(status ? { status } : {}),
    };

    if (userId) {
      where.accessGrants = { some: { userId } };
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
      lockedAgg.map((r) => [r.billingAccountId, r._sum?.amount || 0])
    );
    const consumedMap = new Map(
      consumedAgg.map((r) => [r.billingAccountId, r._sum?.amount || 0])
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
      data,
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

  async get(billingAccountId: string) {
    const ba = await this.prisma.billingAccount.findUnique({
      where: { id: billingAccountId },
      include: {
        client: true,
        lockedAmounts: true,
        consumedAmounts: true,
      },
    });
    if (!ba) throw new NotFoundException(`Billing account with ID ${billingAccountId} not found`);

    const locked = ba.lockedAmounts.reduce(
      (sum, r) => sum + Number(r.amount),
      0,
    );
    const consumed = ba.consumedAmounts.reduce(
      (sum, r) => sum + Number(r.amount),
      0,
    );
    const remaining = Number(ba.budget) - consumed - locked;

    return {
      ...ba,
      lockedBudget: locked,
      consumedBudget: consumed,
      totalBudgetRemaining: remaining,
    };
  }

  async update(billingAccountId: string, dto: UpdateBillingAccountDto) {
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

  async lockAmount(billingAccountId: string, dto: LockAmountDto) {
    // If amount is 0, unlock (delete any lock)
    return this.prisma.$transaction(async (tx) => {
      // ensure no consumed record exists
      const consumed = await tx.consumedAmount.findUnique({
        where: {
          consumed_unique_challenge: {
            billingAccountId,
            challengeId: dto.challengeId,
          },
        },
      });
      if (consumed) {
        throw new Error(
          "Challenge already consumed against this billing account",
        );
      }

      if (dto.amount === 0) {
        await tx.lockedAmount.deleteMany({
          where: { billingAccountId, challengeId: dto.challengeId },
        });
        return { unlocked: true };
      }

      // upsert lock
      const rec = await tx.lockedAmount.upsert({
        where: {
          locked_unique_challenge: {
            billingAccountId,
            challengeId: dto.challengeId,
          },
        },
        create: {
          billingAccountId,
          challengeId: dto.challengeId,
          amount: new Prisma.Decimal(dto.amount),
        },
        update: { amount: new Prisma.Decimal(dto.amount) },
      });
      return rec;
    });
  }

  async consumeAmount(billingAccountId: string, dto: ConsumeAmountDto) {
    return this.prisma.$transaction(async (tx) => {
      // delete any lock first for this challenge
      await tx.lockedAmount.deleteMany({
        where: { billingAccountId, challengeId: dto.challengeId },
      });

      // upsert consumed amount
      const rec = await tx.consumedAmount.upsert({
        where: {
          consumed_unique_challenge: {
            billingAccountId,
            challengeId: dto.challengeId,
          },
        },
        create: {
          billingAccountId,
          challengeId: dto.challengeId,
          amount: new Prisma.Decimal(dto.amount),
        },
        update: { amount: new Prisma.Decimal(dto.amount) },
      });
      return rec;
    });
  }
}

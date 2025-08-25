-- CreateEnum
CREATE TYPE "ClientStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "BAStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateTable
CREATE TABLE "Client" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "codeName" VARCHAR(255),
    "status" "ClientStatus" NOT NULL DEFAULT 'ACTIVE',
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Client_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingAccount" (
    "id" TEXT NOT NULL,
    "projectId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "BAStatus" NOT NULL DEFAULT 'ACTIVE',
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "budget" DECIMAL(20,4) NOT NULL,
    "markup" DECIMAL(10,4) NOT NULL,
    "clientId" TEXT NOT NULL,
    "poNumber" VARCHAR(255),
    "subscriptionNumber" VARCHAR(255),
    "isManualPrize" BOOLEAN NOT NULL DEFAULT false,
    "paymentTerms" VARCHAR(255),
    "salesTax" DECIMAL(10,4),
    "billable" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BillingAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LockedAmount" (
    "id" TEXT NOT NULL,
    "billingAccountId" TEXT NOT NULL,
    "challengeId" TEXT NOT NULL,
    "amount" DECIMAL(20,4) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LockedAmount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsumedAmount" (
    "id" TEXT NOT NULL,
    "billingAccountId" TEXT NOT NULL,
    "challengeId" TEXT NOT NULL,
    "amount" DECIMAL(20,4) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConsumedAmount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingAccountAccess" (
    "id" TEXT NOT NULL,
    "billingAccountId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BillingAccountAccess_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Client_name_idx" ON "Client"("name");

-- CreateIndex
CREATE INDEX "Client_codeName_idx" ON "Client"("codeName");

-- CreateIndex
CREATE INDEX "Client_status_idx" ON "Client"("status");

-- CreateIndex
CREATE INDEX "Client_startDate_endDate_idx" ON "Client"("startDate", "endDate");

-- CreateIndex
CREATE INDEX "BillingAccount_clientId_idx" ON "BillingAccount"("clientId");

-- CreateIndex
CREATE INDEX "BillingAccount_status_idx" ON "BillingAccount"("status");

-- CreateIndex
CREATE INDEX "BillingAccount_startDate_endDate_idx" ON "BillingAccount"("startDate", "endDate");

-- CreateIndex
CREATE INDEX "BillingAccount_createdBy_idx" ON "BillingAccount"("createdBy");

-- CreateIndex
CREATE INDEX "LockedAmount_billingAccountId_idx" ON "LockedAmount"("billingAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "LockedAmount_billingAccountId_challengeId_key" ON "LockedAmount"("billingAccountId", "challengeId");

-- CreateIndex
CREATE INDEX "ConsumedAmount_billingAccountId_idx" ON "ConsumedAmount"("billingAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "ConsumedAmount_billingAccountId_challengeId_key" ON "ConsumedAmount"("billingAccountId", "challengeId");

-- CreateIndex
CREATE INDEX "BillingAccountAccess_userId_idx" ON "BillingAccountAccess"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "BillingAccountAccess_billingAccountId_userId_key" ON "BillingAccountAccess"("billingAccountId", "userId");

-- AddForeignKey
ALTER TABLE "BillingAccount" ADD CONSTRAINT "BillingAccount_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LockedAmount" ADD CONSTRAINT "LockedAmount_billingAccountId_fkey" FOREIGN KEY ("billingAccountId") REFERENCES "BillingAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsumedAmount" ADD CONSTRAINT "ConsumedAmount_billingAccountId_fkey" FOREIGN KEY ("billingAccountId") REFERENCES "BillingAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingAccountAccess" ADD CONSTRAINT "BillingAccountAccess_billingAccountId_fkey" FOREIGN KEY ("billingAccountId") REFERENCES "BillingAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

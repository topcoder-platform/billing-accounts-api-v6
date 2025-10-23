/*
  Warnings:

  - The primary key for the `BillingAccount` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The `id` column on the `BillingAccount` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - Changed the type of `billingAccountId` on the `BillingAccountAccess` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `billingAccountId` on the `ConsumedAmount` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `billingAccountId` on the `LockedAmount` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.

*/
-- DropForeignKey
ALTER TABLE "BillingAccountAccess" DROP CONSTRAINT "BillingAccountAccess_billingAccountId_fkey";

-- DropForeignKey
ALTER TABLE "ConsumedAmount" DROP CONSTRAINT "ConsumedAmount_billingAccountId_fkey";

-- DropForeignKey
ALTER TABLE "LockedAmount" DROP CONSTRAINT "LockedAmount_billingAccountId_fkey";

-- AlterTable
ALTER TABLE "BillingAccount" DROP CONSTRAINT "BillingAccount_pkey",
DROP COLUMN "id",
ADD COLUMN     "id" SERIAL NOT NULL,
ADD CONSTRAINT "BillingAccount_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "BillingAccountAccess" DROP COLUMN "billingAccountId",
ADD COLUMN     "billingAccountId" INTEGER NOT NULL;

-- AlterTable
ALTER TABLE "ConsumedAmount" DROP COLUMN "billingAccountId",
ADD COLUMN     "billingAccountId" INTEGER NOT NULL;

-- AlterTable
ALTER TABLE "LockedAmount" DROP COLUMN "billingAccountId",
ADD COLUMN     "billingAccountId" INTEGER NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "BillingAccountAccess_billingAccountId_userId_key" ON "BillingAccountAccess"("billingAccountId", "userId");

-- CreateIndex
CREATE INDEX "ConsumedAmount_billingAccountId_idx" ON "ConsumedAmount"("billingAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "ConsumedAmount_billingAccountId_challengeId_key" ON "ConsumedAmount"("billingAccountId", "challengeId");

-- CreateIndex
CREATE INDEX "LockedAmount_billingAccountId_idx" ON "LockedAmount"("billingAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "LockedAmount_billingAccountId_challengeId_key" ON "LockedAmount"("billingAccountId", "challengeId");

-- AddForeignKey
ALTER TABLE "LockedAmount" ADD CONSTRAINT "LockedAmount_billingAccountId_fkey" FOREIGN KEY ("billingAccountId") REFERENCES "BillingAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsumedAmount" ADD CONSTRAINT "ConsumedAmount_billingAccountId_fkey" FOREIGN KEY ("billingAccountId") REFERENCES "BillingAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingAccountAccess" ADD CONSTRAINT "BillingAccountAccess_billingAccountId_fkey" FOREIGN KEY ("billingAccountId") REFERENCES "BillingAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

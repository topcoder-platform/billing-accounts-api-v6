-- CreateEnum
CREATE TYPE "BudgetEntryExternalType" AS ENUM ('CHALLENGE', 'ENGAGEMENT');

-- Remove legacy challenge-only unique indexes before renaming the reference columns.
DROP INDEX IF EXISTS "LockedAmount_billingAccountId_challengeId_key";
DROP INDEX IF EXISTS "ConsumedAmount_billingAccountId_challengeId_key";
DROP INDEX IF EXISTS "locked_unique_challenge";
DROP INDEX IF EXISTS "consumed_unique_challenge";

-- Rename challenge-specific references to the generic external reference contract.
ALTER TABLE "LockedAmount" RENAME COLUMN "challengeId" TO "externalId";
ALTER TABLE "ConsumedAmount" RENAME COLUMN "challengeId" TO "externalId";

-- Backfill existing budget rows as CHALLENGE entries while keeping future inserts explicit.
ALTER TABLE "LockedAmount"
  ADD COLUMN "externalType" "BudgetEntryExternalType" NOT NULL DEFAULT 'CHALLENGE';
ALTER TABLE "ConsumedAmount"
  ADD COLUMN "externalType" "BudgetEntryExternalType" NOT NULL DEFAULT 'CHALLENGE';

-- Locked entries remain unique per billing account and typed external reference.
CREATE UNIQUE INDEX "LockedAmount_billingAccountId_externalType_externalId_key"
  ON "LockedAmount"("billingAccountId", "externalType", "externalId");
CREATE INDEX "LockedAmount_externalType_externalId_idx"
  ON "LockedAmount"("externalType", "externalId");

-- Consumed CHALLENGE entries keep overwrite semantics, while ENGAGEMENT entries are append-only.
CREATE INDEX "ConsumedAmount_billingAccountId_externalType_externalId_idx"
  ON "ConsumedAmount"("billingAccountId", "externalType", "externalId");
CREATE UNIQUE INDEX "ConsumedAmount_billingAccountId_externalType_externalId_challenge_key"
  ON "ConsumedAmount"("billingAccountId", "externalType", "externalId")
  WHERE "externalType" = 'CHALLENGE';

-- Additive, nullable Salesforce metadata. Existing business fields remain independent.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

ALTER TABLE "Client"
  ADD COLUMN "salesforceAccountId" VARCHAR(18),
  ADD COLUMN "accountStatus" VARCHAR(255),
  ADD COLUMN "billingStreet" VARCHAR(255),
  ADD COLUMN "billingCity" VARCHAR(40),
  ADD COLUMN "billingState" VARCHAR(80),
  ADD COLUMN "billingPostalCode" VARCHAR(20),
  ADD COLUMN "billingCountry" VARCHAR(80),
  ADD COLUMN "phone" VARCHAR(40),
  ADD COLUMN "website" VARCHAR(255),
  ADD COLUMN "industry" VARCHAR(255),
  ADD COLUMN "parentId" VARCHAR(18),
  ADD COLUMN "paymentTerms" VARCHAR(255);

CREATE UNIQUE INDEX "Client_salesforceAccountId_key" ON "Client"("salesforceAccountId");

ALTER TABLE "BillingAccount"
  ADD COLUMN "salesforceBillingAccountId" VARCHAR(18),
  ADD COLUMN "billingAccountType" VARCHAR(255),
  ADD COLUMN "billingNotes" TEXT,
  ADD COLUMN "billingFrequency" VARCHAR(255),
  ADD COLUMN "opportunity" VARCHAR(18),
  ADD COLUMN "subscription" VARCHAR(18),
  ADD COLUMN "spoc" VARCHAR(18),
  ADD COLUMN "secondarySpoc" VARCHAR(18),
  ADD COLUMN "costCenter" VARCHAR(255),
  ADD COLUMN "workdayContractNumber" VARCHAR(255);

CREATE UNIQUE INDEX "BillingAccount_salesforceBillingAccountId_key" ON "BillingAccount"("salesforceBillingAccountId");

COMMIT;
